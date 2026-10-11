/**
 * Floating pixels for Free Transform and moving a selection. The content is
 * lifted into a canvas (the whole layer, or just the selected pixels), shown
 * through a matrix while the user edits it, and resampled into tiles once on
 * commit. A whole-pixel move commits without resampling.
 */
import { apply, exactPixelMatrix, multiply, paramsToMatrix, transformedBounds, type Affine, type TransformParams } from '@core/affine'
import { mapParams } from '@core/vector'
import { maskBounds } from '@core/flood'
import { isVector, rasterBounds, unionRect, type ImageDocument, type Layer, type Rect, type TileMap, type TileSurface } from '@core/model'
import type { Selection } from '@core/selection'
import { applyToLayer, colorSource } from './pixels'
import { maskFromCanvas, selectionBounds, selectionMask } from './selection'
import { drawTiles, rasterToCanvas, tilesFromCanvas } from './tiles'
import { vectorBounds, vectorSize } from './vector'
import { ctx2d } from './format'

export interface FloatPart {
  /** Lifted pixels; local (0,0) sits at document `rect.x, rect.y` before transforming. */
  canvas: OffscreenCanvas
  rect: Rect
  /** What stays behind on the surface. */
  remainder: TileMap
}

export type FloatState = RasterFloat | VectorFloat | MultiFloat

/**
 * Several layers in one transform box (a group's contents, or the layers
 * selected together). Pixel layers are lifted whole; type and shapes keep
 * their placement and are remapped.
 */
export interface MultiFloat {
  kind: 'multi'
  docId: string
  /** The active layer (or group). */
  layerId: string
  /** The box: union of every member's bounds (document). */
  rect: Rect
  rasters: { layerId: string; pixels: FloatPart; mask: FloatPart | null }[]
  vectors: { layerId: string; w: number; h: number; start: TransformParams }[]
}

/** Type and shape layers transform by editing their placement: nothing is lifted. */
export interface VectorFloat {
  kind: 'vector'
  docId: string
  layerId: string
  /** Local box size. */
  w: number
  h: number
  start: TransformParams
}

export interface RasterFloat {
  kind: 'raster'
  docId: string
  layerId: string
  pixels: FloatPart
  /** The layer mask travels with a whole-layer transform. */
  mask: FloatPart | null
  /** The selection mask travels with a selection transform. */
  selection: { canvas: OffscreenCanvas; rect: Rect } | null
  fromSelection: boolean
}

const translate = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y })

/** Size of the box being transformed. */
export function floatSize(fs: FloatState): { w: number; h: number } {
  return fs.kind === 'vector' ? { w: fs.w, h: fs.h } : fs.kind === 'multi' ? { w: fs.rect.w, h: fs.rect.h } : { w: fs.pixels.canvas.width, h: fs.pixels.canvas.height }
}

/** The box a float starts as (document). */
export function floatRect(fs: RasterFloat | MultiFloat): Rect {
  return fs.kind === 'multi' ? fs.rect : fs.pixels.rect
}

/** Lifts several layers into one box; null when none of them has anything to transform. */
export function beginMultiFloat(doc: ImageDocument, layerIds: string[], docId: string, activeId: string): MultiFloat | null {
  const rasters: MultiFloat['rasters'] = []
  const vectors: MultiFloat['vectors'] = []
  let rect: Rect | null = null
  for (const id of layerIds) {
    const l = doc.layers.find((x) => x.id === id)
    if (!l) continue
    if (isVector(l.content)) {
      const s = vectorSize(l.content)
      vectors.push({ layerId: id, w: s.w, h: s.h, start: l.content.params })
      rect = unionRect(rect, vectorBounds(l.content))
    } else if (l.content.type === 'raster') {
      const pixels = liftWhole(l.content)
      if (!pixels) continue
      rasters.push({ layerId: id, pixels, mask: l.mask ? liftWhole(l.mask) : null })
      rect = unionRect(rect, pixels.rect)
    }
  }
  if (!rect || (!rasters.length && !vectors.length)) return null
  return { kind: 'multi', docId, layerId: activeId, rect, rasters, vectors }
}

/**
 * A member's placement after the box moves from `rect` to `params`. Exact
 * for moves, rotations, flips and proportional scaling; a non-proportional
 * scale of a rotated member keeps its own angle (vectors cannot skew).
 */
export function multiVectorParams(fs: MultiFloat, start: TransformParams, params: TransformParams): TransformParams {
  const m = multiply(paramsToMatrix(params, fs.rect.w, fs.rect.h), translate(-fs.rect.x, -fs.rect.y))
  return mapParams(start, (x, y) => apply(m, x, y), { scaleX: params.sx, scaleY: params.sy, rotate: params.rot })
}

/** Per-member float views for rendering a multi-layer transform. */
export function memberFloat(fs: MultiFloat, m: Affine, params: TransformParams, layerId: string): { fs: RasterFloat | VectorFloat; m: Affine; params: TransformParams } | null {
  const r = fs.rasters.find((x) => x.layerId === layerId)
  if (r) return { fs: { kind: 'raster', docId: fs.docId, layerId, pixels: r.pixels, mask: r.mask, selection: null, fromSelection: false }, m: partMatrix(m, fs.rect, r.pixels.rect), params }
  const v = fs.vectors.find((x) => x.layerId === layerId)
  if (v) return { fs: { kind: 'vector', docId: fs.docId, layerId, w: v.w, h: v.h, start: v.start }, m, params: multiVectorParams(fs, v.start, params) }
  return null
}

