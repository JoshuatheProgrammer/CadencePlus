/**
 * Document lifecycle and history: edit(), undo/redo, new/open/save/close,
 * export, view commands, and tile garbage collection.
 */
import type { Draft } from 'immer'
import { EditError } from '@core/edit'
import { PROJECT_EXTENSION } from '@core/format'
import { apply, createHistory, jumpTo, redo as hRedo, replace, undo as hUndo } from '@core/history'
import { collectTileIds, createDocument, type ImageDocument } from '@core/model'
import { collectMaskIds } from '@core/selection'
import { clampZoom, fillView, fitView, formatZoom, nextZoomStep, type View } from '@core/view'
import { baseName, decodeImage, decodeProject, documentFromBitmap, encodeProject, exportImage, extOf, type ExportFormat } from '../engine/io'
import { collectGarbage, solidTiles } from '../engine/tiles'
import { activeDocState, confirm, get, isDirty, set, toast, updateDocState, type DocState } from './store'

export const DOC_HISTORY_STEPS = 50

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Applies an edit to the active document as one undo step. Returns false (and
 * shows why) if the edit was refused.
 */
export function edit(label: string, recipe: (d: Draft<ImageDocument>) => void, coalesce?: string): boolean {
  const ds = activeDocState()
  if (!ds) return false
  try {
    const h = apply(ds.history, label, recipe, coalesce)
    if (h !== ds.history) {
      updateDocState(ds.id, (d) => ({ ...d, history: h }))
      scheduleGc()
    }
    return true
  } catch (e) {
    if (e instanceof EditError) toast(e.message, 'warn')
    else {
      console.error(e)
      toast(`${label} failed: ${errorText(e)}`, 'error')
    }
    return false
  }
}

/** Changes the active document without an undo step (layer selection). */
export function silent(recipe: (d: Draft<ImageDocument>) => void): void {
  const ds = activeDocState()
  if (!ds) return
  const h = replace(ds.history, recipe)
  if (h !== ds.history) updateDocState(ds.id, (d) => ({ ...d, history: h }))
}

/** Runs `fn` and reports EditErrors as warnings; returns undefined on failure. */
export function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    if (e instanceof EditError) toast(e.message, 'warn')
    else {
      console.error(e)
      toast(errorText(e), 'error')
    }
    return undefined
  }
}

export function undo(): void {
  const ds = activeDocState()
  if (ds?.history.past.length) updateDocState(ds.id, (d) => ({ ...d, history: hUndo(d.history) }))
}

export function redo(): void {
  const ds = activeDocState()
  if (ds?.history.future.length) updateDocState(ds.id, (d) => ({ ...d, history: hRedo(d.history) }))
}

export function jumpToStep(index: number): void {
  const ds = activeDocState()
  if (ds) updateDocState(ds.id, (d) => ({ ...d, history: jumpTo(d.history, index) }))
}

// ---------------------------------------------------------------------------
// Tile garbage collection
// ---------------------------------------------------------------------------

let gcHold = 0
let gcTimer = 0

/** Prevents collection while async work holds tiles not yet in a document. */
export async function holdingTiles<T>(fn: () => Promise<T>): Promise<T> {
  gcHold++
  try {
    return await fn()
  } finally {
    gcHold--
  }
}

export function scheduleGc(): void {
  if (gcTimer) return
  gcTimer = window.setTimeout(() => {
    gcTimer = 0
    runGc()
  }, 1500)
}

