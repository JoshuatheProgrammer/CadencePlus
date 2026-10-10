/**
 * Turns selection data into an 8-bit alpha mask the size of the document,
 * and finds its edge for the marching-ants display.
 */
import { maskBounds } from '@core/flood'
import type { Rect } from '@core/model'
import type { Selection, SelShape } from '@core/selection'
import { getMask, putMask } from './tiles'

interface Cached {
  w: number
  h: number
  canvas: OffscreenCanvas
  bounds?: Rect | null
}

const cache = new WeakMap<Selection, Cached>()

function shapePath(s: Exclude<SelShape, { kind: 'mask' }>): Path2D {
  const p = new Path2D()
  if (s.kind === 'rect') p.rect(s.x, s.y, s.w, s.h)
  else if (s.kind === 'ellipse') p.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(0, s.w / 2), Math.max(0, s.h / 2), 0, 0, Math.PI * 2)
  else {
    const pts = s.points
    if (pts.length >= 6) {
      p.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1])
      p.closePath()
    }
  }
  return p
}

function drawShape(g: OffscreenCanvasRenderingContext2D, s: SelShape): void {
  g.fillStyle = '#fff'
  if (s.kind === 'mask') {
    const bmp = getMask(s.maskId)
    if (bmp) g.drawImage(bmp, s.x, s.y)
  } else g.fill(shapePath(s), 'evenodd')
}

/** The selection's alpha mask at document resolution (cached per selection object). */
export function selectionMask(sel: Selection, w: number, h: number): OffscreenCanvas {
  const hit = cache.get(sel)
  if (hit && hit.w === w && hit.h === h) return hit.canvas
  const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h))
  const g = c.getContext('2d')!
  const tmp = new OffscreenCanvas(c.width, c.height)
  const tg = tmp.getContext('2d')!
  for (const st of sel.steps) {
    g.save()
    if (st.op === 'add') drawShape(g, st.shape)
    else if (st.op === 'subtract') {
      g.globalCompositeOperation = 'destination-out'
      drawShape(g, st.shape)
    } else if (st.op === 'intersect') {
      tg.clearRect(0, 0, w, h)
      drawShape(tg, st.shape)
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(tmp, 0, 0)
    } else if (st.op === 'invert') {
      tg.clearRect(0, 0, w, h)
      tg.drawImage(c, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = '#fff'
      g.fillRect(0, 0, w, h)
      g.globalCompositeOperation = 'destination-out'
      g.drawImage(tmp, 0, 0)
    } else if (st.op === 'feather') {
      tg.clearRect(0, 0, w, h)
      tg.drawImage(c, 0, 0)
      g.clearRect(0, 0, w, h)
      // Photoshop's feather radius is roughly two standard deviations.
      g.filter = `blur(${st.radius / 2}px)`
      g.drawImage(tmp, 0, 0)
    }
    g.restore()
  }
  cache.set(sel, { w, h, canvas: c })
  return c
}

/** Bounds of the selected pixels, or null if nothing is selected. */
export function selectionBounds(sel: Selection, w: number, h: number): Rect | null {
  const m = selectionMask(sel, w, h)
  const entry = cache.get(sel)!
  if (entry.bounds !== undefined) return entry.bounds
  const data = m.getContext('2d')!.getImageData(0, 0, m.width, m.height).data
  entry.bounds = maskBounds(data, m.width, m.height, 4, 3)
  return entry.bounds
}

/** Stores an 8-bit mask (0..255 per pixel) as a selection mask bitmap. */
export function maskFromArray(mask: Uint8Array, w: number, h: number): string {
  const img = new ImageData(w, h)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]
    if (v) {
      const p = i * 4
      img.data[p] = img.data[p + 1] = img.data[p + 2] = 255
      img.data[p + 3] = v
    }
  }
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(img, 0, 0)
  return putMask(c.transferToImageBitmap())
}

/** Stores the alpha of a canvas as a selection mask bitmap (e.g. Load Selection from layer). */
export function maskFromCanvas(src: OffscreenCanvas): string {
  const c = new OffscreenCanvas(src.width, src.height)
  const g = c.getContext('2d')!
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  return putMask(c.transferToImageBitmap())
}

// ---------------------------------------------------------------------------
// Marching ants
// ---------------------------------------------------------------------------

const antsProbe = new OffscreenCanvas(1, 1)
const antsCtx = antsProbe.getContext('2d', { willReadFrequently: true })!

/**
 * Screen pixels on the edge of the selection: inside pixels with an outside
 * 4-neighbour. `xf` maps document → screen (device pixels).
 */
export function antsEdges(sel: Selection, docW: number, docH: number, xf: { scale: number; ox: number; oy: number }, viewW: number, viewH: number): Uint32Array {
  const W = Math.max(1, Math.ceil(viewW))
  const H = Math.max(1, Math.ceil(viewH))
  if (antsProbe.width !== W || antsProbe.height !== H) {
    antsProbe.width = W
    antsProbe.height = H
  }
  antsCtx.clearRect(0, 0, W, H)
  antsCtx.imageSmoothingEnabled = xf.scale < 1
  const m = selectionMask(sel, docW, docH)
  antsCtx.drawImage(m, xf.ox, xf.oy, docW * xf.scale, docH * xf.scale)
  const d = antsCtx.getImageData(0, 0, W, H).data
  const inside = (i: number) => d[i * 4 + 3] >= 128
  const out: number[] = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!inside(i)) continue
      // Pixels beyond the view are unknown, so the view border never counts as an edge.
      if ((x > 0 && !inside(i - 1)) || (x < W - 1 && !inside(i + 1)) || (y > 0 && !inside(i - W)) || (y < H - 1 && !inside(i + W))) out.push(i)
    }
  }
  return Uint32Array.from(out)
}
