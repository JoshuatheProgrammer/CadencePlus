/**
 * Pixel operations that produce new tiles. None of these touch the model;
 * they return tile maps for an edit() to store, so undo stays automatic.
 */
import { adjustmentOp, type PixelOp } from '@core/adjustments'
import { colorMask, maskBounds } from '@core/flood'
import type { TransformParams } from '@core/affine'
import { intersectRect, isVector, rasterBounds, tileKey, TILE, unionRect, type ImageDocument, type Layer, type Rect, type TileMap, type TileSurface } from '@core/model'
import { ancestors, descendants } from '@core/tree'
import { mapParams } from '@core/vector'
import type { Selection } from '@core/selection'
import { drawWithOp } from './ops'
import { drawVector, vectorBounds } from './vector'
import { renderComposite, renderDocument } from './render'
import { maskFromArray, selectionMask } from './selection'
import { drawTiles, getTile, makeTile, poolCanvas, rasterToCanvas, tilesFromCanvas, type Ctx2D } from './tiles'
import { ctx2d, perFormat } from './format'

/** Draws document content with document point (ox, oy) at the canvas origin. */
export type Source = (g: Ctx2D, ox: number, oy: number) => void

export const canvasSource =
  (src: CanvasImageSource, srcX = 0, srcY = 0): Source =>
  (g, ox, oy) =>
    g.drawImage(src, srcX - ox, srcY - oy)

export const colorSource =
  (color: string): Source =>
  (g) => {
    g.fillStyle = color
    g.fillRect(0, 0, TILE, TILE)
  }

const srcTileFor = perFormat(() => {
  const c = new OffscreenCanvas(TILE, TILE)
  return { c, g: ctx2d(c) }
})
// Alpha-only probes: 8-bit is enough.
const probe = new OffscreenCanvas(TILE, TILE)
const pg = probe.getContext('2d', { willReadFrequently: true })!

function tileEmpty(id: string): boolean {
  const b = getTile(id)
  if (!b) return true
  pg.clearRect(0, 0, TILE, TILE)
  pg.drawImage(b, 0, 0)
  const d = pg.getImageData(0, 0, TILE, TILE).data
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false
  return true
}

export type ApplyMode = 'over' | 'erase' | 'replace' | 'mask'

/**
 * Mask painting: the source colour's darkness is the hide amount being
 * painted (black hides, white reveals), mixed in by the source alpha:
 * hide' = hide × (1 − a) + (1 − luminance) × a.
 */
function maskTile(stg: OffscreenCanvasRenderingContext2D, old: ImageBitmap | undefined, opacity: number): ImageData | null {
  const sd = stg.getImageData(0, 0, TILE, TILE).data
  let od: Uint8ClampedArray | null = null
  if (old) {
    pg.clearRect(0, 0, TILE, TILE)
    pg.drawImage(old, 0, 0)
    od = pg.getImageData(0, 0, TILE, TILE).data
  }
  const out = new ImageData(TILE, TILE)
  const d = out.data
  let any = false
  for (let p = 3; p < d.length; p += 4) {
    const a = (sd[p] / 255) * opacity
    const o = od ? od[p] : 0
    let v = o
    if (a > 0) {
      const lum = (0.299 * sd[p - 3] + 0.587 * sd[p - 2] + 0.114 * sd[p - 1]) / 255
      v = o * (1 - a) + 255 * (1 - lum) * a
    }
    const iv = Math.round(v)
    d[p] = iv
    if (iv) any = true
  }
  return any ? out : null
}

/**
 * Applies `source` to a tile surface (layer pixels or a mask) inside `rect`
 * (document pixels), limited to the canvas and the selection:
 *   over    — paint on top (brush, fill, gradient)
 *   erase   — remove alpha (eraser, delete; on masks: reveal)
 *   replace — swap pixels (filters, adjustments)
 *   mask    — paint a mask with the source's greyscale (see maskTile)
 */
