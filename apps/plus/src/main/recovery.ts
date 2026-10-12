/**
 * Crash recovery: autosaved copies of unsaved documents live in
 * <userData>/Recovery as <id>.cadenceimg + <id>.json. They are deleted when
 * the document is saved, closed or discarded; anything left at start-up is
 * offered for recovery.
 */
import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RecoveryEntry, RecoveryMeta } from '@shared/ipc'

const dir = () => join(app.getPath('userData'), 'Recovery')
const safe = (id: string) => id.replace(/[^a-z0-9_-]/gi, '')

export async function writeRecovery(id: string, meta: RecoveryMeta, data: Uint8Array): Promise<void> {
  await fsp.mkdir(dir(), { recursive: true })
  const base = join(dir(), safe(id))
  const tmp = `${base}.cadenceimg.tmp`
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, `${base}.cadenceimg`)
  await fsp.writeFile(`${base}.json`, JSON.stringify({ ...meta, savedAt: Date.now() }))
}

export async function discardRecovery(id: string): Promise<void> {
  const base = join(dir(), safe(id))
  await fsp.rm(`${base}.cadenceimg`, { force: true })
  await fsp.rm(`${base}.json`, { force: true })
}

export async function listRecovery(): Promise<RecoveryEntry[]> {
  if (!existsSync(dir())) return []
  const out: RecoveryEntry[] = []
  for (const f of await fsp.readdir(dir())) {
    if (!f.endsWith('.json')) continue
    const id = f.slice(0, -5)
    const file = join(dir(), `${id}.cadenceimg`)
    if (!existsSync(file)) continue
    try {
      const meta = JSON.parse(await fsp.readFile(join(dir(), f), 'utf8')) as RecoveryMeta & { savedAt: number }
      out.push({ id, file, ...meta })
    } catch {
      /* unreadable entry: skip */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}
