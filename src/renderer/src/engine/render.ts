/**
 * The compositor: draws a document into a canvas through a scale + offset.
 * One path serves the viewport, the navigator, thumbnails, sampling and
 * export, so what you see is what you save.
 *
 * Layers composite onto a transparent target (blend modes see only layers,
 * never the checkerboard). Only tiles inside the target are drawn, and tile
 * edges are snapped to whole target pixels so scaled tiles never show seams.
 */
import { adjustmentOp, type PixelOp } from '@core/adjustments'
import { parseTileKey, tileKey, TILE, type ImageDocument, type Layer, type TileSurface } from '@core/model'
import type { Affine, TransformParams } from '@core/affine'
import { isVector } from '@core/model'
import { tree } from '@core/tree'
import { layerMip, mipLevel } from './mips'
import { drawWithOp } from './ops'
import { drawVector } from './vector'
import { partMatrix, type FloatState } from './transform'
import { selectionMask } from './selection'
import { getTile, poolCanvas, type Ctx2D } from './tiles'

/** target = doc × scale + (ox, oy) */
export interface Xf {
  scale: number
  ox: number
  oy: number
}

export interface StrokePreview {
  layerId: string
  /** Document-sized stamp buffer. */
  canvas: OffscreenCanvas
  opacity: number
  erase: boolean
  /** Generation counter; bump to re-render while the stroke grows. */
  rev: number
  /** Painting on the layer mask: `maskValue` is the hide amount (0..1) being painted. */
  target?: 'pixels' | 'mask'
  maskValue?: number
  /** Clone Stamp: the stroke shows `canvas` (document-sized) shifted so pixel p shows p + (dx, dy). */
  clone?: { canvas: OffscreenCanvas; dx: number; dy: number }
}

/** A destructive filter being previewed on one layer (adjustment dialogs). */
export interface FilterPreview {
  layerId: string
  op: PixelOp
}

export interface RenderOptions {
  xf: Xf
  width: number
  height: number
  stroke?: StrokePreview | null
  filterPreview?: FilterPreview | null
  /** Render just this layer at full opacity, normal blend (thumbnails, sampling). */
  onlyLayer?: string
  /** false: don't clip to the canvas (merging keeps pixels outside it). */
  clip?: boolean
  /** Show this layer's mask as greyscale instead of the image (Alt+click a mask). */
  maskView?: string | null
  /** Content being transformed: `m` maps the float's local box to the document; `params` places vector layers. */
  float?: { fs: FloatState; m: Affine; params: TransformParams } | null
}

type FloatPreview = NonNullable<RenderOptions['float']>

/** Draws a float canvas through `m` (local → document) onto the target. */
function drawFloatPart(ctx: Ctx2D, canvas: OffscreenCanvas, m: Affine, xf: Xf): void {
  const s = xf.scale
  ctx.save()
  ctx.setTransform(s * m.a, s * m.b, s * m.c, s * m.d, s * m.e + xf.ox, s * m.f + xf.oy)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'low'
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()
}

export function compositeOp(l: Layer): GlobalCompositeOperation {
  return l.blend === 'normal' || l.blend === 'pass-through' ? 'source-over' : (l.blend as GlobalCompositeOperation)
}

/** Document rect in target pixels, snapped. */
export function docRectOnTarget(doc: { width: number; height: number }, xf: Xf): { x: number; y: number; w: number; h: number } {
  const x0 = Math.round(xf.ox)
  const y0 = Math.round(xf.oy)
  return { x: x0, y: y0, w: Math.max(1, Math.round(xf.ox + doc.width * xf.scale) - x0), h: Math.max(1, Math.round(xf.oy + doc.height * xf.scale) - y0) }
}