export function applyToLayer(doc: ImageDocument, content: TileSurface, source: Source, rect: Rect, mode: ApplyMode, opacity = 1, selection: Selection | null = doc.selection): TileMap {
  const out: TileMap = { ...content.tiles }
  const r = intersectRect(rect, { x: 0, y: 0, w: doc.width, h: doc.height })
  if (!r) return out
  const { c: srcTile, g: stg } = srcTileFor()
  const mask = selection ? selectionMask(selection, doc.width, doc.height) : null
  const tx0 = Math.floor((r.x - content.x) / TILE)
  const ty0 = Math.floor((r.y - content.y) / TILE)
  const tx1 = Math.ceil((r.x + r.w - content.x) / TILE)
  const ty1 = Math.ceil((r.y + r.h - content.y) / TILE)
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      const key = tileKey(tx, ty)
      const gx = content.x + tx * TILE
      const gy = content.y + ty * TILE
      const old = out[key] ? getTile(out[key]) : undefined
      if (!old && mode === 'erase') continue
      // The source for this tile, clipped to rect and masked by the selection.
      stg.save()
      stg.clearRect(0, 0, TILE, TILE)
      stg.beginPath()
      stg.rect(r.x - gx, r.y - gy, r.w, r.h)
      stg.clip()
      source(stg, gx, gy)
      if (mask) {
        stg.globalCompositeOperation = 'destination-in'
        stg.drawImage(mask, -gx, -gy)
      }
      stg.restore()
      if (mode === 'mask') {
        const img = maskTile(stg, old, opacity)
        if (img) out[key] = makeTile((g) => g.putImageData(img, 0, 0))
        else delete out[key]
        continue
      }
      const id = makeTile((g) => {
        if (old) g.drawImage(old, 0, 0)
        if (mode === 'replace') {
          // new = old × (1 − m) + src × m, using additive compositing for the exact mix
          g.save()
          g.beginPath()
          g.rect(r.x - gx, r.y - gy, r.w, r.h)
          g.clip()
          if (mask) {
            g.globalCompositeOperation = 'destination-out'
            g.drawImage(mask, -gx, -gy)
          } else g.clearRect(0, 0, TILE, TILE)
          g.restore()
          g.globalCompositeOperation = 'lighter'
        } else {
          g.globalAlpha = opacity
          g.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
        }
        g.drawImage(srcTile, 0, 0)
      })
      if (mode !== 'over' && tileEmpty(id)) delete out[key]
      else out[key] = id
    }
  }
  return out
}

/** A layer's own pixels in a document-sized canvas (fill layers cover the canvas). */
export function layerCanvas(doc: ImageDocument, l: Layer, key = 'layer'): OffscreenCanvas {
  const c = poolCanvas(key, doc.width, doc.height)
  const g = ctx2d(c)
  if (l.content.type === 'raster') drawTiles(g, l.content, 0, 0)
  else if (l.content.type === 'fill') {
    g.fillStyle = l.content.color
    g.fillRect(0, 0, doc.width, doc.height)
  } else if (isVector(l.content)) drawVector(g, l.content, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  return c
}

/** A type/shape/fill layer as pixel tiles (Rasterize Layer); vector content keeps what lies outside the canvas. */
export function rasterizeTiles(doc: ImageDocument, l: Layer): TileMap {
  if (isVector(l.content)) {
    const b = vectorBounds(l.content)
    const c = poolCanvas('rasterize', b.w, b.h)
    drawVector(ctx2d(c), l.content, { a: 1, b: 0, c: 0, d: 1, e: -b.x, f: -b.y })
    return tilesFromCanvas(c, b.x, b.y, 0, 0)
  }
  return tilesFromCanvas(layerCanvas(doc, l), 0, 0, 0, 0)
}

/** Pixels to sample for wand/bucket/eyedropper: the composite, or just the active layer. */
export function sampleSource(doc: ImageDocument, allLayers: boolean): OffscreenCanvas {
  if (allLayers) return renderComposite(doc, 'sample')
  const l = doc.layers.find((x) => x.id === doc.activeLayerId)
  return l ? layerCanvas(doc, l, 'sample') : renderComposite(doc, 'sample')
}

const one = new OffscreenCanvas(1, 1)
const og = one.getContext('2d', { willReadFrequently: true })!

/** Alpha (0..255) of a layer's own pixel at document (x, y). */
export function layerAlphaAt(doc: ImageDocument, l: Layer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return 0
  if (l.content.type === 'fill') return 255
  if (isVector(l.content)) {
    og.clearRect(0, 0, 1, 1)
    drawVector(og, l.content, { a: 1, b: 0, c: 0, d: 1, e: -Math.floor(x), f: -Math.floor(y) })
    return og.getImageData(0, 0, 1, 1).data[3]
  }
  if (l.content.type !== 'raster') return 0
  const c = l.content
  const px = Math.floor(x)
  const py = Math.floor(y)
  const tx = Math.floor((px - c.x) / TILE)
  const ty = Math.floor((py - c.y) / TILE)
  const bmp = c.tiles[tileKey(tx, ty)] ? getTile(c.tiles[tileKey(tx, ty)]) : undefined
  if (!bmp) return 0
  og.clearRect(0, 0, 1, 1)
  og.drawImage(bmp, c.x + tx * TILE - px, c.y + ty * TILE - py)
  return og.getImageData(0, 0, 1, 1).data[3]
}

/** Average colour around (x, y); null where fully transparent. */
export function sampleColor(doc: ImageDocument, x: number, y: number, allLayers: boolean, size: number): string | null {
  const src = sampleSource(doc, allLayers)
  const h = Math.floor(size / 2)
  const x0 = Math.max(0, Math.floor(x) - h)
  const y0 = Math.max(0, Math.floor(y) - h)
  const x1 = Math.min(doc.width, Math.floor(x) + h + 1)
  const y1 = Math.min(doc.height, Math.floor(y) + h + 1)
  if (x1 <= x0 || y1 <= y0) return null
  // Colours are sRGB hex in the UI, so sample converted to sRGB (wide-gamut values clip).
  const d = ctx2d(src).getImageData(x0, y0, x1 - x0, y1 - y0, { colorSpace: 'srgb' }).data
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3]
    r += d[i] * w
    g += d[i + 1] * w
    b += d[i + 2] * w
    a += w
  }
  if (!a) return null
  const hex = (v: number) => Math.round(v / a).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Magic-wand mask: returns a mask id and its bounds, or null when nothing matched. */