export function runGc(): number {
  if (gcHold > 0) {
    scheduleGc()
    return 0
  }
  const tiles = new Set<string>()
  const masks = new Set<string>()
  for (const ds of get().docs) {
    const h = ds.history
    for (const doc of [...h.past.map((p) => p.state), h.present, ...h.future.map((f) => f.state)]) {
      collectTileIds(doc, tiles)
      collectMaskIds(doc.selection, masks)
    }
  }
  return collectGarbage(tiles, masks)
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Set by the recovery module: called when a document's recovery copy is no longer needed. */
let onDocumentClean: ((id: string) => void) | null = null
export function setRecoveryHook(fn: (id: string) => void): void {
  onDocumentClean = fn
}

export function displayName(ds: DocState): string {
  return ds.path ? baseName(ds.path) : ds.history.present.name
}

export function addDocument(doc: ImageDocument, opts: { path?: string | null; sourcePath?: string | null; label?: string } = {}): void {
  const ds: DocState = {
    id: doc.id,
    history: createHistory(doc, opts.label ?? 'Open', DOC_HISTORY_STEPS),
    view: null,
    path: opts.path ?? null,
    sourcePath: opts.sourcePath ?? null,
    savedRevision: 0
  }
  set((s) => ({ docs: [...s.docs, ds], activeId: ds.id, crop: null }))
}

export type BackgroundChoice = 'white' | 'black' | 'background' | 'transparent'

export function newDocument(o: { name: string; width: number; height: number; resolution: number; background: BackgroundChoice }): boolean {
  const color = o.background === 'white' ? '#ffffff' : o.background === 'black' ? '#000000' : o.background === 'background' ? get().bg : null
  try {
    const w = Math.round(o.width)
    const h = Math.round(o.height)
    const doc = createDocument({
      name: o.name,
      width: w,
      height: h,
      resolution: o.resolution,
      tiles: color ? solidTiles(w, h, color) : undefined,
      baseName: color ? 'Background' : 'Layer 1'
    })
    addDocument(doc, { label: 'New' })
    return true
  } catch (e) {
    toast(errorText(e), 'error')
    return false
  }
}

async function rememberRecent(path: string): Promise<void> {
  set({ recent: await window.cadencePlus.addRecent(path) })
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    const existing = get().docs.find((d) => d.path?.toLowerCase() === path.toLowerCase() || d.sourcePath?.toLowerCase() === path.toLowerCase())
    if (existing) {
      set({ activeId: existing.id })
      continue
    }
    const ext = extOf(path)
    set({ busy: `Opening ${baseName(path)}…` })
    try {
      await holdingTiles(async () => {
        const bytes = await window.cadencePlus.readFile(path)
        if (ext === PROJECT_EXTENSION) {
          const doc = await decodeProject(bytes)
          addDocument(doc, { path })
        } else {
          const bmp = await decodeImage(bytes, ext)
          const doc = documentFromBitmap(baseName(path), bmp)
          bmp.close()
          addDocument(doc, { sourcePath: path })
        }
      })
      void rememberRecent(path)
    } catch (e) {
      toast(`Could not open ${baseName(path)}.\n${errorText(e)}`, 'error')
    } finally {
      set({ busy: null })
    }
  }
}

export async function openDialog(): Promise<void> {
  const paths = await window.cadencePlus.openDialog()
  if (paths.length) await openPaths(paths)
}

/** Saves a document; returns false if cancelled or failed. */
export async function save(id = get().activeId, saveAs = false): Promise<boolean> {
  const ds = get().docs.find((d) => d.id === id)
  if (!ds) return false
  let path = ds.path
  if (!path || saveAs) path = await window.cadencePlus.saveDocumentDialog(displayName(ds))
  if (!path) return false
  const revision = ds.history.revision
  set({ busy: `Saving ${baseName(path)}…` })
  try {
    const bytes = await encodeProject(ds.history.present, window.cadencePlus.versions.app)
    await window.cadencePlus.writeFile(path, bytes, true)
    updateDocState(ds.id, (d) => ({ ...d, path, savedRevision: revision }))
    if (get().docs.find((d) => d.id === ds.id)?.history.revision === revision) onDocumentClean?.(ds.id)
    void rememberRecent(path)
    toast(`Saved ${baseName(path)} (${formatBytes(bytes.length)})`, 'success')
    return true
  } catch (e) {
    toast(`Could not save ${baseName(path)}.\n${errorText(e)}`, 'error')
    return false
  } finally {
    set({ busy: null })
  }
}

