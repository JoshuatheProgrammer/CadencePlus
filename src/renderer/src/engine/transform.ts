/**
 * Floating pixels for Free Transform and moving a selection. The content is
 * lifted into a canvas (the whole layer, or just the selected pixels), shown
 * through a matrix while the user edits it, and resampled into tiles once on
 * commit. A whole-pixel move commits without resampling.
 */
import { exactPixelMatrix, multiply, transformedBounds, type Affine } from '@core/affine'
import { maskBounds } from '@core/flood'
import { rasterBounds, unionRect, type ImageDocument, type Layer, type Rect, type TileMap, type TileSurface } from '@core/model'
import type { Selection } from '@core/selection'
import { applyToLayer, colorSource } from './pixels'
import { maskFromCanvas, selectionBounds, selectionMask } from './selection'
import { drawTiles, rasterToCanvas, tilesFromCanvas } from './tiles'

export interface FloatPart {
  /** Lifted pixels; local (0,0) sits at document `rect.x, rect.y` before transforming. */
  canvas: OffscreenCanvas
  rect: Rect
  /** What stays behind on the surface. */
  remainder: TileMap
}

export interface FloatState {
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

/** Matrix for a part, given the transform of the main pixels (local → document). */
export function partMatrix(m: Affine, main: Rect, part: Rect): Affine {
  return multiply(m, translate(part.x - main.x, part.y - main.y))
}

function trimmed(c: OffscreenCanvas): Rect | null {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  return maskBounds(d, c.width, c.height, 4, 3)
}

function liftWhole(s: TileSurface): FloatPart | null {
  const src = rasterToCanvas(s, 'float.src')
  if (!src) return null
  const t = trimmed(src.canvas)
  if (!t) return null
  const canvas = new OffscreenCanvas(t.w, t.h)
  canvas.getContext('2d')!.drawImage(src.canvas, -t.x, -t.y)
  return { canvas, rect: { x: src.rect.x + t.x, y: src.rect.y + t.y, w: t.w, h: t.h }, remainder: {} }
}

/** Lifts the active layer (or its selected pixels) into a float; null when there is nothing to lift. */
export function beginFloat(doc: ImageDocument, l: Layer, docId: string): FloatState | null {
  if (l.content.type !== 'raster') return null
  const surface = l.content
  if (doc.selection) {
    const sel = selectionMask(doc.selection, doc.width, doc.height)
    const c0 = new OffscreenCanvas(doc.width, doc.height)
    const g0 = c0.getContext('2d')!
    drawTiles(g0, surface, 0, 0)
    g0.globalCompositeOperation = 'destination-in'
    g0.drawImage(sel, 0, 0)
    const t = trimmed(c0)
    if (!t) return null
    const canvas = new OffscreenCanvas(t.w, t.h)
    canvas.getContext('2d')!.drawImage(c0, -t.x, -t.y)
    const remainder = applyToLayer(doc, surface, colorSource('#000'), { x: 0, y: 0, w: doc.width, h: doc.height }, 'erase', 1, doc.selection)
    const sb = selectionBounds(doc.selection, doc.width, doc.height)!
    const selCanvas = new OffscreenCanvas(sb.w, sb.h)
    selCanvas.getContext('2d')!.drawImage(sel, -sb.x, -sb.y)
    return { docId, layerId: l.id, pixels: { canvas, rect: t, remainder }, mask: null, selection: { canvas: selCanvas, rect: sb }, fromSelection: true }
  }
  const pixels = liftWhole(surface)
  if (!pixels) return null
  const mask = l.mask ? liftWhole(l.mask) : null
  return { docId, layerId: l.id, pixels, mask, selection: null, fromSelection: false }
}

function commitPart(part: FloatPart, origin: { x: number; y: number }, m: Affine): TileMap {
  const fb = transformedBounds(m, part.canvas.width, part.canvas.height)
  const u = unionRect(fb, rasterBounds({ ...origin, tiles: part.remainder }))!
  const c = new OffscreenCanvas(u.w, u.h)
  const g = c.getContext('2d')!
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
export function commitFloat(l: Layer, fs: FloatState, m: Affine, selection: Selection | null): FloatResult {
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
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = sm === sm0
    g.setTransform(sm.a, sm.b, sm.c, sm.d, sm.e - fb.x, sm.f - fb.y)
    g.drawImage(fs.selection.canvas, 0, 0)
    sel = { steps: [{ op: 'add', shape: { kind: 'mask', maskId: maskFromCanvas(c), x: fb.x, y: fb.y } }] }
  }
  return { tiles, maskTiles, selection: sel }
}