export function wandMask(doc: ImageDocument, x: number, y: number, tolerance: number, contiguous: boolean, allLayers: boolean): { maskId: string; bounds: Rect } | null {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
  const src = sampleSource(doc, allLayers)
  const d = ctx2d(src).getImageData(0, 0, doc.width, doc.height).data
  const m = colorMask(d, doc.width, doc.height, x, y, tolerance, contiguous)
  const bounds = maskBounds(m, doc.width, doc.height)
  if (!bounds) return null
  return { maskId: maskFromArray(m, doc.width, doc.height), bounds }
}

/** Paint-bucket source: the fill colour masked to the matching pixels. */
export function bucketSource(doc: ImageDocument, x: number, y: number, tolerance: number, contiguous: boolean, allLayers: boolean, color: string): { source: Source; bounds: Rect } | null {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
  const src = sampleSource(doc, allLayers)
  const d = ctx2d(src).getImageData(0, 0, doc.width, doc.height).data
  const m = colorMask(d, doc.width, doc.height, x, y, tolerance, contiguous)
  const bounds = maskBounds(m, doc.width, doc.height)
  if (!bounds) return null
  const img = new ImageData(doc.width, doc.height)
  const rgb = parseInt(color.slice(1), 16)
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue
    const p = i * 4
    img.data[p] = (rgb >> 16) & 255
    img.data[p + 1] = (rgb >> 8) & 255
    img.data[p + 2] = rgb & 255
    img.data[p + 3] = 255
  }
  const c = new OffscreenCanvas(doc.width, doc.height)
  ctx2d(c).putImageData(img, 0, 0)
  return { source: canvasSource(c), bounds }
}

/**
 * Composites `layers` (bottom → top, as in the document; groups include
 * their children) into one tile map at origin (0, 0), through the same
 * compositor as the screen, keeping pixels outside the canvas.
 */
export function mergeToTiles(doc: ImageDocument, layers: Layer[], background?: string): TileMap {
  const ids = new Set(layers.map((l) => l.id))
  for (const l of layers) if (l.content.type === 'group') for (const d of descendants(doc.layers, l.id)) ids.add(d.id)
  const sub = doc.layers.filter((l) => ids.has(l.id))
  const docRect = { x: 0, y: 0, w: doc.width, h: doc.height }
  let b: Rect | null = background ? docRect : null
  for (const l of sub) {
    if (!effectivelyVisibleIn(sub, l)) continue
    if (l.content.type === 'raster') b = unionRect(b, rasterBounds(l.content))
    else if (isVector(l.content)) b = unionRect(b, vectorBounds(l.content))
    else if (l.content.type === 'fill' || l.content.type === 'adjustment') b = unionRect(b, docRect)
  }
  if (!b) return {}
  const c = poolCanvas('merge', b.w, b.h)
  renderDocument(c, { ...doc, layers: sub }, { xf: { scale: 1, ox: -b.x, oy: -b.y }, width: b.w, height: b.h, clip: false })
  let src: OffscreenCanvas = c
  if (background) {
    src = poolCanvas('merge.bg', b.w, b.h)
    const g = ctx2d(src)
    g.fillStyle = background
    g.fillRect(-b.x, -b.y, doc.width, doc.height)
    g.drawImage(c, 0, 0)
  }
  return tilesFromCanvas(src, b.x, b.y, 0, 0)
}

