/**
 * Every document edit as a function on an Immer draft. A failed edit throws
 * EditError, which leaves history untouched and becomes a friendly message.
 * Pixel-producing edits receive tile maps already built by the renderer.
 */
import type { Adjustment } from './adjustments'
import { checkDimensions, createLayer, findLayer, isVector, uid, type BlendMode, type ImageDocument, type Layer, type LayerContent, type LayerMask, type Rect, type TileMap, type TileSurface } from './model'
import type { TransformParams } from './affine'
import { translate, type Selection } from './selection'
import { keepTopLeft, type ShapeData, type TextData } from './vector'

export class EditError extends Error {}

export function layer(doc: ImageDocument, id: string | null): Layer {
  const l = findLayer(doc, id)
  if (!l) throw new EditError(id ? 'That layer no longer exists.' : 'Select a layer first.')
  return l
}

export function unlocked(doc: ImageDocument, id: string | null, what: string): Layer {
  const l = layer(doc, id)
  if (l.locked) throw new EditError(`“${l.name}” is locked. Unlock it to ${what}.`)
  return l
}

/** The active layer, which must be an unlocked pixel layer. */
export function rasterTarget(doc: ImageDocument, what: string): Layer & { content: Extract<LayerContent, { type: 'raster' }> } {
  const l = unlocked(doc, doc.activeLayerId, what)
  if (l.content.type !== 'raster') {
    const kind = { fill: 'a fill layer', adjustment: 'an adjustment layer', text: 'a type layer', shape: 'a shape layer' }[l.content.type]
    const fix = l.content.type === 'adjustment' ? 'Choose a pixel layer' : 'Choose a pixel layer, or rasterize it (Layer → Rasterize Layer)'
    throw new EditError(`“${l.name}” is ${kind}. ${fix} to ${what}.`)
  }
  if (!l.visible) throw new EditError(`“${l.name}” is hidden. Show it to ${what}.`)
  return l as Layer & { content: Extract<LayerContent, { type: 'raster' }> }
}

export type PaintTarget = { layer: Layer; kind: 'pixels' | 'mask'; surface: TileSurface }

/**
 * Where painting goes: the active layer's mask when it is targeted, else its
 * pixels (which must be a raster layer). Explains refusals with EditError.
 */
export function paintSurface(doc: ImageDocument, what: string): PaintTarget {
  const l = layer(doc, doc.activeLayerId)
  if (doc.target === 'mask' && l.mask) {
    if (l.locked) throw new EditError(`“${l.name}” is locked. Unlock it to ${what}.`)
    if (!l.visible) throw new EditError(`“${l.name}” is hidden. Show it to ${what}.`)
    return { layer: l, kind: 'mask', surface: l.mask }
  }
  const r = rasterTarget(doc, what)
  return { layer: r, kind: 'pixels', surface: r.content }
}

