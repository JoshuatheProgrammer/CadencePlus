/**
 * Persistent app settings (JSON in the user data folder): recent files,
 * workspace layouts, keyboard shortcuts, preferences.
 */
import { existsSync, readFileSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let cache: Record<string, unknown> | null = null
let writeTimer: NodeJS.Timeout | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Record<string, unknown> {
  if (cache) return cache
  try {
    cache = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>) : {}
  } catch {
    cache = {}
  }
  return cache
}

export function setSetting(key: string, value: unknown): void {
  const s = getSettings()
  if (value === undefined) delete s[key]
  else s[key] = value
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    const tmp = file() + '.tmp'
    fsp
      .writeFile(tmp, JSON.stringify(s, null, 2))
      .then(() => fsp.rename(tmp, file()))
      .catch((e) => console.error('Failed to write settings', e))
  }, 200)
}

export function addRecent(path: string): string[] {
  const list = ((getSettings().recentFiles as string[]) ?? []).filter((p) => p.toLowerCase() !== path.toLowerCase())
  list.unshift(path)
  const trimmed = list.slice(0, 12)
  setSetting('recentFiles', trimmed)
  return trimmed
}

