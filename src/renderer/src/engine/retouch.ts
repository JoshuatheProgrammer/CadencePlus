/**
 * Retouching brushes. Blur, Sharpen, Dodge, Burn, Sponge and the History
 * Brush paint a processed copy of the layer through the stroke's coverage:
 * result = layer × (1 − c) + processed × c, so one stroke moves the pixels
 * at most `strength` of the way and stroking again builds up. Smudge is
 * different: it carries colour along the drag dab by dab.
 */
import type { ShaderOp } from '@core/adjustments'
import { spongeOp, toneOp, unsharpOp, type ToneRange } from '@core/filters'
import { unionRect, type ImageDocument, type Layer, type Rect } from '@core/model'
import { stampImage } from './brush'
import { ctx2d, pixelCanvas } from './format'
import { drawWithOp } from './ops'
import { layerCanvas } from './pixels'

export type RetouchKind = 'blur' | 'sharpen' | 'dodge' | 'burn' | 'sponge'

export interface RetouchSettings {
  kind: RetouchKind
  /** Brush diameter (px): sets the blur/sharpen radius. */
  size: number
  /** 0..100 */
  strength: number
  range?: ToneRange
  desaturate?: boolean
}

/** Blur radius for the Blur tool: a quarter of the brush, scaled by strength. */
export const blurToolRadius = (size: number, strength: number) => Math.max(0.5, (size / 4) * (strength / 100))

function opFor(s: RetouchSettings): ShaderOp | string {
  switch (s.kind) {
    case 'blur':
      return `blur(${blurToolRadius(s.size, s.strength)}px)`
    case 'sharpen':
      return unsharpOp(s.strength * 3, Math.max(1, s.size / 20), 0)
    case 'dodge':
    case 'burn':
      return toneOp(s.kind === 'burn', s.range ?? 'midtones', s.strength)
    case 'sponge':
      return spongeOp(!!s.desaturate, s.strength)
  }
}

/** The layer's pixels with the tool's effect applied everywhere (document-sized). */
export function retouchSource(doc: ImageDocument, layer: Layer, s: RetouchSettings): OffscreenCanvas {
  const src = layerCanvas(doc, layer, 'retouch.src')
  const out = pixelCanvas(doc.width, doc.height)
  drawWithOp(ctx2d(out), src, opFor(s), 1, { x: 0, y: 0, w: doc.width, h: doc.height })
  return out
}

/** A private copy of a layer's pixels in another history state (History Brush source). */
export function historySource(state: ImageDocument, layerId: string): OffscreenCanvas | null {
  const l = state.layers.find((x) => x.id === layerId)
  if (!l) return null
  const src = layerCanvas(state, l, 'history.src')
  const out = pixelCanvas(state.width, state.height)
  ctx2d(out).drawImage(src, 0, 0)
  return out
}

/**
 * Smudge: each dab deposits the colour carried so far (at `strength`), then
 * picks up the result. `work` holds the layer as it is being smudged and
 * `coverage` marks every pixel a dab touched (for preview and commit).
 */
export class Smudger {
  readonly work: OffscreenCanvas
  readonly coverage: OffscreenCanvas
  bounds: Rect | null = null
  rev = 0
  private readonly g: OffscreenCanvasRenderingContext2D
  private finger: OffscreenCanvas | null = null
  private last: { x: number; y: number } | null = null
  private residual = 0
  private readonly d: number

  constructor(
    doc: ImageDocument,
    layer: Layer,
    size: number,
    private readonly hardness: number,
    private readonly strength: number,
    private readonly spacing: number
  ) {
    this.work = pixelCanvas(doc.width, doc.height)
    this.g = ctx2d(this.work)
    this.g.drawImage(layerCanvas(doc, layer, 'smudge.src'), 0, 0)
    this.coverage = new OffscreenCanvas(doc.width, doc.height)
    this.d = Math.max(2, Math.round(size))
  }

  private dab(x: number, y: number): void {
    const stamp = stampImage(this.d, this.hardness, '#000000')
    const n = stamp.width
    const x0 = Math.round(x - n / 2)
    const y0 = Math.round(y - n / 2)
    if (!this.finger) {
      // First dab: pick up what is under the brush.
      this.finger = pixelCanvas(n, n)
      ctx2d(this.finger).drawImage(this.work, -x0, -y0)
      return
    }
    // Deposit: work = work × (1 − m·s) + finger × m·s, m = brush stamp.
    const dep = pixelCanvas(n, n)
    const dg = ctx2d(dep)
    dg.drawImage(this.finger, 0, 0)
    dg.globalCompositeOperation = 'destination-in'
    dg.drawImage(stamp, 0, 0)
    const g = this.g
    g.save()
    g.globalAlpha = this.strength / 100
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(stamp, x0, y0)
    g.globalCompositeOperation = 'lighter'
    g.drawImage(dep, x0, y0)
    g.restore()
    // Pick up the result for the next dab.
    const fg = ctx2d(this.finger)
    fg.clearRect(0, 0, n, n)
    fg.drawImage(this.work, -x0, -y0)
    const cg = this.coverage.getContext('2d')!
    cg.fillRect(x0, y0, n, n)
    this.bounds = unionRect(this.bounds, { x: x0, y: y0, w: n, h: n })
  }

  add(x: number, y: number): void {
    if (!this.last) {
      this.dab(x, y)
      this.last = { x, y }
      return
    }
    const { x: x0, y: y0 } = this.last
    const len = Math.hypot(x - x0, y - y0)
    if (len === 0) return
    const step = Math.max(1, (this.d * this.spacing) / 100)
    let dist = this.residual || step
    while (dist <= len) {
      const t = dist / len
      this.dab(x0 + (x - x0) * t, y0 + (y - y0) * t)
      dist += step
    }
    this.residual = dist - len
    this.last = { x, y }
    this.rev++
  }
}
