/**
 * Auto-update from GitHub Releases.
 *
 * All Cadence apps release from one repository, so each app's releases are
 * tagged with its own prefix (Cadence+ uses "plus-v1.2.3"). A check asks the
 * GitHub API for the newest release with this app's prefix, then points
 * electron-updater at that release's files (latest.yml + installer), which it
 * downloads and verifies (SHA-512). The update installs when the user
 * restarts, or on the next normal quit.
 */
import { app, BrowserWindow, net } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'

declare const __RELEASE__: { owner: string; repo: string }

const { autoUpdater } = electronUpdater
const TAG_PREFIX = 'plus-v'
const EVERY = 6 * 60 * 60 * 1000

let status: UpdateStatus = { state: 'idle' }

function send(s: UpdateStatus): void {
  status = s
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', s)
}

export const updateStatus = (): UpdateStatus => status

/** Why updates are off in this build, or null when they are on. */
function disabledReason(): string | null {
  if (process.env.CADENCE_UPDATE_API) return null // test feed (see scripts/e2e-update.mjs)
  if (!app.isPackaged) return 'Updates are checked in installed builds only.'
  if (!__RELEASE__.owner || __RELEASE__.owner === 'YOUR_GITHUB') return 'This build has no release repository set (release.config.json).'
  return null
}

const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)
function newer(a: string, b: string): boolean {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
}

/** The newest published release of this app: { version, base URL of its files }. */
async function latestRelease(): Promise<{ version: string; base: string } | null> {
  const api = process.env.CADENCE_UPDATE_API ?? `https://api.github.com/repos/${__RELEASE__.owner}/${__RELEASE__.repo}`
  const res = await net.fetch(`${api}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cadence-Updater' } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`)
  const list = (await res.json()) as Release[]
  let best: string | null = null
  for (const r of list) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith(TAG_PREFIX)) continue
    const v = r.tag_name.slice(TAG_PREFIX.length)
    if (!best || newer(v, best)) best = v
  }
  if (!best) return null
  const files = process.env.CADENCE_UPDATE_FILES ?? `https://github.com/${__RELEASE__.owner}/${__RELEASE__.repo}/releases/download`
  return { version: best, base: `${files}/${TAG_PREFIX}${best}` }
}

let checking = false

/** Checks for, and downloads, a newer version. `manual`: the user asked (always reports the outcome). */
export async function checkForUpdates(manual = false): Promise<UpdateStatus> {
  const off = disabledReason()
  if (off) return manual ? (send({ state: 'disabled', message: off }), status) : status
  if (checking || status.state === 'downloading' || status.state === 'ready') return status
  checking = true
  try {
    send({ state: 'checking' })
    const rel = await latestRelease()
    const current = app.getVersion()
    if (!rel || !newer(rel.version, current)) {
      send({ state: 'none', version: current })
      return status
    }
    autoUpdater.setFeedURL({ provider: 'generic', url: rel.base })
    send({ state: 'downloading', version: rel.version, percent: 0 })
    await autoUpdater.checkForUpdates()
    return status
  } catch (e) {
    send({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    return status
  } finally {
    checking = false
  }
}

/** Restarts into the downloaded version (windows still ask about unsaved work first). */
export function installUpdate(): void {
  if (status.state === 'ready' && !process.env.CADENCE_UPDATE_API) autoUpdater.quitAndInstall(false, true)
}

export function startUpdater(): void {
  autoUpdater.autoDownload = true
  // A test feed (scripts/e2e-packaged.mjs) serves a dummy file that must never run.
  autoUpdater.autoInstallOnAppQuit = !process.env.CADENCE_UPDATE_API
  autoUpdater.allowDowngrade = false
  // Releases are signed after building, so there are no block maps: always download the full installer.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = process.env.CADENCE_UPDATE_API ? console : null
  // Progress events can arrive after the download finished; never step back from 'ready'.
  autoUpdater.on('download-progress', (p) => status.state !== 'ready' && send({ state: 'downloading', version: status.state === 'downloading' ? status.version : undefined, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => send({ state: 'error', message: e.message }))
  if (disabledReason()) return
  setTimeout(() => void checkForUpdates(), 15_000)
  setInterval(() => void checkForUpdates(), EVERY)
}
