/**
 * Layer, selection, edit and image commands. Pixel work happens in the engine
 * first; the resulting tile maps are stored with a single edit() each.
 */
import { ADJUSTMENTS, defaultAdjustment, type Adjustment, type AdjustmentKind, type PixelOp } from '@core/adjustments'
import * as E from '@core/edit'
import { activeLayer, createDocument, docColor, TILE, type DocColor, type ImageDocument, type Rect, type TileMap } from '@core/model'
import { withFormat } from '../engine/format'
import { descendants, effectivelyVisible } from '@core/tree'
import * as S from '@core/selection'
import type { BrushOptions } from '../engine/brush'
import type { Stroke } from '../engine/brush'
import { canvasToPng, decodeImage } from '../engine/io'
import { rasterizeTiles, applyMaskTiles, applyToLayer, bucketSource, canvasSource, colorSource, copyPixels, filterLayer, invertMaskTiles, layerCanvas, maskTilesFromSelection, maskVisibility, mergeToTiles, sampleColor, transformLayers, wandMask, type DocTransform, type Source } from '../engine/pixels'
import { maskFromCanvas, selectionBounds } from '../engine/selection'
import { rasterToCanvas, releasePool, solidTiles, tilesFromCanvas } from '../engine/tiles'
import { addDocument, attempt, edit, holdingTiles, silent } from './doc-actions'
import { activeDoc, get, set, toast } from './store'