export function drawRaster(ctx: Ctx2D, c: TileSurface, xf: Xf, W: number, H: number, layerId?: string): void {
  const s = xf.scale
  const level = layerId ? mipLevel(s) : 0
  if (level > 0) {
    const m = layerMip(layerId!, c, level)
    if (m) {
      // The mip is within 2× of the target scale, so bilinear filtering is enough.
      const x0 = Math.round(xf.ox + (c.x + m.tx0 * TILE) * s)
      const y0 = Math.round(xf.oy + (c.y + m.ty0 * TILE) * s)
      const x1 = Math.round(xf.ox + (c.x + (m.tx0 + m.cols) * TILE) * s)
      const y1 = Math.round(xf.oy + (c.y + (m.ty0 + m.rows) * TILE) * s)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'low'
      ctx.drawImage(m.canvas, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
      return
    }
  }
  ctx.imageSmoothingEnabled = s < 1
  ctx.imageSmoothingQuality = s < 0.5 ? 'medium' : 'low'
  const tx0 = Math.floor((-xf.ox / s - c.x) / TILE)
  const ty0 = Math.floor((-xf.oy / s - c.y) / TILE)
  const tx1 = Math.ceil(((W - xf.ox) / s - c.x) / TILE)
  const ty1 = Math.ceil(((H - xf.oy) / s - c.y) / TILE)
  const draw = (tx: number, ty: number, id: string) => {
    const bmp = getTile(id)
    if (!bmp) return
    const x0 = Math.round(xf.ox + (c.x + tx * TILE) * s)
    const y0 = Math.round(xf.oy + (c.y + ty * TILE) * s)
    const x1 = Math.max(x0 + 1, Math.round(xf.ox + (c.x + (tx + 1) * TILE) * s))
    const y1 = Math.max(y0 + 1, Math.round(xf.oy + (c.y + (ty + 1) * TILE) * s))
    ctx.drawImage(bmp, x0, y0, x1 - x0, y1 - y0)
  }
  const keys = Object.keys(c.tiles)
  if (keys.length <= (tx1 - tx0) * (ty1 - ty0)) {
    for (const k of keys) {
      const [tx, ty] = parseTileKey(k)
      if (tx >= tx0 && tx < tx1 && ty >= ty0 && ty < ty1) draw(tx, ty, c.tiles[k])
    }
  } else {
    for (let ty = ty0; ty < ty1; ty++)
      for (let tx = tx0; tx < tx1; tx++) {
        const id = c.tiles[tileKey(tx, ty)]
        if (id) draw(tx, ty, id)
      }
  }
}

const xfAffine = (xf: Xf): Affine => ({ a: xf.scale, b: 0, c: 0, d: xf.scale, e: xf.ox, f: xf.oy })

/** Draws a layer's own pixels (no opacity/blend handling). */
function drawContent(ctx: Ctx2D, l: Layer, doc: ImageDocument, xf: Xf, W: number, H: number): void {
  if (l.content.type === 'raster') drawRaster(ctx, l.content, xf, W, H, l.id)
  else if (isVector(l.content)) drawVector(ctx, l.content, xfAffine(xf))
  else if (l.content.type === 'fill') {
    const r = docRectOnTarget(doc, xf)
    ctx.fillStyle = l.content.color
    ctx.fillRect(r.x, r.y, r.w, r.h)
  }
}

function drawSelectionMask(ctx: Ctx2D, doc: ImageDocument, xf: Xf): void {
  if (!doc.selection) return
  const m = selectionMask(doc.selection, doc.width, doc.height)
  const r = docRectOnTarget(doc, xf)
  ctx.save()
  ctx.imageSmoothingEnabled = xf.scale < 1
  ctx.imageSmoothingQuality = 'low'
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(m, r.x, r.y, r.w, r.h)
  ctx.restore()
}

/** Draws the stroke buffer at target scale, limited to the selection. */
function strokeOnTarget(stroke: StrokePreview, doc: ImageDocument, xf: Xf, W: number, H: number): OffscreenCanvas {
  const r = docRectOnTarget(doc, xf)
  const sc = poolCanvas('render.stroke', W, H)
  const sg = sc.getContext('2d')!
  sg.imageSmoothingEnabled = xf.scale < 1
  sg.imageSmoothingQuality = 'low'
  sg.drawImage(stroke.canvas, r.x, r.y, r.w, r.h)
  drawSelectionMask(sg, doc, xf)
  if (stroke.clone) {
    const { canvas, dx, dy } = stroke.clone
    sg.globalCompositeOperation = 'source-in'
    sg.drawImage(canvas, xf.ox - dx * xf.scale, xf.oy - dy * xf.scale, doc.width * xf.scale, doc.height * xf.scale)
    sg.globalCompositeOperation = 'source-over'
  }
  return sc
}

/** The layer's hide amount (mask alpha) at target scale, including a mask stroke in progress. */
function hideOnTarget(l: Layer, doc: ImageDocument, xf: Xf, W: number, H: number, stroke: StrokePreview | null, fl: FloatPreview | null = null): OffscreenCanvas {
  const hc = poolCanvas('render.hide', W, H)
  const hg = hc.getContext('2d')!
  if (l.mask && fl?.fs.kind === 'raster' && fl.fs.mask) {
    drawRaster(hg, { x: l.mask.x, y: l.mask.y, tiles: fl.fs.mask.remainder }, xf, W, H, `${l.id}#maskrem`)
    drawFloatPart(hg, fl.fs.mask.canvas, partMatrix(fl.m, fl.fs.pixels.rect, fl.fs.mask.rect), xf)
  } else if (l.mask) drawRaster(hg, l.mask, xf, W, H, `${l.id}#mask`)
  if (stroke) {
    // hide' = hide × (1 − a) + value × a
    const sc = strokeOnTarget(stroke, doc, xf, W, H)
    hg.save()
    hg.globalAlpha = stroke.opacity
    hg.globalCompositeOperation = 'destination-out'
    hg.drawImage(sc, 0, 0)
    if (!stroke.erase && (stroke.maskValue ?? 1) > 0) {
      hg.globalAlpha = stroke.opacity * (stroke.maskValue ?? 1)
      hg.globalCompositeOperation = 'lighter'
      hg.drawImage(sc, 0, 0)
    }
    hg.restore()
  }
  return hc
}

/** Renders `doc` into `target` (cleared first). */
export function renderDocument(target: OffscreenCanvas | HTMLCanvasElement, doc: ImageDocument, o: RenderOptions): void {
  const W = o.width
  const H = o.height
  const ctx = target.getContext('2d') as Ctx2D
  const r = docRectOnTarget(doc, o.xf)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  if (o.clip !== false) {
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
  }

  if (o.maskView) {
    const ml = doc.layers.find((l) => l.id === o.maskView)
    if (ml?.mask) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(r.x, r.y, r.w, r.h)
      drawRaster(ctx, ml.mask, o.xf, W, H, `${ml.id}#mask`)
      ctx.restore()
      return
    }
  }

  const only = o.onlyLayer ? doc.layers.find((l) => l.id === o.onlyLayer) : null
  const layers = only ? [{ ...only, visible: true, opacity: 1, blend: 'normal' as const, mask: null }] : (tree(doc.layers).get(null) ?? [])

  renderLayers(target, ctx, doc, layers, o, W, H, r, 0)
  ctx.restore()
}

