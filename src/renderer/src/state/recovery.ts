/**
 * Autosave for crash recovery. Every minute, and whenever the window loses
 * focus, each document with unsaved changes is written to the recovery
 * folder (never over the user's own file). Copies are removed when the
 * document is saved, closed or discarded; leftovers are offered at start-up.
 */
import { encodeProject, decodeProject } from '../engine/io'
import { addDocument, displayName, holdingTiles, setRecoveryHook } from './doc-actions'
import { confirm, get, isDirty, toast, updateDocState } from './store'

export const AUTOSAVE_MS = 60_000

/** Document id → history revision last written to the recovery folder. */
const written = new Map<string, number>()
let running = false

export async function autosaveNow(): Promise<number> {
  if (running) return 0
  running = true
  let count = 0
  try {
    const docs = get().docs
    for (const ds of docs) {
      const rev = ds.history.revision
      if (!isDirty(ds)) {
        if (written.has(ds.id)) {
          written.delete(ds.id)
          await window.cadencePlus.discardRecovery(ds.id)
        }
        continue
      }
      if (written.get(ds.id) === rev) continue
      const bytes = await encodeProject(ds.history.present, window.cadencePlus.versions.app)
      await window.cadencePlus.writeRecovery(ds.id, { name: displayName(ds), path: ds.path, sourcePath: ds.sourcePath }, bytes)
      // The document may have been saved or closed while we were writing.
      const now = get().docs.find((d) => d.id === ds.id)
      if (!now || !isDirty(now)) {
        await window.cadencePlus.discardRecovery(ds.id)
        continue
      }
      written.set(ds.id, rev)
      count++
    }
    for (const id of [...written.keys()]) if (!docs.some((d) => d.id === id)) written.delete(id)
  } catch (e) {
    console.error('Autosave failed', e)
  } finally {
    running = false
  }
  return count
}

/** Removes a document's recovery copy (saved, closed or discarded). */
export function forgetRecovery(id: string): void {
  written.delete(id)
  void window.cadencePlus.discardRecovery(id)
}

export function startAutosave(): () => void {
  setRecoveryHook(forgetRecovery)
  const t = window.setInterval(() => void autosaveNow(), AUTOSAVE_MS)
  const blur = () => void autosaveNow()
  window.addEventListener('blur', blur)
  return () => {
    clearInterval(t)
    window.removeEventListener('blur', blur)
  }
}

/** Offers documents left behind by a previous session that did not close cleanly. */
export async function offerRecovery(): Promise<void> {
  const list = await window.cadencePlus.listRecovery()
  if (!list.length) return
  const names = list.map((e) => `• ${e.name} — autosaved ${new Date(e.savedAt).toLocaleString()}`).join('\n')
  const v = await confirm(
    'Recover unsaved work',
    `Cadence+ did not close normally. These documents had unsaved changes:\n\n${names}\n\nRecovered documents open with their changes unsaved, so you can review and save them.`,
    [
      { label: 'Discard', value: 'discard', danger: true },
      { label: 'Recover', value: 'recover', primary: true }
    ]
  )
  for (const e of list) {
    if (v === 'recover') {
      try {
        await holdingTiles(async () => {
          const bytes = await window.cadencePlus.readFile(e.file)
          const doc = await decodeProject(bytes)
          addDocument(doc, { path: e.path, sourcePath: e.sourcePath, label: 'Recovered' })
          // Recovered work is unsaved until the user saves it.
          updateDocState(doc.id, (d) => ({ ...d, savedRevision: -1 }))
        })
      } catch (err) {
        toast(`Could not recover ${e.name}.\n${(err as Error).message}`, 'error')
        continue
      }
    }
    await window.cadencePlus.discardRecovery(e.id)
  }
  // Protect the recovered documents again straight away.
  if (v === 'recover') void autosaveNow()
}
