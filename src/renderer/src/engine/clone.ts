/**
 * Clone Stamp and Healing Brush sources. The brush stroke supplies coverage;
 * these turn it into coloured pixels taken from a source offset.
 *
 * Healing uses frequency separation: the result keeps the source's fine
 * detail (source − blur(source)) on top of the destination's own colour and
 * light (blur(destination)), so a patch takes on its surroundings' tone.
 */
import type { ImageDocument, Layer, Rect } from '@core/model'
import { intersectRect } from '@core/model'
import { layerCanvas } from './pixels'
import { renderComposite } from './render'
import { ctx2d } from './format'

/** A private snapshot of the pixels to clone from (taken when the stroke starts). */
export function sourceSnapshot(doc: ImageDocument, sampleAll: boolean, active: Layer | undefined): OffscreenCanvas {
  const src = sampleAll || !active ? renderComposite(doc, 'clone.src') : layerCanvas(doc, active, 'clone.src')
  const c = new OffscreenCanvas(doc.width, doc.height)
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

/** Coverage (alpha of `stroke`) filled with the source shifted by (dx, dy): pixel p shows source p + d. */
export function clonePixels(stroke: OffscreenCanvas, src: OffscreenCanvas, dx: number, dy: number): OffscreenCanvas {
  const c = new OffscreenCanvas(stroke.width, stroke.height)
  const g = ctx2d(c)
  g.drawImage(stroke, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.drawImage(src, -dx, -dy)
  return c
}

/**
 * Healed pixels inside `bounds`: source detail + destination low frequencies,
 * masked by the stroke's coverage. `radius` sets what counts as "detail".
 */
export function healPixels(stroke: OffscreenCanvas, src: OffscreenCanvas, dst: OffscreenCanvas, dx: number, dy: number, bounds: Rect, radius: number): OffscreenCanvas {
  const W = stroke.width
  const H = stroke.height
  const pad = Math.ceil(radius * 3)
  const R = intersectRect({ x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 }, { x: 0, y: 0, w: W, h: H })
  const out = new OffscreenCanvas(W, H)
  if (!R) return out
  const region = (draw: (g: OffscreenCanvasRenderingContext2D) => void, blur = 0) => {
    const c = new OffscreenCanvas(R.w, R.h)
    const g = ctx2d(c, { willReadFrequently: true })
    if (blur > 0) g.filter = `blur(${blur}px)`
    draw(g)
    return g.getImageData(0, 0, R.w, R.h).data
  }
  const S = region((g) => g.drawImage(src, -R.x - dx, -R.y - dy))
  const Sl = region((g) => g.drawImage(src, -R.x - dx, -R.y - dy), radius)
  const Dl = region((g) => g.drawImage(dst, -R.x, -R.y), radius)
  const img = new ImageData(R.w, R.h)
  const o = img.data
  for (let p = 0; p < o.length; p += 4) {
    for (let k = 0; k < 3; k++) o[p + k] = S[p + k] - Sl[p + k] + Dl[p + k]
    o[p + 3] = S[p + 3]
  }
  const og = ctx2d(out)
  og.putImageData(img, R.x, R.y)
  og.globalCompositeOperation = 'destination-in'
  og.drawImage(stroke, 0, 0)
  return out
}