function doc(): ImageDocument | null {
  return activeDoc()
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export const newLayer = () => edit('New Layer', (d) => void E.addLayer(d))
export const newGroup = () => edit('New Group', (d) => void E.addGroup(d))

export function groupActive(): void {
  const d = doc()
  if (d?.activeLayerId) edit('Group Layers', (x) => void E.groupLayer(x, d.activeLayerId!))
}

export function ungroupActive(): void {
  const d = doc()
  const l = d && activeLayer(d)
  if (!l) return
  if (l.content.type !== 'group') return void toast(`“${l.name}” is not a group.`, 'warn')
  edit('Ungroup Layers', (x) => E.ungroup(x, l.id))
}

export const setCollapsed = (id: string, collapsed: boolean) => silent((d) => E.setCollapsed(d, id, collapsed))

/** Drops `id` into `parent` at flat position `to` (Layers panel drag). */
export const moveLayerInto = (id: string, parent: string | null, to: number) => edit('Reorder Layers', (d) => E.moveLayerInto(d, id, parent, to))
export const newFillLayer = (color = get().fg) => edit('New Fill Layer', (d) => void E.addLayer(d, { type: 'fill', color }, E.nextLayerName(d, 'Color Fill')))

export function newAdjustmentLayer(kind: AdjustmentKind): void {
  const a = defaultAdjustment(kind)
  edit(`New ${kindLabel(kind)} Layer`, (d) => void E.addLayer(d, { type: 'adjustment', adjustment: a }, E.nextLayerName(d, kindLabel(kind))))
}

function kindLabel(kind: AdjustmentKind): string {
  return ADJUSTMENTS[kind].label
}

export const selectLayer = (id: string, target: 'pixels' | 'mask' = 'pixels') => {
  if (get().maskView && get().maskView !== id) set({ maskView: null })
  silent((d) => {
    d.activeLayerId = id
    d.target = target === 'mask' && d.layers.find((l) => l.id === id)?.mask ? 'mask' : 'pixels'
  })
}

export function duplicateLayer(): void {
  const d = doc()
  if (d?.activeLayerId) edit('Duplicate Layer', (x) => void E.duplicateLayer(x, d.activeLayerId!))
}

export function deleteLayer(id = doc()?.activeLayerId): void {
  if (id) edit('Delete Layer', (x) => E.deleteLayer(x, id))
}

export const setLayerVisible = (id: string, v: boolean) => edit(v ? 'Show Layer' : 'Hide Layer', (d) => E.setLayerVisible(d, id, v))
export const setLayerLocked = (id: string, v: boolean) => edit(v ? 'Lock Layer' : 'Unlock Layer', (d) => E.setLayerLocked(d, id, v))
export const setLayerOpacity = (id: string, o: number) => edit('Layer Opacity', (d) => E.setLayerOpacity(d, id, o), `opacity:${id}`)
export const setLayerBlend = (id: string, b: Parameters<typeof E.setLayerBlend>[2]) => edit('Blend Mode', (d) => E.setLayerBlend(d, id, b))
export const renameLayer = (id: string, name: string) => edit('Rename Layer', (d) => E.renameLayer(d, id, name))
export const setFillColor = (id: string, c: string) => edit('Fill Color', (d) => E.setFillColor(d, id, c), `fill:${id}`)
export const setAdjustmentParams = (id: string, a: Adjustment) => edit('Adjustment', (d) => E.setAdjustment(d, id, a), `adj:${id}`)
export const setLayerPosition = (id: string, x: number, y: number, coalesce?: string) => edit('Move', (d) => E.setLayerPosition(d, id, x, y), coalesce)
export const moveLayerTo = (id: string, to: number) => edit('Reorder Layers', (d) => E.moveLayerTo(d, id, to))

export function reorderActive(dir: 1 | -1): void {
  const d = doc()
  if (d?.activeLayerId) edit(dir > 0 ? 'Bring Forward' : 'Send Backward', (x) => E.reorderLayer(x, d.activeLayerId!, dir))
}

export function nudgeActive(dx: number, dy: number): void {
  const d = doc()
  const l = d && activeLayer(d)
  if (!d || !l) return
  if (l.content.type === 'group') {
    const starts = E.positionsOf(d, descendants(d.layers, l.id).map((x) => x.id))
    return void edit('Nudge', (x) => E.offsetLayers(x, starts, dx, dy), `nudge:${l.id}:${Date.now()}`)
  }
  if (l.content.type === 'text' || l.content.type === 'shape') {
    const p = l.content.params
    return void edit('Nudge', (x) => E.setVectorParams(x, l.id, { ...p, cx: p.cx + dx, cy: p.cy + dy }), `nudge:${l.id}`)
  }
  if (l.content.type !== 'raster') return void toast(`“${l.name}” covers the whole canvas and cannot be moved.`, 'warn')
  edit('Nudge', (x) => E.setLayerPosition(x, l.id, (l.content as { x: number }).x + dx, (l.content as { y: number }).y + dy), `nudge:${l.id}`)
}

export function mergeDown(): void {
  const d = doc()
  const a = d && activeLayer(d)
  if (!d || !a) return
  // With a group active, Ctrl+E merges the group into one layer.
  if (a.content.type === 'group') {
    if (!effectivelyVisible(d, a)) return void toast('Show the group to merge it.', 'warn')
    const tiles = mergeToTiles(d, [a])
    return void edit('Merge Group', (x) => void E.replaceWithMerged(x, [a.id], { name: a.name, tiles, x: 0, y: 0 }))
  }
  const sibs = d.layers.filter((l) => (l.parent ?? null) === (a.parent ?? null))
  const below = sibs[sibs.indexOf(a) - 1]
  if (!below) return void toast('There is no layer below to merge into.', 'warn')
  const pair = [below, a]
  if (pair.some((l) => !l.visible)) return void toast('Both layers must be visible to merge.', 'warn')
  const tiles = mergeToTiles(d, pair)
  edit('Merge Down', (x) => void E.replaceWithMerged(x, pair.map((l) => l.id), { name: pair[0].name, tiles, x: 0, y: 0 }))
}

export function mergeVisible(): void {
  const d = doc()
  if (!d) return
  const vis = d.layers.filter((l) => effectivelyVisible(d, l))
  if (vis.filter((l) => l.content.type !== 'group').length < 2) return void toast('Merge Visible needs at least two visible layers.', 'warn')
  const tiles = mergeToTiles(d, vis)
  edit('Merge Visible', (x) => void E.replaceWithMerged(x, vis.map((l) => l.id), { name: vis[0].name, tiles, x: 0, y: 0 }))
}

export function flattenImage(): void {
  const d = doc()
  if (!d) return
  // Flatten fills transparency with white and discards hidden layers, like Photoshop.
  const tiles = mergeToTiles(d, d.layers, '#ffffff')
  edit('Flatten Image', (x) => E.flattenDocument(x, tiles))
}

export function rasterizeActive(): void {
  const d = doc()
  const l = d && activeLayer(d)
  if (!d || !l) return
  if (l.content.type === 'raster') return void toast(`“${l.name}” is already a pixel layer.`, 'warn')
  if (l.content.type === 'adjustment') return void toast('Adjustment layers have no pixels of their own to rasterize.', 'warn')
  const tiles = rasterizeTiles(d, l)
  edit('Rasterize Layer', (x) => E.rasterizeLayer(x, l.id, tiles))
}

/** Ctrl+J: copy the selection to a new layer (or duplicate the layer when nothing is selected). */
export function layerViaCopy(cut = false): void {
  const d = doc()
  if (!d) return
  if (!d.selection) return cut ? void toast('Make a selection first.', 'warn') : duplicateLayer()
  const l = attempt(() => E.rasterTarget(d, cut ? 'cut from it' : 'copy from it'))
  if (!l) return
  const px = copyPixels(d, false)
  if (!px) return void toast('The selected area is empty.', 'warn')
  const tiles = tilesFromCanvas(px.canvas, px.x, px.y, 0, 0)
  const cutTiles = cut ? applyToLayer(d, l.content, colorSource('#000'), { x: 0, y: 0, w: d.width, h: d.height }, 'erase') : null
  edit(cut ? 'Layer via Cut' : 'Layer via Copy', (x) => {
    if (cutTiles) E.setLayerTiles(x, l.id, cutTiles)
    E.addLayer(x, { type: 'raster', x: 0, y: 0, tiles })
  })
}

/** Ctrl+click a layer thumbnail: select its opaque pixels. */
export function selectLayerPixels(id: string): void {
  const d = doc()
  const l = d?.layers.find((x) => x.id === id)
  if (!d || !l || l.content.type === 'adjustment') return
  const maskId = maskFromCanvas(layerCanvas(d, l, 'selpx'))
  edit('Load Selection', (x) => E.setSelection(x, { steps: [{ op: 'add', shape: { kind: 'mask', maskId, x: 0, y: 0 } }] }))
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function selectAll(): void {
  const d = doc()
  if (d) edit('Select All', (x) => E.setSelection(x, S.selectAll(d.width, d.height)))
}

export function deselect(): void {
  if (doc()?.selection) edit('Deselect', (x) => E.setSelection(x, null))
}

export function invertSelection(): void {
  const d = doc()
  if (!d) return
  if (!d.selection) return void toast('There is no selection to invert.', 'warn')
  edit('Inverse', (x) => E.setSelection(x, S.invert(d.selection)))
}

export function featherSelection(radius: number): void {
  const d = doc()
  if (d?.selection) edit('Feather', (x) => E.setSelection(x, S.feather(d.selection, radius)))
}

export function addSelectionShape(shape: S.SelShape, mode: S.SelMode, label: string): void {
  const d = doc()
  if (d) edit(label, (x) => E.setSelection(x, S.combine(d.selection, mode, shape)))
}

export function wandSelect(x: number, y: number, mode: S.SelMode): void {
  const d = doc()
  if (!d) return
  const o = get().options.wand
  const r = wandMask(d, x, y, o.tolerance, o.contiguous, o.sampleAll)
  if (!r) {
    if (mode === 'replace') deselect()
    return
  }
  addSelectionShape({ kind: 'mask', maskId: r.maskId, x: 0, y: 0 }, mode, 'Magic Wand')
}

export function cropToSelection(): void {
  const d = doc()
  if (!d) return
  if (!d.selection) return void toast('Make a selection first.', 'warn')
  const b = selectionBounds(d.selection, d.width, d.height)
  if (!b) return void toast('The selection is empty.', 'warn')
  edit('Crop', (x) => E.cropDocument(x, b))
}

export function crop(r: Rect): void {
  edit('Crop', (x) => E.cropDocument(x, r))
}

// ---------------------------------------------------------------------------
// Painting & filling
// ---------------------------------------------------------------------------

/**
 * Where painting goes (the active layer's pixels, or its mask when the mask
 * is targeted), or null after explaining why nothing can be painted.
 */
export function paintTarget(what = 'paint on it'): E.PaintTarget | null {
  const d = doc()
  if (!d) return null
  return attempt(() => E.paintSurface(d, what)) ?? null
}

/** 'over' paints colour on pixels; on masks the colour's darkness is painted instead. */
const paintMode = (t: E.PaintTarget) => (t.kind === 'mask' ? 'mask' : 'over')

export function commitStroke(stroke: Stroke, label: string): void {
  const d = doc()
  const t = d && paintTarget()
  if (!d || !t || !stroke.bounds) return
  const tiles = applyToLayer(d, t.surface, canvasSource(stroke.canvas), stroke.bounds, stroke.erase ? 'erase' : paintMode(t), stroke.opacity)
  edit(label, (x) => E.setSurfaceTiles(x, t.layer.id, t.kind, tiles))
}

/** Paints finished pixels (Clone Stamp, Healing Brush) onto the target within `bounds`. */
export function commitPixels(px: OffscreenCanvas, bounds: Rect, opacity: number, label: string): void {
  const d = doc()
  const t = d && paintTarget()
  if (!d || !t) return
  const tiles = applyToLayer(d, t.surface, canvasSource(px), bounds, 'over', opacity)
  edit(label, (x) => E.setSurfaceTiles(x, t.layer.id, t.kind, tiles))
}

function fillArea(source: Source, mode: 'over' | 'erase', opacity: number, label: string): void {
  const d = doc()
  const t = d && paintTarget(mode === 'erase' ? 'clear it' : 'fill it')
  if (!d || !t) return
  const r = d.selection ? selectionBounds(d.selection, d.width, d.height) : { x: 0, y: 0, w: d.width, h: d.height }
  if (!r) return void toast('The selection is empty.', 'warn')
  const tiles = applyToLayer(d, t.surface, source, r, mode === 'erase' ? 'erase' : paintMode(t), opacity)
  edit(label, (x) => E.setSurfaceTiles(x, t.layer.id, t.kind, tiles))
}

export const fillWith = (color: string) => fillArea(colorSource(color), 'over', 1, 'Fill')
export const clearSelected = () => fillArea(colorSource('#000'), 'erase', 1, 'Clear')

export function bucketFill(x: number, y: number): void {
  const d = doc()
  const t = d && paintTarget('fill it')
  if (!d || !t) return
  if (t.kind === 'mask') return void toast('The Paint Bucket fills pixels. To fill a mask, select an area and use Edit → Fill.', 'warn')
  const o = get().options.bucket
  const r = bucketSource(d, x, y, o.tolerance, o.contiguous, o.sampleAll, get().fg)
  if (!r) return
  const tiles = applyToLayer(d, t.surface, r.source, r.bounds, 'over', o.opacity / 100)
  edit('Paint Bucket', (z) => E.setSurfaceTiles(z, t.layer.id, t.kind, tiles))
}

export function gradientFill(x0: number, y0: number, x1: number, y1: number): void {
  const d = doc()
  const t = d && paintTarget('draw a gradient on it')
  if (!d || !t) return
  const s = get()
  const o = s.options.gradient
  let a = s.fg
  let b = o.toTransparent ? s.fg + '00' : s.bg
  if (o.reverse) [a, b] = [b, a]
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 1) return
  const source: Source = (g, ox, oy) => {
    g.save()
    g.translate(-ox, -oy)
    const grad = o.kind === 'linear' ? g.createLinearGradient(x0, y0, x1, y1) : g.createRadialGradient(x0, y0, 0, x0, y0, len)
    grad.addColorStop(0, a)
    grad.addColorStop(1, b)
    g.fillStyle = grad
    g.fillRect(ox, oy, TILE, TILE)
    g.restore()
  }
  const r = d.selection ? selectionBounds(d.selection, d.width, d.height) : { x: 0, y: 0, w: d.width, h: d.height }
  if (!r) return
  const tiles = applyToLayer(d, t.surface, source, r, paintMode(t), o.opacity / 100)
  edit('Gradient', (z) => E.setSurfaceTiles(z, t.layer.id, t.kind, tiles))
}

export function pickColor(x: number, y: number, toBackground: boolean): void {
  const d = doc()
  if (!d) return
  const o = get().options.eyedropper
  const c = sampleColor(d, x, y, o.sampleAll, o.size)
  if (c) set(toBackground ? { bg: c } : { fg: c })
}

// ---------------------------------------------------------------------------
// Adjustments, filters & image transforms
// ---------------------------------------------------------------------------

/** Colour adjustments only make sense on pixels; blur also works on masks. */
export function applyFilter(filter: PixelOp, label: string): void {
  const d = doc()
  const t = d && paintTarget('apply an adjustment')
  if (!d || !t || filter === 'none') return
  if (t.kind === 'mask' && !(typeof filter === 'string' && /^blur\(/.test(filter))) return void toast(`${label} changes colours, so it applies to pixels, not masks. Click the layer thumbnail to target its pixels.`, 'warn')
  const tiles = filterLayer(d, t.surface, filter)
  edit(label, (x) => E.setSurfaceTiles(x, t.layer.id, t.kind, tiles))
}

/** Ctrl+I: inverts the targeted mask, or the pixels. */
export function invertTarget(): void {
  const d = doc()
  const t = d && paintTarget('invert it')
  if (!d || !t) return
  if (t.kind === 'pixels') return applyFilter('invert(1)', 'Invert')
  const tiles = invertMaskTiles(d, t.surface)
  edit('Invert Mask', (x) => E.setSurfaceTiles(x, t.layer.id, 'mask', tiles))
}

export function transformImage(t: DocTransform, label: string): void {
  const d = doc()
  if (!d) return
  const r = attempt(() => transformLayers(d, t))
  if (r) edit(label, (x) => E.transformDocument(x, r.width, r.height, r.layers, r.masks, r.vectors))
}

// ---------------------------------------------------------------------------
// Layer masks
// ---------------------------------------------------------------------------

export type MaskKind = 'revealAll' | 'hideAll' | 'revealSelection' | 'hideSelection'

export function addLayerMask(kind: MaskKind = doc()?.selection ? 'revealSelection' : 'revealAll'): void {
  const d = doc()
  const l = d && activeLayer(d)
  if (!d || !l) return
  if (l.mask) return void toast(`“${l.name}” already has a mask.`, 'warn')
  if ((kind === 'revealSelection' || kind === 'hideSelection') && !d.selection) return void toast('Make a selection first.', 'warn')
  const tiles = kind === 'revealAll' ? {} : kind === 'hideAll' ? solidTiles(d.width, d.height, '#000000') : maskTilesFromSelection(d, kind === 'hideSelection')
  const label = { revealAll: 'Add Layer Mask', hideAll: 'Add Layer Mask (Hide All)', revealSelection: 'Add Layer Mask (Reveal Selection)', hideSelection: 'Add Layer Mask (Hide Selection)' }[kind]
  edit(label, (x) => {
    E.addMask(x, l.id, tiles)
    if (kind === 'revealSelection' || kind === 'hideSelection') x.selection = null
  })
}

export function deleteLayerMask(id = doc()?.activeLayerId): void {
  if (id) edit('Delete Layer Mask', (x) => E.deleteMask(x, id))
}

export function applyLayerMask(id = doc()?.activeLayerId): void {
  const d = doc()
  const l = d?.layers.find((x) => x.id === id)
  if (!d || !l) return
  if (!l.mask) return void toast(`“${l.name}” has no mask.`, 'warn')
  if (l.content.type !== 'raster') return void toast('Only pixel layers can have their mask applied; on other layers the mask stays editable.', 'warn')
  const tiles = applyMaskTiles(l.content, l.mask)
  edit('Apply Layer Mask', (x) => E.applyMask(x, l.id, tiles))
}

export function setMaskEnabled(id: string, enabled: boolean): void {
  edit(enabled ? 'Enable Layer Mask' : 'Disable Layer Mask', (x) => E.setMaskEnabled(x, id, enabled))
}

/** Loads the visible part of a layer's mask as the selection. */
export function maskToSelection(id: string): void {
  const d = doc()
  const l = d?.layers.find((x) => x.id === id)
  if (!d || !l?.mask) return
  const maskId = maskFromCanvas(maskVisibility(d, l.mask))
  edit('Load Selection', (x) => E.setSelection(x, { steps: [{ op: 'add', shape: { kind: 'mask', maskId, x: 0, y: 0 } }] }))
}

/**
 * Image → Mode / Convert to Profile: every pixel layer and mask is redrawn
 * into canvases of the new format (Chromium converts colour spaces), then
 * re-tiled. One undo step.
 */
export function convertDocColor(color: DocColor, label: string): void {
  const d = doc()
  if (!d) return
  const cur = docColor(d)
  if (cur.depth === color.depth && cur.space === color.space) return
  if (transformingLock()) return
  const r = withFormat(color, () => {
    const layers: Record<string, TileMap> = {}
    const masks: Record<string, TileMap> = {}
    for (const l of d.layers) {
      if (l.content.type === 'raster') {
        const c = rasterToCanvas(l.content, 'convert')
        layers[l.id] = c ? tilesFromCanvas(c.canvas, c.rect.x, c.rect.y, l.content.x, l.content.y) : {}
      }
      if (l.mask) {
        const c = rasterToCanvas(l.mask, 'convert')
        masks[l.id] = c ? tilesFromCanvas(c.canvas, c.rect.x, c.rect.y, l.mask.x, l.mask.y) : {}
      }
    }
    releasePool('convert')
    return { layers, masks }
  })
  edit(label, (x) => E.convertColor(x, color, r.layers, r.masks))
}

const transformingLock = () => !!get().transform && (toast('Commit or cancel the transform first.', 'warn'), true)

export function resizeCanvas(w: number, h: number, ax: number, ay: number): void {
  edit('Canvas Size', (x) => E.resizeCanvas(x, w, h, ax, ay))
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Where the last copy came from, to paste back in place. */
let lastCopy: { w: number; h: number; x: number; y: number } | null = null

export async function copy(merged = false, cut = false): Promise<void> {
  const d = doc()
  if (!d) return
  if (!merged && !attempt(() => E.rasterTarget(d, cut ? 'cut from it' : 'copy from it'))) return
  const px = copyPixels(d, merged)
  if (!px) return void toast('The selected area is empty.', 'warn')
  lastCopy = { w: px.canvas.width, h: px.canvas.height, x: px.x, y: px.y }
  await window.cadencePlus.clipboardWriteImage(await canvasToPng(px.canvas))
  if (cut) clearSelected()
}

export async function paste(): Promise<void> {
  const png = await window.cadencePlus.clipboardReadImage()
  if (!png) return void toast('The clipboard does not contain an image.', 'warn')
  await holdingTiles(async () => {
    const bmp = await decodeImage(png, 'png')
    const d = doc()
    if (!d) {
      const tiles = tilesFromCanvas(bmp, 0, 0, 0, 0)
      addDocument(createDocument({ name: 'Pasted', width: bmp.width, height: bmp.height, tiles, baseName: 'Layer 1' }), { label: 'New from Clipboard' })
      bmp.close()
      return
    }
    let x = Math.round((d.width - bmp.width) / 2)
    let y = Math.round((d.height - bmp.height) / 2)
    if (lastCopy && lastCopy.w === bmp.width && lastCopy.h === bmp.height) ({ x, y } = lastCopy)
    const tiles = tilesFromCanvas(bmp, x, y, 0, 0)
    bmp.close()
    edit('Paste', (z) => void E.addLayer(z, { type: 'raster', x: 0, y: 0, tiles }))
  })
}

// ---------------------------------------------------------------------------
// Tool settings shortcuts
// ---------------------------------------------------------------------------

/** [ and ]: brush size steps like Photoshop's. */
export function stepBrushSize(dir: 1 | -1): void {
  const s = get()
  const key = s.tool === 'eraser' || s.tool === 'clone' || s.tool === 'heal' ? s.tool : 'brush'
  const cur = s.options[key].size
  const step = cur < 10 ? 1 : cur < 50 ? 5 : cur < 100 ? 10 : cur < 300 ? 25 : 50
  const size = Math.max(1, Math.min(2500, cur + dir * step))
  set({ options: { ...s.options, [key]: { ...s.options[key], size } as BrushOptions } })
}

export function stepHardness(dir: 1 | -1): void {
  const s = get()
  const key = s.tool === 'eraser' || s.tool === 'clone' || s.tool === 'heal' ? s.tool : 'brush'
  const hardness = Math.max(0, Math.min(100, s.options[key].hardness + dir * 25))
  set({ options: { ...s.options, [key]: { ...s.options[key], hardness } } })
}

export const swapColors = () => set((s) => ({ fg: s.bg, bg: s.fg }))
export const defaultColors = () => set({ fg: '#000000', bg: '#ffffff' })