async function confirmDiscard(ds: DocState): Promise<boolean> {
  if (!isDirty(ds)) return true
  set({ activeId: ds.id })
  const v = await confirm('Unsaved changes', `Save changes to “${displayName(ds)}” before closing?`, [
    { label: 'Cancel', value: 'cancel' },
    { label: "Don't Save", value: 'discard', danger: true },
    { label: 'Save', value: 'save', primary: true }
  ])
  if (v === 'save') return save(ds.id)
  if (v === 'discard') onDocumentClean?.(ds.id)
  return v === 'discard'
}

export async function closeDocument(id = get().activeId): Promise<boolean> {
  const ds = get().docs.find((d) => d.id === id)
  if (!ds) return false
  if (!(await confirmDiscard(ds))) return false
  onDocumentClean?.(ds.id)
  set((s) => {
    const i = s.docs.findIndex((d) => d.id === id)
    const docs = s.docs.filter((d) => d.id !== id)
    const activeId = s.activeId === id ? (docs[i] ?? docs[i - 1])?.id ?? null : s.activeId
    return { docs, activeId, crop: s.activeId === id ? null : s.crop, stroke: null, filterPreview: null }
  })
  runGc()
  return true
}

export async function closeAll(): Promise<boolean> {
  for (const d of [...get().docs]) if (!(await closeDocument(d.id))) return false
  return true
}

/** Window close requested with unsaved work: confirm each dirty document. */
export async function confirmQuit(): Promise<boolean> {
  for (const ds of get().docs.filter(isDirty)) if (!(await confirmDiscard(ds))) return false
  return true
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export async function exportAs(format: ExportFormat, quality: number): Promise<boolean> {
  const ds = activeDocState()
  if (!ds) return false
  const ext = format === 'jpeg' ? 'jpg' : format
  const path = await window.cadencePlus.exportDialog(displayName(ds), ext)
  return path ? exportTo(path, format, quality) : false
}

export async function exportTo(path: string, format: ExportFormat, quality: number): Promise<boolean> {
  const ds = activeDocState()
  if (!ds) return false
  set({ busy: `Exporting ${baseName(path)}…` })
  try {
    const bytes = await exportImage(ds.history.present, format, quality)
    await window.cadencePlus.writeFile(path, bytes)
    toast(`Exported ${path.replace(/^.*[\\/]/, '')} (${formatBytes(bytes.length)})`, 'success')
    return true
  } catch (e) {
    toast(`Export failed.
${errorText(e)}`, 'error')
    return false
  } finally {
    set({ busy: null })
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function setView(id: string, view: View): void {
  updateDocState(id, (d) => ({ ...d, view }))
}

function withView(fn: (v: View, doc: ImageDocument, vw: number, vh: number) => View): void {
  const ds = activeDocState()
  if (!ds) return
  const { w, h } = get().viewport
  const doc = ds.history.present
  const v = ds.view ?? fitView(doc.width, doc.height, w, h)
  setView(ds.id, fn(v, doc, w, h))
}

export const zoomIn = () => withView((v) => ({ ...v, zoom: nextZoomStep(v.zoom, 1) }))
export const zoomOut = () => withView((v) => ({ ...v, zoom: nextZoomStep(v.zoom, -1) }))
export const fitOnScreen = () => withView((_v, d, w, h) => fitView(d.width, d.height, w, h))
export const fillScreen = () => withView((_v, d, w, h) => fillView(d.width, d.height, w, h))
export const actualPixels = () => withView((v) => ({ ...v, zoom: 1 }))
export const setZoom = (z: number) => withView((v) => ({ ...v, zoom: clampZoom(z) }))

export function titleFor(ds: DocState | null): string {
  if (!ds) return ''
  const doc = ds.history.present
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId)
  const part = doc.target === 'mask' && layer?.mask ? `${layer.name}, Layer Mask/8` : `${layer?.name ?? '—'}, RGB/8`
  return `${displayName(ds)}${isDirty(ds) ? ' •' : ''} @ ${formatZoom(ds.view?.zoom ?? 1)} (${part})`
}