/** Composites sibling layers (bottom → top) into `ctx`, recursing into groups. */
function renderLayers(target: OffscreenCanvas | HTMLCanvasElement, ctx: Ctx2D, doc: ImageDocument, layers: Layer[], o: RenderOptions, W: number, H: number, r: { x: number; y: number; w: number; h: number }, depth: number): void {
  for (const l of layers) {
    if (!l.visible) continue
    if (l.content.type === 'group') {
      const kids = tree(doc.layers).get(l.id) ?? []
      const masked = !!l.mask?.enabled
      // Pass Through at full opacity: children blend straight into what is below.
      if (l.blend === 'pass-through' && l.opacity >= 1 && !masked) {
        renderLayers(target, ctx, doc, kids, o, W, H, r, depth + 1)
        continue
      }
      const gc = poolCanvas(`render.group.${depth}`, W, H)
      const gg = gc.getContext('2d')!
      renderLayers(gc, gg, doc, kids, o, W, H, r, depth + 1)
      if (masked) {
        gg.save()
        gg.globalCompositeOperation = 'destination-out'
        gg.drawImage(hideOnTarget(l, doc, o.xf, W, H, o.stroke?.layerId === l.id && o.stroke.target === 'mask' ? o.stroke : null), 0, 0)
        gg.restore()
      }
      ctx.save()
      ctx.globalAlpha = l.opacity
      ctx.globalCompositeOperation = compositeOp(l)
      ctx.drawImage(gc, 0, 0)
      ctx.restore()
      continue
    }

    const op = compositeOp(l)
    const stroke = o.stroke && o.stroke.layerId === l.id ? o.stroke : null
    const maskStroke = stroke?.target === 'mask' ? stroke : null
    const pixelStroke = stroke && stroke.target !== 'mask' ? stroke : null
    const masked = !!l.mask?.enabled

    if (l.content.type === 'adjustment') {
      const aop = adjustmentOp(l.content.adjustment)
      if (!aop || l.opacity <= 0) continue
      const copy = poolCanvas('render.adjust', W, H)
      copy.getContext('2d')!.drawImage(target, 0, 0)
      ctx.save()
      if (masked) {
        // Filtered copy, hidden where the mask hides, laid over the original.
        const fl = poolCanvas('render.filtered', W, H)
        const fg = fl.getContext('2d')!
        drawWithOp(fg, copy, aop, o.xf.scale)
        fg.globalCompositeOperation = 'destination-out'
        fg.drawImage(hideOnTarget(l, doc, o.xf, W, H, maskStroke), 0, 0)
        ctx.globalAlpha = l.opacity
        ctx.globalCompositeOperation = op
        ctx.drawImage(fl, 0, 0)
      } else {
        if (l.opacity >= 1 && op === 'source-over') ctx.clearRect(r.x, r.y, r.w, r.h)
        ctx.globalAlpha = l.opacity
        ctx.globalCompositeOperation = op
        drawWithOp(ctx, copy, aop, o.xf.scale)
      }
      ctx.restore()
      continue
    }

    const fp = o.filterPreview && o.filterPreview.layerId === l.id ? o.filterPreview : null
    const fl = o.float && o.float.fs.layerId === l.id ? o.float : null
    if (!stroke && !fp && !masked && !fl) {
      ctx.save()
      ctx.globalAlpha = l.opacity
      ctx.globalCompositeOperation = op
      drawContent(ctx, l, doc, o.xf, W, H)
      ctx.restore()
      continue
    }

    // Layers being edited render through a temporary canvas first.
    const tmp = poolCanvas('render.layer', W, H)
    const tg = tmp.getContext('2d')!
    if (fl && fl.fs.kind === 'raster' && l.content.type === 'raster') {
      drawRaster(tg, { x: l.content.x, y: l.content.y, tiles: fl.fs.pixels.remainder }, o.xf, W, H, `${l.id}#rem`)
      drawFloatPart(tg, fl.fs.pixels.canvas, fl.m, o.xf)
    } else if (fl && isVector(l.content)) drawVector(tg, l.content, xfAffine(o.xf), fl.params)
    else drawContent(tg, l, doc, o.xf, W, H)

    if (fp) {
      const filtered = poolCanvas('render.filtered', W, H)
      const fg = filtered.getContext('2d')!
      drawWithOp(fg, tmp, fp.op, o.xf.scale)
      if (doc.selection) {
        drawSelectionMask(fg, doc, o.xf)
        // tmp = tmp × (1 − mask) + filtered × mask
        tg.save()
        tg.globalCompositeOperation = 'destination-out'
        const m = selectionMask(doc.selection, doc.width, doc.height)
        tg.imageSmoothingEnabled = o.xf.scale < 1
        tg.drawImage(m, r.x, r.y, r.w, r.h)
        tg.globalCompositeOperation = 'lighter'
        tg.drawImage(filtered, 0, 0)
        tg.restore()
      } else {
        tg.clearRect(0, 0, W, H)
        tg.drawImage(filtered, 0, 0)
      }
    }

    if (pixelStroke) {
      const sc = strokeOnTarget(pixelStroke, doc, o.xf, W, H)
      tg.save()
      tg.globalAlpha = pixelStroke.opacity
      tg.globalCompositeOperation = pixelStroke.erase ? 'destination-out' : 'source-over'
      tg.drawImage(sc, 0, 0)
      tg.restore()
    }

    if (masked) {
      const hc = hideOnTarget(l, doc, o.xf, W, H, maskStroke, fl)
      tg.save()
      tg.globalCompositeOperation = 'destination-out'
      tg.drawImage(hc, 0, 0)
      tg.restore()
    }

    ctx.save()
    ctx.globalAlpha = l.opacity
    ctx.globalCompositeOperation = op
    ctx.drawImage(tmp, 0, 0)
    ctx.restore()
  }
}

/** The full composite at 1:1 in a document-sized canvas. */
export function renderComposite(doc: ImageDocument, key = 'composite', onlyLayer?: string): OffscreenCanvas {
  const c = poolCanvas(key, doc.width, doc.height)
  renderDocument(c, doc, { xf: { scale: 1, ox: 0, oy: 0 }, width: doc.width, height: doc.height, onlyLayer })
  return c
}
