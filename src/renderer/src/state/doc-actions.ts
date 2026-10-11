/**
 * Document lifecycle and history: edit(), undo/redo, new/open/save/close,
 * export, view commands, and tile garbage collection.
 */
import type { Draft } from 'immer'
import { EditError } from '@core/edit'
import { PROJECT_EXTENSION } from '@core/format'
import { apply, createHistory, jumpTo, redo as hRedo, replace, undo as hUndo } from '@cadence/core/history'
import { collectTileIds, createDocument, DEFAULT_COLOR, docColor, type DocColor, type ImageDocument } from '@core/model'
import { collectMaskIds } from '@core/selection'
import { clampZoom, fillView, fitView, formatZoom, nextZoomStep, type View } from '@core/view'
import { presetFileName, presetScale, type ExportPreset } from '@core/export-presets'
import { baseName, decodeProject, encodeProject, EXPORT_EXTENSION, exportFile, extOf, importImage, type ExportFormat, type ExportOptions } from '../engine/io'
import { withFormat } from '../engine/format'
import { PROOF_LABELS } from '../engine/ops'
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
  return editDoc(get().activeId, label, recipe, coalesce)
}

/** edit() on a specific document. */
export function editDoc(docId: string | null, label: string, recipe: (d: Draft<ImageDocument>) => void, coalesce?: string): boolean {
  const ds = get().docs.find((d) => d.id === docId)
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
  // The History Brush source can outlive its history step.
  const hs = get().historySource
  if (hs && get().docs.some((d) => d.id === hs.docId)) collectTileIds(hs.state, tiles)
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

export function newDocument(o: { name: string; width: number; height: number; resolution: number; background: BackgroundChoice; color?: DocColor }): boolean {
  const color = o.background === 'white' ? '#ffffff' : o.background === 'black' ? '#000000' : o.background === 'background' ? get().bg : null
  try {
    const w = Math.round(o.width)
    const h = Math.round(o.height)
    const fmt = o.color ?? DEFAULT_COLOR
    const doc = createDocument({
      name: o.name,
      width: w,
      height: h,
      resolution: o.resolution,
      // The background tile is built in the new document's format.
      tiles: color ? withFormat(fmt, () => solidTiles(w, h, color)) : undefined,
      baseName: color ? 'Background' : 'Layer 1',
      color: fmt
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
          const { doc, note } = await importImage(bytes, ext, baseName(path))
          addDocument(doc, { sourcePath: path })
          if (note) toast(`${baseName(path)}: ${note}`, 'info')
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

export async function exportAs(format: ExportFormat, quality: number, opts: ExportOptions = {}): Promise<boolean> {
  const ds = activeDocState()
  if (!ds) return false
  const ext = EXPORT_EXTENSION[format]
  const path = await window.cadencePlus.exportDialog(displayName(ds), ext)
  return path ? exportTo(path, format, quality, opts) : false
}

/** Saves the preset list (dialog edits). */
export function setExportPresets(presets: ExportPreset[]): void {
  set({ exportPresets: presets })
  void window.cadencePlus.setSetting('exportPresets', presets)
}

/**
 * Exports the active document once per enabled preset into `folder`.
 * Returns the files written.
 */
export async function exportWithPresets(folder: string, presets = get().exportPresets.filter((p) => p.enabled)): Promise<string[]> {
  const ds = activeDocState()
  if (!ds || !presets.length) return []
  const d = ds.history.present
  const name = displayName(ds)
  const sep = folder.includes('/') && !folder.includes('\\') ? '/' : '\\'
  const written: string[] = []
  set({ busy: `Exporting ${presets.length} file${presets.length > 1 ? 's' : ''}…` })
  try {
    for (const p of presets) {
      const { bytes } = await exportFile(d, p.format, p.quality / 100, { scale: presetScale(p, d.width, d.height), sixteenBit: p.sixteenBit })
      const path = `${folder.replace(/[\\/]+$/, '')}${sep}${presetFileName(name, p)}`
      await window.cadencePlus.writeFile(path, bytes)
      written.push(path)
    }
    toast(`Exported ${written.length} file${written.length > 1 ? 's' : ''} to ${folder}`, 'success')
  } catch (e) {
    toast(`Export failed after ${written.length} file${written.length === 1 ? '' : 's'}.\n${errorText(e)}`, 'error')
  } finally {
    set({ busy: null })
  }
  return written
}

export async function exportTo(path: string, format: ExportFormat, quality: number, opts: ExportOptions = {}): Promise<boolean> {
  const ds = activeDocState()
  if (!ds) return false
  set({ busy: `Exporting ${baseName(path)}…` })
  try {
    const { bytes, note } = await exportFile(ds.history.present, format, quality, opts)
    await window.cadencePlus.writeFile(path, bytes)
    toast(`Exported ${path.replace(/^.*[\\/]/, '')} (${formatBytes(bytes.length)})${note ? `\n${note}` : ''}`, note ? 'info' : 'success')
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
  const bits = docColor(doc).depth
  const part = doc.quickMask ? `Quick Mask/8` : doc.target === 'mask' && layer?.mask ? `${layer.name}, Layer Mask/${bits}` : `${layer?.name ?? '—'}, RGB/${bits}`
  const s = get()
  const proof = s.proofOn ? `/${PROOF_LABELS[s.proofSetup]}` : ''
  return `${displayName(ds)}${isDirty(ds) ? ' •' : ''} @ ${formatZoom(ds.view?.zoom ?? 1)} (${part}${proof})`
}