function effectivelyVisibleIn(layers: Layer[], l: Layer): boolean {
  return l.visible && ancestors(layers, l).every((g) => g.visible)
}

/** Layer pixels with the mask baked in (Apply Mask), on the layer's own tile grid. */
export function applyMaskTiles(content: TileSurface, mask: TileSurface): TileMap {
  const src = rasterToCanvas(content, 'applymask')
  if (!src) return {}
  const g = ctx2d(src.canvas)
  g.globalCompositeOperation = 'destination-out'
  drawTiles(g, mask, -src.rect.x, -src.rect.y)
  g.globalCompositeOperation = 'source-over'
  return tilesFromCanvas(src.canvas, src.rect.x, src.rect.y, content.x, content.y)
}

/** Mask tiles hiding everything outside the selection (or inside it, with `hideSelected`). */
export function maskTilesFromSelection(doc: ImageDocument, hideSelected: boolean): TileMap {
  const c = poolCanvas('mask.sel', doc.width, doc.height)
  const g = ctx2d(c)
  const m = doc.selection ? selectionMask(doc.selection, doc.width, doc.height) : null
  if (hideSelected) {
    if (m) g.drawImage(m, 0, 0)
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = '#000'
    g.fillRect(0, 0, doc.width, doc.height)
  } else {
    g.fillStyle = '#000'
    g.fillRect(0, 0, doc.width, doc.height)
    if (m) {
      g.globalCompositeOperation = 'destination-out'
      g.drawImage(m, 0, 0)
    }
  }
  g.globalCompositeOperation = 'source-over'
  return tilesFromCanvas(c, 0, 0, 0, 0)
}

/** Inverts a mask over the canvas plus any area its tiles cover. */
export function invertMaskTiles(doc: ImageDocument, mask: TileSurface): TileMap {
  const b = unionRect({ x: 0, y: 0, w: doc.width, h: doc.height }, rasterBounds(mask))!
  const c = poolCanvas('mask.invert', b.w, b.h)
  const g = ctx2d(c)
  g.fillStyle = '#000'
  g.fillRect(0, 0, b.w, b.h)
  g.globalCompositeOperation = 'destination-out'
  drawTiles(g, mask, -b.x, -b.y)
  g.globalCompositeOperation = 'source-over'
  return tilesFromCanvas(c, b.x, b.y, mask.x, mask.y)
}

/** The visible part of a mask (inverse of hide) as a document-sized canvas, for Load Selection. */
export function maskVisibility(doc: ImageDocument, mask: TileSurface): OffscreenCanvas {
  const c = poolCanvas('mask.vis', doc.width, doc.height)
  const g = ctx2d(c)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, doc.width, doc.height)
  g.globalCompositeOperation = 'destination-out'
  drawTiles(g, mask, 0, 0)
  g.globalCompositeOperation = 'source-over'
  return c
}

/** Applies a pixel op (filter or tone curve) to a tile surface, within the selection. */
export function filterLayer(doc: ImageDocument, content: TileSurface, op: PixelOp): TileMap {
  const full = rasterToCanvas(content, 'filter.src')
  if (!full) return content.tiles
  const out = poolCanvas('filter.out', full.rect.w, full.rect.h)
  const g = ctx2d(out)
  drawWithOp(g, full.canvas, op)
  return applyToLayer(doc, content, canvasSource(out, full.rect.x, full.rect.y), full.rect, 'replace')
}

/** The selected pixels of the active layer (or the merged image) cropped to the selection. */
export function copyPixels(doc: ImageDocument, merged: boolean): { canvas: OffscreenCanvas; x: number; y: number } | null {
  const src = sampleSource(doc, merged)
  let r: Rect = { x: 0, y: 0, w: doc.width, h: doc.height }
  const c0 = poolCanvas('copy.masked', doc.width, doc.height)
  const g0 = ctx2d(c0)
  g0.drawImage(src, 0, 0)
  if (doc.selection) {
    g0.globalCompositeOperation = 'destination-in'
    g0.drawImage(selectionMask(doc.selection, doc.width, doc.height), 0, 0)
    g0.globalCompositeOperation = 'source-over'
  }
  const d = g0.getImageData(0, 0, doc.width, doc.height).data
  const bounds = maskBounds(d, doc.width, doc.height, 4, 3)
  if (!bounds) return null
  r = bounds
  const out = new OffscreenCanvas(r.w, r.h)
  ctx2d(out).drawImage(c0, -r.x, -r.y)
  return { canvas: out, x: r.x, y: r.y }
}

// ---------------------------------------------------------------------------
// Whole-document transforms (Image Size, Rotate, Flip)
// ---------------------------------------------------------------------------

