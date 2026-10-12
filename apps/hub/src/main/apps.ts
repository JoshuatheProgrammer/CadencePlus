/**
 * The state of each app (installed version, newest release, work in
 * progress) and the actions on it. Every change is pushed to the window as
 * 'hub:apps'.
 */
import { app, BrowserWindow, net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isNewer, latestRelease, releaseInstaller, repoConfigured, type FoundRelease, type ReleaseRepo } from '@cadence/release/releases'
import { appById, CATALOG, type AppId, type CatalogApp } from './catalog'
import { findInstalled, isRunning, launch, runInstaller, uninstall, type Installed } from './system'

export interface AppState {
  id: AppId
  name: string
  tagline: string
  description: string
  installed: { version: string; location: string } | null
  /** Newest release, or null when the app has none yet. */
  latest: { version: string; tag: string; url: string } | null
  /** Couldn't ask GitHub (offline, not configured…). */
  releaseError: string | null
  busy: null | { action: 'install' | 'update' | 'uninstall'; stage: 'downloading' | 'verifying' | 'installing' | 'removing'; percent: number }
  error: string | null
  /** Ticked in the installer or chosen earlier: install as soon as a release exists. */
  wanted: boolean
}

let repo: ReleaseRepo
const states = new Map<AppId, AppState>()

const wantedFile = () => join(app.getPath('userData'), 'wanted-apps.json')
const readWanted = (): AppId[] => {
  try {
    return JSON.parse(readFileSync(wantedFile(), 'utf8'))
  } catch {
    return []
  }
}
const writeWanted = (ids: AppId[]) => writeFileSync(wantedFile(), JSON.stringify([...new Set(ids)]))

function push(): void {
  const list = CATALOG.map((a) => states.get(a.id)!)
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('hub:apps', list)
}

function patch(id: AppId, p: Partial<AppState>): void {
  states.set(id, { ...states.get(id)!, ...p })
  push()
}

export const appStates = (): AppState[] => CATALOG.map((a) => states.get(a.id)!)

export function initApps(r: ReleaseRepo): void {
  repo = r
  const wanted = readWanted()
  for (const a of CATALOG) states.set(a.id, { id: a.id, name: a.name, tagline: a.tagline, description: a.description, installed: null, latest: null, releaseError: null, busy: null, error: null, wanted: wanted.includes(a.id) })
}

/** Re-reads what is installed and asks GitHub for the newest releases. */
export async function refresh(): Promise<AppState[]> {
  await Promise.all(
    CATALOG.map(async (a) => {
      const inst = await findInstalled(a)
      let latest: AppState['latest'] = null
      let releaseError: string | null = null
      if (!repoConfigured(repo)) releaseError = 'Releases are not set up for this build yet (release.config.json).'
      else
        try {
          const rel = await latestRelease(repo, a.prefix)
          latest = rel && { version: rel.version, tag: rel.tag, url: rel.base }
        } catch (e) {
          releaseError = `Couldn't reach GitHub: ${e instanceof Error ? e.message : String(e)}`
        }
      states.set(a.id, { ...states.get(a.id)!, installed: inst && { version: inst.version, location: inst.location }, latest, releaseError })
    })
  )
  push()
  return appStates()
}

/** Downloads `url` to `file`, reporting progress, and checks its SHA-512 (base64). */
async function download(url: string, file: string, sha512: string, progress: (p: number) => void): Promise<void> {
  const res = await net.fetch(url, { cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status} ${res.statusText}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha512')
  const out = createWriteStream(file)
  let got = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
    got += value.length
    if (!out.write(value)) await new Promise((r) => out.once('drain', r))
    if (total) progress(Math.round((got / total) * 100))
  }
  await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
  if (hash.digest('base64') !== sha512) {
    unlinkSync(file)
    throw new Error('The download did not match the release checksum, so it was not installed. Try again.')
  }
}

/** Installs the newest release, or updates to it. */
export async function install(id: AppId): Promise<void> {
  const a = appById(id)!
  const s = states.get(id)!
  if (s.busy) return
  const action = s.installed ? 'update' : 'install'
  if (!s.latest) {
    // Nothing released yet: remember the choice and install when it appears.
    writeWanted([...readWanted(), id])
    return patch(id, { wanted: true, error: null })
  }
  if (action === 'update' && (await isRunning(a))) return patch(id, { error: `Close ${a.name} first, then update.` })
  patch(id, { busy: { action, stage: 'downloading', percent: 0 }, error: null })
  const rel: FoundRelease = { version: s.latest.version, tag: s.latest.tag, base: s.latest.url }
  let file: string | null = null
  try {
    const inst = await releaseInstaller(rel)
    file = join(tmpdir(), `cadence-hub-${Date.now()}-${inst.file}`)
    await download(inst.url, file, inst.sha512, (percent) => patch(id, { busy: { action, stage: 'downloading', percent } }))
    patch(id, { busy: { action, stage: 'installing', percent: 100 } })
    await runInstaller(a, file, rel.version)
    writeWanted(readWanted().filter((x) => x !== id))
    patch(id, { busy: null, wanted: false })
  } catch (e) {
    patch(id, { busy: null, error: e instanceof Error ? e.message : String(e) })
  } finally {
    if (file && existsSync(file)) rmSync(file, { force: true })
    await refresh()
  }
}

export async function remove(id: AppId): Promise<void> {
  const a = appById(id)!
  const s = states.get(id)!
  if (s.busy || !s.installed) return
  if (await isRunning(a)) return patch(id, { error: `Close ${a.name} first, then uninstall.` })
  patch(id, { busy: { action: 'uninstall', stage: 'removing', percent: 0 }, error: null })
  try {
    const inst = await findInstalled(a)
    if (inst) await uninstall(a, inst)
    patch(id, { busy: null })
  } catch (e) {
    patch(id, { busy: null, error: e instanceof Error ? e.message : String(e) })
  } finally {
    await refresh()
  }
}

export async function open(id: AppId): Promise<void> {
  const a = appById(id)!
  const inst: Installed | null = await findInstalled(a)
  if (!inst) return void (await refresh())
  launch(a, inst)
}

/**
 * Installs the apps ticked in the hub's installer (written to
 * install-on-first-run.txt) and any wanted app that now has a release.
 */
export async function installWanted(): Promise<void> {
  const first = join(app.getPath('userData'), 'install-on-first-run.txt')
  if (existsSync(first)) {
    const ids = readFileSync(first, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l): l is AppId => !!appById(l))
    rmSync(first, { force: true })
    writeWanted([...readWanted(), ...ids])
    for (const id of ids) states.set(id, { ...states.get(id)!, wanted: true })
    push()
  }
  for (const id of readWanted()) {
    const s = states.get(id)
    if (s && !s.installed && s.latest && !s.busy) await install(id)
  }
}

/** Apps with a newer release than the installed one. */
export const updatesAvailable = (): number => appStates().filter((s) => s.installed && s.latest && isNewer(s.latest.version, s.installed.version)).length