/** Stores new tiles for a paint target. */
export function setSurfaceTiles(doc: ImageDocument, id: string, kind: 'pixels' | 'mask', tiles: TileMap): void {
  const l = layer(doc, id)
  if (kind === 'mask') {
    if (!l.mask) throw new EditError(`“${l.name}” has no mask.`)
    l.mask.tiles = tiles
  } else setLayerTiles(doc, id, tiles)
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

export function addMask(doc: ImageDocument, id: string, tiles: TileMap = {}): void {
  const l = unlocked(doc, id, 'add a mask')
  if (l.mask) throw new EditError(`“${l.name}” already has a mask.`)
  l.mask = { x: 0, y: 0, tiles, enabled: true }
  doc.activeLayerId = id
  doc.target = 'mask'
}

export function deleteMask(doc: ImageDocument, id: string): void {
  const l = unlocked(doc, id, 'delete its mask')
  if (!l.mask) throw new EditError(`“${l.name}” has no mask.`)
  l.mask = null
  if (doc.activeLayerId === id) doc.target = 'pixels'
}

export function setMaskEnabled(doc: ImageDocument, id: string, enabled: boolean): void {
  const l = layer(doc, id)
  if (!l.mask) throw new EditError(`“${l.name}” has no mask.`)
  l.mask.enabled = enabled
}

/** Bakes the mask into the layer's pixels (tiles computed by the renderer). */
export function applyMask(doc: ImageDocument, id: string, tiles: TileMap): void {
  const l = unlocked(doc, id, 'apply its mask')
  if (!l.mask) throw new EditError(`“${l.name}” has no mask.`)
  if (l.content.type !== 'raster') throw new EditError('Only pixel layers can have their mask applied; on other layers the mask stays editable.')
  l.content.tiles = tiles
  l.mask = null
  doc.target = 'pixels'
}

export function setTarget(doc: ImageDocument, target: 'pixels' | 'mask'): void {
  const l = layer(doc, doc.activeLayerId)
  doc.target = target === 'mask' && l.mask ? 'mask' : 'pixels'
}

function shiftMask(m: LayerMask | null | undefined, dx: number, dy: number): void {
  if (m) {
    m.x += dx
    m.y += dy
  }
}

export function nextLayerName(doc: ImageDocument, base = 'Layer'): string {
  let n = 1
  const names = new Set(doc.layers.map((l) => l.name))
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

function insertAboveActive(doc: ImageDocument, l: Layer): string {
  const at = doc.layers.findIndex((x) => x.id === doc.activeLayerId)
  doc.layers.splice(at < 0 ? doc.layers.length : at + 1, 0, l)
  doc.activeLayerId = l.id
  doc.target = 'pixels'
  return l.id
}

/** Adds a layer above the active one and makes it active. */
export function addLayer(doc: ImageDocument, content?: LayerContent, name?: string): string {
  return insertAboveActive(doc, createLayer(name ?? nextLayerName(doc), content))
}

export function duplicateLayer(doc: ImageDocument, id: string): string {
  const src = layer(doc, id)
  const copy: Layer = { ...structuredClone(src), id: uid('layer'), name: `${src.name} copy`, locked: false }
  doc.layers.splice(doc.layers.indexOf(src) + 1, 0, copy)
  doc.activeLayerId = copy.id
  return copy.id
}

export function deleteLayer(doc: ImageDocument, id: string): void {
  const l = unlocked(doc, id, 'delete it')
  if (doc.layers.length === 1) throw new EditError('A document needs at least one layer.')
  const i = doc.layers.indexOf(l)
  doc.layers.splice(i, 1)
  if (doc.activeLayerId === id) {
    doc.activeLayerId = (doc.layers[i] ?? doc.layers[i - 1]).id
    doc.target = 'pixels'
  }
}

export function renameLayer(doc: ImageDocument, id: string, name: string): void {
  const n = name.trim()
  if (!n) throw new EditError('A layer name cannot be empty.')
  layer(doc, id).name = n
}

export function setLayerVisible(doc: ImageDocument, id: string, visible: boolean): void {
  layer(doc, id).visible = visible
}

export function setLayerLocked(doc: ImageDocument, id: string, locked: boolean): void {
  layer(doc, id).locked = locked
}

export function setLayerOpacity(doc: ImageDocument, id: string, opacity: number): void {
  unlocked(doc, id, 'change its opacity').opacity = Math.min(1, Math.max(0, opacity))
}

export function setLayerBlend(doc: ImageDocument, id: string, blend: BlendMode): void {
  unlocked(doc, id, 'change its blend mode').blend = blend
}

export function setFillColor(doc: ImageDocument, id: string, color: string): void {
  const l = unlocked(doc, id, 'change its colour')
  if (l.content.type !== 'fill') throw new EditError('Only fill layers have a colour.')
  l.content.color = color
}

export function setAdjustment(doc: ImageDocument, id: string, adjustment: Adjustment): void {
  const l = unlocked(doc, id, 'change its settings')
  if (l.content.type !== 'adjustment') throw new EditError('Only adjustment layers have adjustment settings.')
  l.content.adjustment = adjustment
}

/** Moves a raster layer to an absolute document position. */
export function setLayerPosition(doc: ImageDocument, id: string, x: number, y: number): void {
  const l = unlocked(doc, id, 'move it')
  if (l.content.type !== 'raster') throw new EditError(`“${l.name}” covers the whole canvas and cannot be moved.`)
  const nx = Math.round(x)
  const ny = Math.round(y)
  shiftMask(l.mask, nx - l.content.x, ny - l.content.y)
  l.content.x = nx
  l.content.y = ny
}

/** Places a type or shape layer. */
export function setVectorParams(doc: ImageDocument, id: string, params: TransformParams): void {
  const l = unlocked(doc, id, 'move it')
  if (!isVector(l.content)) throw new EditError(`“${l.name}” is not a type or shape layer.`)
  const dx = params.cx - l.content.params.cx
  const dy = params.cy - l.content.params.cy
  // A plain move carries the mask along, as for pixel layers.
  if (params.sx === l.content.params.sx && params.sy === l.content.params.sy && params.rot === l.content.params.rot) shiftMask(l.mask, dx, dy)
  l.content.params = params
}

/** Changes a type layer's text or style; `oldSize`/`newSize` keep its top-left corner in place. */
export function setText(doc: ImageDocument, id: string, text: TextData, oldSize: { w: number; h: number }, newSize: { w: number; h: number }): void {
  const l = unlocked(doc, id, 'edit its text')
  if (l.content.type !== 'text') throw new EditError(`“${l.name}” is not a type layer.`)
  l.content.params = keepTopLeft(l.content.params, oldSize.w, oldSize.h, newSize.w, newSize.h)
  l.content.text = text
}

export function setShape(doc: ImageDocument, id: string, shape: ShapeData): void {
  const l = unlocked(doc, id, 'edit the shape')
  if (l.content.type !== 'shape') throw new EditError(`“${l.name}” is not a shape layer.`)
  l.content.params = keepTopLeft(l.content.params, l.content.shape.w, l.content.shape.h, shape.w, shape.h)
  l.content.shape = shape
}

/** Replaces a raster layer's tiles (the result of painting, filters, …). */
export function setLayerTiles(doc: ImageDocument, id: string, tiles: TileMap, x?: number, y?: number): void {
  const l = layer(doc, id)
  if (l.content.type !== 'raster') throw new EditError(`“${l.name}” is not a pixel layer.`)
  l.content.tiles = tiles
  if (x !== undefined) l.content.x = x
  if (y !== undefined) l.content.y = y
}

/** Turns a fill, type or shape layer into pixels (tiles built by the renderer). */
export function rasterizeLayer(doc: ImageDocument, id: string, tiles: TileMap): void {
  const l = unlocked(doc, id, 'rasterize it')
  if (l.content.type === 'raster') throw new EditError(`“${l.name}” is already a pixel layer.`)
  if (l.content.type === 'adjustment') throw new EditError('Adjustment layers have no pixels of their own to rasterize.')
  l.content = { type: 'raster', x: 0, y: 0, tiles }
}

/** Moves a layer one step up (+1) or down (-1) in the stack. */
export function reorderLayer(doc: ImageDocument, id: string, dir: 1 | -1): void {
  const l = layer(doc, id)
  const i = doc.layers.indexOf(l)
  const j = i + dir
  if (j < 0 || j >= doc.layers.length) throw new EditError(dir > 0 ? 'The layer is already at the top.' : 'The layer is already at the bottom.')
  doc.layers.splice(i, 1)
  doc.layers.splice(j, 0, l)
}

/** Moves a layer to stack index `to` (0 = bottom). */
export function moveLayerTo(doc: ImageDocument, id: string, to: number): void {
  const l = layer(doc, id)
  const i = doc.layers.indexOf(l)
  doc.layers.splice(i, 1)
  doc.layers.splice(Math.max(0, Math.min(doc.layers.length, to)), 0, l)
}

/** Replaces layers `ids` with one merged raster layer at the position of the topmost. */
export function replaceWithMerged(doc: ImageDocument, ids: string[], merged: { name: string; tiles: TileMap; x: number; y: number }): string {
  if (!ids.length) throw new EditError('There are no layers to merge.')
  for (const id of ids) unlocked(doc, id, 'merge it')
  const top = Math.max(...ids.map((id) => doc.layers.findIndex((l) => l.id === id)))
  const l = createLayer(merged.name, { type: 'raster', x: merged.x, y: merged.y, tiles: merged.tiles })
  doc.layers.splice(top + 1, 0, l)
  doc.layers = doc.layers.filter((x) => !ids.includes(x.id))
  doc.activeLayerId = l.id
  return l.id
}

/** Replaces every layer with one Background layer (Flatten Image). */
export function flattenDocument(doc: ImageDocument, tiles: TileMap): void {
  const l = createLayer('Background', { type: 'raster', x: 0, y: 0, tiles })
  doc.layers = [l]
  doc.activeLayerId = l.id
}

export function setSelection(doc: ImageDocument, sel: Selection | null): void {
  doc.selection = sel
}

/** Crops the canvas to `r`; layers keep their pixels outside the new bounds. */
export function cropDocument(doc: ImageDocument, r: Rect): void {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  const w = Math.round(r.w)
  const h = Math.round(r.h)
  if (w < 1 || h < 1) throw new EditError('The crop area is empty.')
  checkDimensions(w, h)
  for (const l of doc.layers) {
    if (l.content.type === 'raster') {
      l.content.x -= x
      l.content.y -= y
    } else if (isVector(l.content)) l.content.params = { ...l.content.params, cx: l.content.params.cx - x, cy: l.content.params.cy - y }
    shiftMask(l.mask, -x, -y)
  }
  doc.width = w
  doc.height = h
  doc.selection = null
}

/** Changes the canvas size; `ax`, `ay` (0..1) anchor the old content. */
export function resizeCanvas(doc: ImageDocument, width: number, height: number, ax: number, ay: number): void {
  const w = Math.round(width)
  const h = Math.round(height)
  try {
    checkDimensions(w, h)
  } catch (e) {
    throw new EditError((e as Error).message)
  }
  const dx = Math.round((w - doc.width) * ax)
  const dy = Math.round((h - doc.height) * ay)
  for (const l of doc.layers) {
    if (l.content.type === 'raster') {
      l.content.x += dx
      l.content.y += dy
    } else if (isVector(l.content)) l.content.params = { ...l.content.params, cx: l.content.params.cx + dx, cy: l.content.params.cy + dy }
    shiftMask(l.mask, dx, dy)
  }
  doc.selection = translate(doc.selection, dx, dy)
  doc.width = w
  doc.height = h
}

/**
 * Applies a whole-document pixel transform (image size, rotate, flip): new
 * dimensions plus new tiles for every raster layer.
 */
export function transformDocument(doc: ImageDocument, width: number, height: number, layers: Record<string, TileSurface>, masks: Record<string, TileSurface> = {}, vectors: Record<string, TransformParams> = {}): void {
  try {
    checkDimensions(width, height)
  } catch (e) {
    throw new EditError((e as Error).message)
  }
  for (const l of doc.layers) {
    const t = layers[l.id]
    if (t && l.content.type === 'raster') l.content = { type: 'raster', x: t.x, y: t.y, tiles: t.tiles }
    const m = masks[l.id]
    if (m && l.mask) l.mask = { ...l.mask, x: m.x, y: m.y, tiles: m.tiles }
    const v = vectors[l.id]
    if (v && isVector(l.content)) l.content.params = v
  }
  doc.width = width
  doc.height = height
  doc.selection = null
}
