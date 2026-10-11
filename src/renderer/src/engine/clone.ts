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
 * Spot Healing: finds the nearby offset whose surroundings best match the
 * area around the stroke (sum of squared differences over a ring outside
 * the stroke), so the patch's texture continues the neighbourhood. Returns
 * the offset to heal from, or null when no candidate fits on the canvas.
 */
export function spotSource(stroke: OffscreenCanvas, src: OffscreenCanvas, bounds: Rect): { dx: number; dy: number } | null {
  const W = src.width
  const H = src.height
  const pad = Math.max(4, Math.round(Math.max(bounds.w, bounds.h) / 3))
  const R = intersectRect({ x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 }, { x: 0, y: 0, w: W, h: H })
  if (!R) return null
  // Work on a reduced copy for speed: at most ~64 px across the ring box.
  const k = Math.min(1, 64 / Math.max(R.w, R.h))
  const rw = Math.max(1, Math.round(R.w * k))
  const rh = Math.max(1, Math.round(R.h * k))
  const read = (c: OffscreenCanvas, x: number, y: number, w: number, h: number) => {
    const t = new OffscreenCanvas(rw, rh)
    const g = t.getContext('2d', { willReadFrequently: true })!
    g.imageSmoothingQuality = 'medium'
    g.drawImage(c, x, y, w, h, 0, 0, rw, rh)
    return g.getImageData(0, 0, rw, rh).data
  }
  const cov = read(stroke, R.x, R.y, R.w, R.h)
  const dst = read(src, R.x, R.y, R.w, R.h)
  const span = Math.max(bounds.w, bounds.h)
  let best: { dx: number; dy: number; score: number } | null = null
  for (const f of [1.1, 1.6, 2.3]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const dx = Math.round(Math.cos(a) * span * f)
      const dy = Math.round(Math.sin(a) * span * f)
      if (R.x + dx < 0 || R.y + dy < 0 || R.x + dx + R.w > W || R.y + dy + R.h > H) continue
      const s = read(src, R.x + dx, R.y + dy, R.w, R.h)
      let score = 0
      let n = 0
      for (let p = 0; p < s.length; p += 4) {
        // Compare only the ring around the stroke; the stroke itself is what gets replaced.
        if (cov[p + 3] > 8) continue
        for (let c = 0; c < 3; c++) score += (s[p + c] - dst[p + c]) ** 2
        n++
      }
      if (!n) continue
      score = score / n + f * 4 // mild preference for nearby texture
      if (!best || score < best.score) best = { dx, dy, score }
    }
  }
  return best && { dx: best.dx, dy: best.dy }
}

/**
 * Healed pixels inside `bounds`: source detail + destination low frequencies,
 * masked by the stroke's coverage. `radius` sets what counts as "detail".
 */
export function healPixels(stroke: OffscreenCanvas, src: OffscreenCanvas, dst: OffscreenCanvas, dx: number, dy: number, bounds: Rect, radius0: number): OffscreenCanvas {
  const W = stroke.width
  const H = stroke.height
  // The colour and light come from around the stroke, so the blur must reach its middle.
  const radius = Math.max(radius0, Math.max(bounds.w, bounds.h) / 3)
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
  // Destination low frequencies from the surroundings only: a blur of the
  // destination with the stroked area cut out (read back un-premultiplied,
  // which normalises by the remaining weight).
  const cut = new OffscreenCanvas(W, H)
  const cg = ctx2d(cut)
  cg.drawImage(dst, 0, 0)
  cg.globalCompositeOperation = 'destination-out'
  cg.drawImage(stroke, 0, 0)
  const Dl = region((g) => g.drawImage(cut, -R.x, -R.y), radius)
  const Dfull = region((g) => g.drawImage(dst, -R.x, -R.y), radius)
  const img = new ImageData(R.w, R.h)
  const o = img.data
  for (let p = 0; p < o.length; p += 4) {
    const low = Dl[p + 3] > 2 ? Dl : Dfull
    for (let k = 0; k < 3; k++) o[p + k] = S[p + k] - Sl[p + k] + low[p + k]
    o[p + 3] = S[p + 3]
  }
  const og = ctx2d(out)
  og.putImageData(img, R.x, R.y)
  og.globalCompositeOperation = 'destination-in'
  og.drawImage(stroke, 0, 0)
  return out
}
