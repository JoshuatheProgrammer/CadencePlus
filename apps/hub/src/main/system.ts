/**
 * What is installed on this PC, and running installers.
 *
 * Installed apps are found through the uninstall entries their (NSIS)
 * installers write to the Windows registry. With CADENCE_HUB_FAKE_SYSTEM
 * set (tests), a JSON file in that folder stands in for the registry and
 * installers are verified but not run.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CatalogApp } from './catalog'

export interface Installed {
  version: string
  /** Folder with the app's executable. */
  location: string
  uninstall: string | null
}

const fake = process.env.CADENCE_HUB_FAKE_SYSTEM
const fakeFile = () => join(fake!, 'installed.json')
const readFake = (): Record<string, Installed & { launched?: number }> => (existsSync(fakeFile()) ? JSON.parse(readFileSync(fakeFile(), 'utf8')) : {})
const writeFake = (d: Record<string, Installed & { launched?: number }>) => writeFileSync(fakeFile(), JSON.stringify(d, null, 2))

const run = (file: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: String(out) }))
  })

const UNINSTALL_KEYS = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall']

/** Uninstall entries as name → value maps. */
async function uninstallEntries(): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = []
  for (const key of UNINSTALL_KEYS) {
    const { out: text } = await run('reg', ['query', key, '/s'])
    let cur: Record<string, string> | null = null
    for (const line of text.split(/\r?\n/)) {
      if (/^HKEY_/.test(line)) {
        if (cur) out.push(cur)
        cur = {}
        continue
      }
      const m = /^\s{4}(\S[^\t]*?)\s{4}REG_\w+\s{4}(.*)$/.exec(line)
      if (m && cur) cur[m[1]] = m[2]
    }
    if (cur) out.push(cur)
  }
  return out
}

/** The installed copy of `a`, or null. */
export async function findInstalled(a: CatalogApp): Promise<Installed | null> {
  if (fake) return readFake()[a.id] ?? null
  for (const e of await uninstallEntries()) {
    const name = e.DisplayName ?? ''
    if (name !== a.productName && !(name.startsWith(`${a.productName} `) && /^\d+\.\d+/.test(name.slice(a.productName.length + 1)))) continue
    // DisplayIcon is "<path to exe>,0"; InstallLocation is set by newer installers.
    const icon = (e.DisplayIcon ?? '').replace(/,\d+$/, '').replace(/^"|"$/g, '')
    const location = e.InstallLocation?.replace(/^"|"$/g, '') || (icon ? dirname(icon) : '')
    if (!location || !existsSync(join(location, a.exe))) continue
    return { version: e.DisplayVersion ?? '0.0.0', location, uninstall: e.QuietUninstallString ?? e.UninstallString ?? null }
  }
  return null
}

/** Is the app running? (Updating needs it closed.) */
export async function isRunning(a: CatalogApp): Promise<boolean> {
  if (fake) return false
  const { out } = await run('tasklist', ['/FI', `IMAGENAME eq ${a.exe}`, '/NH'])
  return out.toLowerCase().includes(a.exe.toLowerCase())
}

/** Runs a downloaded installer silently (per-user, default folder) and waits for it. */
export async function runInstaller(a: CatalogApp, installer: string, version: string): Promise<void> {
  if (fake) {
    const d = readFake()
    d[a.id] = { version, location: join(fake, a.id), uninstall: 'fake' }
    return writeFake(d)
  }
  const { code } = await run(installer, ['/S'])
  if (code !== 0) throw new Error(`The ${a.name} installer stopped with code ${code}.`)
}

export async function uninstall(a: CatalogApp, inst: Installed): Promise<void> {
  if (fake) {
    const d = readFake()
    delete d[a.id]
    return writeFake(d)
  }
  if (!inst.uninstall) throw new Error(`${a.name} has no uninstaller registered; remove it from Windows Settings → Apps.`)
  // UninstallString looks like: "C:\...\Uninstall Cadence+.exe" /currentuser
  const m = /^"([^"]+)"\s*(.*)$/.exec(inst.uninstall)
  const exe = m ? m[1] : inst.uninstall
  const args = (m ? m[2] : '').split(/\s+/).filter(Boolean)
  if (!args.includes('/S')) args.push('/S')
  const { code } = await run(exe, args)
  if (code !== 0) throw new Error(`The ${a.name} uninstaller stopped with code ${code}.`)
  // The NSIS uninstaller copies itself and returns before it finishes: wait for the files to go.
  for (let i = 0; i < 60 && existsSync(join(inst.location, a.exe)); i++) await new Promise((r) => setTimeout(r, 500))
}

export function launch(a: CatalogApp, inst: Installed): void {
  if (fake) {
    const d = readFake()
    if (d[a.id]) d[a.id].launched = Date.now()
    return writeFake(d)
  }
  spawn(join(inst.location, a.exe), [], { detached: true, stdio: 'ignore' }).unref()
}