/** Resamples every raster member; returns new tiles per layer (and masks). */
export function commitMultiFloat(doc: ImageDocument, fs: MultiFloat, m: Affine): { tiles: Record<string, TileMap>; masks: Record<string, TileMap> } {
  const tiles: Record<string, TileMap> = {}
  const masks: Record<string, TileMap> = {}
  for (const r of fs.rasters) {
    const l = doc.layers.find((x) => x.id === r.layerId)
    if (!l || l.content.type !== 'raster') continue
    const pm = partMatrix(m, fs.rect, r.pixels.rect)
    tiles[r.layerId] = commitPart(r.pixels, l.content, pm)
    if (r.mask && l.mask) masks[r.layerId] = commitPart(r.mask, l.mask, partMatrix(pm, r.pixels.rect, r.mask.rect))
  }
  return { tiles, masks }
}

/** Matrix for a part, given the transform of the main pixels (local → document). */
export function partMatrix(m: Affine, main: Rect, part: Rect): Affine {
  return multiply(m, translate(part.x - main.x, part.y - main.y))
}

function trimmed(c: OffscreenCanvas): Rect | null {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data
  return maskBounds(d, c.width, c.height, 4, 3)
}

function liftWhole(s: TileSurface): FloatPart | null {
  const src = rasterToCanvas(s, 'float.src')
  if (!src) return null
  const t = trimmed(src.canvas)
  if (!t) return null
  const canvas = new OffscreenCanvas(t.w, t.h)
  ctx2d(canvas).drawImage(src.canvas, -t.x, -t.y)
  return { canvas, rect: { x: src.rect.x + t.x, y: src.rect.y + t.y, w: t.w, h: t.h }, remainder: {} }
}

/** Lifts the active layer (or its selected pixels) into a float; null when there is nothing to lift. */
export function beginFloat(doc: ImageDocument, l: Layer, docId: string): FloatState | null {
  if (isVector(l.content)) {
    const s = vectorSize(l.content)
    return { kind: 'vector', docId, layerId: l.id, w: s.w, h: s.h, start: l.content.params }
  }
  if (l.content.type !== 'raster') return null
  const surface = l.content
  if (doc.selection) {
    const sel = selectionMask(doc.selection, doc.width, doc.height)
    const c0 = new OffscreenCanvas(doc.width, doc.height)
    const g0 = ctx2d(c0)
    drawTiles(g0, surface, 0, 0)
    g0.globalCompositeOperation = 'destination-in'
    g0.drawImage(sel, 0, 0)
    const t = trimmed(c0)
    if (!t) return null
    const canvas = new OffscreenCanvas(t.w, t.h)
    ctx2d(canvas).drawImage(c0, -t.x, -t.y)
    const remainder = applyToLayer(doc, surface, colorSource('#000'), { x: 0, y: 0, w: doc.width, h: doc.height }, 'erase', 1, doc.selection)
    const sb = selectionBounds(doc.selection, doc.width, doc.height)!
    const selCanvas = new OffscreenCanvas(sb.w, sb.h)
    ctx2d(selCanvas).drawImage(sel, -sb.x, -sb.y)
    return { kind: 'raster', docId, layerId: l.id, pixels: { canvas, rect: t, remainder }, mask: null, selection: { canvas: selCanvas, rect: sb }, fromSelection: true }
  }
  const pixels = liftWhole(surface)
  if (!pixels) return null
  const mask = l.mask ? liftWhole(l.mask) : null
  return { kind: 'raster', docId, layerId: l.id, pixels, mask, selection: null, fromSelection: false }
}

function commitPart(part: FloatPart, origin: { x: number; y: number }, m: Affine): TileMap {
  const fb = transformedBounds(m, part.canvas.width, part.canvas.height)
  const u = unionRect(fb, rasterBounds({ ...origin, tiles: part.remainder }))!
  const c = new OffscreenCanvas(u.w, u.h)
  const g = ctx2d(c)
  drawTiles(g, { ...origin, tiles: part.remainder }, -u.x, -u.y)
  // Whole-pixel transforms (moves, flips, 90° turns) copy pixels exactly.
  const exact = exactPixelMatrix(m)
  if (exact) m = exact
  g.imageSmoothingEnabled = !exact
  g.imageSmoothingQuality = 'high'
  g.setTransform(m.a, m.b, m.c, m.d, m.e - u.x, m.f - u.y)
  g.drawImage(part.canvas, 0, 0)
  return tilesFromCanvas(c, u.x, u.y, origin.x, origin.y)
}

export interface FloatResult {
  tiles: TileMap
  maskTiles: TileMap | null
  selection: Selection | null
}

/** Resamples the float through `m` (pixels local → document) into new tiles. */
export function commitFloat(l: Layer, fs: RasterFloat, m: Affine, selection: Selection | null): FloatResult {
  if (l.content.type !== 'raster') throw new Error('Free Transform needs a pixel layer.')
  const tiles = commitPart(fs.pixels, l.content, m)
  const maskTiles = fs.mask && l.mask ? commitPart(fs.mask, l.mask, partMatrix(m, fs.pixels.rect, fs.mask.rect)) : null
  let sel = selection
  if (fs.selection) {
    // The selection follows the pixels.
    const sm0 = partMatrix(m, fs.pixels.rect, fs.selection.rect)
    const sm = exactPixelMatrix(sm0) ?? sm0
    const fb = transformedBounds(sm, fs.selection.canvas.width, fs.selection.canvas.height)
    const c = new OffscreenCanvas(fb.w, fb.h)
    const g = ctx2d(c)
    g.imageSmoothingEnabled = sm === sm0
    g.setTransform(sm.a, sm.b, sm.c, sm.d, sm.e - fb.x, sm.f - fb.y)
    g.drawImage(fs.selection.canvas, 0, 0)
    sel = { steps: [{ op: 'add', shape: { kind: 'mask', maskId: maskFromCanvas(c), x: fb.x, y: fb.y } }] }
  }
  return { tiles, maskTiles, selection: sel }
}