export type DocTransform = { kind: 'resize'; width: number; height: number } | { kind: 'rotate'; turns: 1 | 2 | 3 } | { kind: 'flip'; axis: 'h' | 'v' }

export function transformLayers(doc: ImageDocument, t: DocTransform): { width: number; height: number; layers: Record<string, TileSurface>; masks: Record<string, TileSurface>; vectors: Record<string, TransformParams> } {
  const W = doc.width
  const H = doc.height
  const size =
    t.kind === 'resize' ? { width: t.width, height: t.height } : t.kind === 'rotate' && t.turns !== 2 ? { width: H, height: W } : { width: W, height: H }
  const layers: Record<string, TileSurface> = {}
  const masks: Record<string, TileSurface> = {}
  const vectors: Record<string, TransformParams> = {}
  for (const l of doc.layers) {
    if (l.content.type === 'raster') layers[l.id] = transformSurface(l.content, t, W, H)
    if (isVector(l.content)) vectors[l.id] = transformVector(l.content.params, t, W, H)
    if (l.mask) masks[l.id] = transformSurface(l.mask, t, W, H)
  }
  return { ...size, layers, masks, vectors }
}

/** Type and shapes stay vectors through Image Size, rotation and flips. */
function transformVector(p: TransformParams, t: DocTransform, W: number, H: number): TransformParams {
  if (t.kind === 'resize') {
    const kx = t.width / W
    const ky = t.height / H
    return mapParams(p, (x, y) => ({ x: x * kx, y: y * ky }), { scaleX: kx, scaleY: ky })
  }
  if (t.kind === 'rotate') {
    if (t.turns === 1) return mapParams(p, (x, y) => ({ x: H - y, y: x }), { rotate: Math.PI / 2 })
    if (t.turns === 2) return mapParams(p, (x, y) => ({ x: W - x, y: H - y }), { rotate: Math.PI })
    return mapParams(p, (x, y) => ({ x: y, y: W - x }), { rotate: -Math.PI / 2 })
  }
  return t.axis === 'h' ? mapParams(p, (x, y) => ({ x: W - x, y }), { flipX: true }) : mapParams(p, (x, y) => ({ x, y: H - y }), { flipY: true })
}

function transformSurface(surface: TileSurface, t: DocTransform, W: number, H: number): TileSurface {
  {
    const src = rasterToCanvas(surface, 'xform.src')
    if (!src) return { tiles: {}, x: 0, y: 0 }
    const { x, y, w, h } = src.rect
    let nr: Rect
    let draw: (g: OffscreenCanvasRenderingContext2D) => void
    if (t.kind === 'resize') {
      const sx = t.width / W
      const sy = t.height / H
      const nx = Math.round(x * sx)
      const ny = Math.round(y * sy)
      nr = { x: nx, y: ny, w: Math.max(1, Math.round((x + w) * sx) - nx), h: Math.max(1, Math.round((y + h) * sy) - ny) }
      draw = (g) => {
        g.imageSmoothingQuality = 'high'
        g.drawImage(src.canvas, 0, 0, nr.w, nr.h)
      }
    } else if (t.kind === 'rotate') {
      if (t.turns === 1) {
        nr = { x: H - y - h, y: x, w: h, h: w }
        draw = (g) => {
          g.translate(h, 0)
          g.rotate(Math.PI / 2)
          g.drawImage(src.canvas, 0, 0)
        }
      } else if (t.turns === 2) {
        nr = { x: W - x - w, y: H - y - h, w, h }
        draw = (g) => {
          g.translate(w, h)
          g.rotate(Math.PI)
          g.drawImage(src.canvas, 0, 0)
        }
      } else {
        nr = { x: y, y: W - x - w, w: h, h: w }
        draw = (g) => {
          g.translate(0, w)
          g.rotate(-Math.PI / 2)
          g.drawImage(src.canvas, 0, 0)
        }
      }
    } else {
      nr = t.axis === 'h' ? { x: W - x - w, y, w, h } : { x, y: H - y - h, w, h }
      draw = (g) => {
        if (t.axis === 'h') {
          g.translate(w, 0)
          g.scale(-1, 1)
        } else {
          g.translate(0, h)
          g.scale(1, -1)
        }
        g.drawImage(src.canvas, 0, 0)
      }
    }
    const dst = poolCanvas('xform.dst', nr.w, nr.h)
    const g = ctx2d(dst)
    g.save()
    draw(g)
    g.restore()
    return { tiles: tilesFromCanvas(dst, nr.x, nr.y, 0, 0), x: 0, y: 0 }
  }
}
