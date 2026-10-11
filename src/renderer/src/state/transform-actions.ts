/**
 * Free Transform (Ctrl+T), Edit → Transform flips/rotations, and moving
 * selected pixels with the Move tool. While a transform is open the document
 * is unchanged; commit stores the result as one undo step.
 */
import { isIdentityParams, paramsForRect, paramsToMatrix, snapToPixelGrid, type Affine, type TransformParams } from '@core/affine'
import * as E from '@core/edit'
import { beginFloat, beginMultiFloat, commitFloat, commitMultiFloat, floatRect, floatSize, multiVectorParams } from '../engine/transform'
import { editDoc } from './doc-actions'
import { activeDocState, get, set, toast, useEditor, type EditorState } from './store'

type Active = NonNullable<EditorState['transform']>

export function transformMatrix(t: Active): Affine {
  const s = floatSize(t.fs)
  return paramsToMatrix(t.params, s.w, s.h)
}

export const transforming = (): boolean => !!get().transform

/** Lifts the active layer (or its selected pixels). Returns false and explains when it can't. */
export function startTransform(mode: 'transform' | 'move' = 'transform'): boolean {
  if (get().transform) return true
  const ds = activeDocState()
  if (!ds) return false
  const doc = ds.history.present
  const l = doc.layers.find((x) => x.id === doc.activeLayerId)
  if (!l) return false
  const what = mode === 'move' ? 'move its pixels' : 'transform it'
  if (l.locked) return toast(`“${l.name}” is locked. Unlock it to ${what}.`, 'warn'), false
  if (!l.visible) return toast(`“${l.name}” is hidden. Show it to ${what}.`, 'warn'), false
  if (l.content.type === 'fill') return toast(`“${l.name}” is a fill layer and covers the whole canvas; rasterize it to transform it.`, 'warn'), false
  if (l.content.type === 'adjustment') return toast('Adjustment layers have no pixels to transform.', 'warn'), false
  // A group, or several selected layers, transform together in one box.
  const sel = E.selectedLayerIds(doc)
  if (l.content.type === 'group' || sel.length > 1) {
    if (doc.selection) return toast('Transforming selected pixels works on one layer at a time. Deselect (Ctrl+D) to transform the layers whole.', 'warn'), false
    const ids = E.movableLayerIds(doc, sel.length > 1 ? sel : [l.id])
    const blocked = ids.map((id) => doc.layers.find((x) => x.id === id)!).find((x) => x.locked)
    if (blocked) return toast(`“${blocked.name}” is locked. Unlock it to ${what}.`, 'warn'), false
    const fs = beginMultiFloat(doc, ids, ds.id, l.id)
    if (!fs) return toast('There is nothing to transform in these layers.', 'warn'), false
    set({ transform: { fs, params: paramsForRect(fs.rect), mode }, crop: null })
    return true
  }
  if (doc.target === 'mask' && doc.selection) return toast('Transforming part of a mask is not supported yet. Click the layer thumbnail to transform pixels.', 'warn'), false
  const fs = beginFloat(doc, l, ds.id)
  if (!fs) return toast(doc.selection ? 'The selected area of this layer is empty.' : `“${l.name}” is empty — there is nothing to transform.`, 'warn'), false
  set({ transform: { fs, params: fs.kind === 'vector' ? fs.start : paramsForRect(floatRect(fs)), mode }, crop: null })
  return true
}

export function updateTransform(params: TransformParams): void {
  const t = get().transform
  if (t) set({ transform: { ...t, params } })
}

export function cancelTransform(): void {
  if (get().transform) set({ transform: null })
}

export function commitTransform(): void {
  const t = get().transform
  if (!t) return
  set({ transform: null })
  const fs = t.fs
  const ds = get().docs.find((d) => d.id === fs.docId)
  if (fs.kind === 'multi') {
    if (!ds || isIdentityParams(t.params, fs.rect)) return
    const doc = ds.history.present
    const m = transformMatrix(t)
    const r = commitMultiFloat(doc, fs, m)
    editDoc(ds.id, t.mode === 'move' ? 'Move' : 'Free Transform', (d) => {
      for (const [id, tiles] of Object.entries(r.tiles)) E.setLayerTiles(d, id, tiles)
      for (const [id, tiles] of Object.entries(r.masks)) {
        const ml = d.layers.find((x) => x.id === id)
        if (ml?.mask) ml.mask.tiles = tiles
      }
      for (const v of fs.vectors) E.setVectorParams(d, v.layerId, multiVectorParams(fs, v.start, t.params))
    })
    return
  }
  const l = ds?.history.present.layers.find((x) => x.id === fs.layerId)
  if (!ds || !l) return
  if (fs.kind === 'vector') {
    const same = (['cx', 'cy', 'sx', 'sy', 'rot'] as const).every((k) => t.params[k] === fs.start[k])
    if (!same) editDoc(ds.id, t.mode === 'move' ? 'Move' : 'Free Transform', (d) => E.setVectorParams(d, l.id, t.params))
    return
  }
  if (isIdentityParams(t.params, fs.pixels.rect)) return
  const r = commitFloat(l, fs, transformMatrix(t), ds.history.present.selection)
  editDoc(ds.id, t.mode === 'move' ? 'Move' : 'Free Transform', (d) => {
    E.setLayerTiles(d, l.id, r.tiles)
    if (r.maskTiles) E.setSurfaceTiles(d, l.id, 'mask', r.maskTiles)
    d.selection = r.selection
  })
}

export type QuickTransform = 'flipH' | 'flipV' | 'rot90' | 'rot180' | 'rot270'

const QUICK_LABEL: Record<QuickTransform, string> = { flipH: 'Flip Horizontal', flipV: 'Flip Vertical', rot90: 'Rotate 90° Clockwise', rot180: 'Rotate 180°', rot270: 'Rotate 90° Counter Clockwise' }
export const quickLabel = (q: QuickTransform) => QUICK_LABEL[q]

function applyQuick(t: Active, q: QuickTransform): TransformParams {
  const s = floatSize(t.fs)
  return snapToPixelGrid(rawQuick(t.params, q), s.w, s.h)
}

function rawQuick(p: TransformParams, q: QuickTransform): TransformParams {
  switch (q) {
    case 'flipH':
      return { ...p, sx: -p.sx }
    case 'flipV':
      return { ...p, sy: -p.sy }
    case 'rot90':
      return { ...p, rot: p.rot + Math.PI / 2 }
    case 'rot180':
      return { ...p, rot: p.rot + Math.PI }
    case 'rot270':
      return { ...p, rot: p.rot - Math.PI / 2 }
  }
}

/** Edit → Transform items: adjust an open transform, or apply immediately. */
export function quickTransform(q: QuickTransform): void {
  const open = get().transform
  if (open) return updateTransform(applyQuick(open, q))
  if (!startTransform()) return
  const t = get().transform!
  set({ transform: { ...t, params: applyQuick(t, q) } })
  commitTransform()
}

// Leaving the document or the canvas commits, like Photoshop's "apply transformation?".
let lastActive: string | null = null
useEditor.subscribe((s) => {
  if (s.activeId !== lastActive) {
    lastActive = s.activeId
    if (s.transform && s.transform.fs.docId !== s.activeId) commitTransform()
  }
})
