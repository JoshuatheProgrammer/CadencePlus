/**
 * Round brush engine. Stamps accumulate into a document-sized stroke buffer
 * at `flow` alpha; the stroke as a whole is applied at `opacity` (so going
 * over the same spot within one stroke never exceeds the opacity, as in
 * Photoshop). Pen pressure can drive size and flow.
 */
import { unionRect, type Rect } from '@core/model'
import { poolCanvas } from './tiles'
import { ctx2d, formatKey } from './format'

export interface BrushOptions {
  /** Diameter in document pixels. */
  size: number
  /** 0..100 */
  hardness: number
  /** 0..100 */
  opacity: number
  /** 0..100 */
  flow: number
  /** Stamp spacing, % of diameter. */
  spacing: number
  pressureSize: boolean
  pressureFlow: boolean
}

export const DEFAULT_BRUSH: BrushOptions = { size: 30, hardness: 80, opacity: 100, flow: 100, spacing: 12, pressureSize: true, pressureFlow: false }

const stamps = new Map<string, OffscreenCanvas>()

/** A single brush dab; the dab's centre is the canvas centre. */
export function stampImage(diameter: number, hardness: number, color: string): OffscreenCanvas {
  const dq = Math.max(0.5, Math.round(diameter * 2) / 2)
  const key = `${dq}|${hardness}|${color}|${formatKey()}`
  let c = stamps.get(key)
  if (c) return c
  if (stamps.size > 96) stamps.clear()
  const d = Math.ceil(dq) + 2
  c = new OffscreenCanvas(d, d)
  const g = ctx2d(c)
  const r = dq / 2
  const h = Math.min(1, Math.max(0, hardness / 100))
  if (h >= 0.99 || r < 1.5) {
    g.fillStyle = color
    g.beginPath()
    g.arc(d / 2, d / 2, r, 0, Math.PI * 2)
    g.fill()
  } else {
    const grad = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, r)
    grad.addColorStop(0, color)
    grad.addColorStop(h, color)
    grad.addColorStop(1, color + '00')
    g.fillStyle = grad
    g.fillRect(0, 0, d, d)
  }
  stamps.set(key, c)
  return c
}

export class Stroke {
  readonly canvas: OffscreenCanvas
  bounds: Rect | null = null
  rev = 0
  private last: { x: number; y: number; p: number } | null = null
  private residual = 0
  private readonly g: OffscreenCanvasRenderingContext2D

  constructor(
    w: number,
    h: number,
    private readonly color: string,
    private readonly o: BrushOptions,
    readonly erase: boolean
  ) {
    this.canvas = poolCanvas('stroke', w, h)
    this.g = ctx2d(this.canvas)
  }

  get opacity(): number {
    return this.o.opacity / 100
  }

  private diameter(p: number): number {
    return Math.max(0.5, this.o.size * (this.o.pressureSize ? Math.max(0.05, p) : 1))
  }

  private dab(x: number, y: number, p: number): void {
    const d = this.diameter(p)
    const img = stampImage(d, this.o.hardness, this.erase ? '#000000' : this.color)
    this.g.globalAlpha = (this.o.flow / 100) * (this.o.pressureFlow ? p : 1)
    this.g.drawImage(img, x - img.width / 2, y - img.height / 2)
    this.bounds = unionRect(this.bounds, { x: Math.floor(x - img.width / 2), y: Math.floor(y - img.height / 2), w: img.width + 1, h: img.height + 1 })
  }

  /** Adds a point; `pressure` is 0..1 (use 1 for mice). */
  add(x: number, y: number, pressure: number): void {
    const p = Math.min(1, Math.max(0, pressure))
    if (!this.last) {
      this.dab(x, y, p)
      this.last = { x, y, p }
      this.rev++
      return
    }
    const { x: x0, y: y0, p: p0 } = this.last
    const len = Math.hypot(x - x0, y - y0)
    if (len === 0) return
    // The first dab of a segment lands `residual` past its start (the previous
    // segment's leftover spacing), so dabs stay evenly spaced across segments.
    let dist = this.residual
    while (dist <= len) {
      const t = dist / len
      const pp = p0 + (p - p0) * t
      if (dist > 0) this.dab(x0 + (x - x0) * t, y0 + (y - y0) * t, pp)
      dist += Math.max(0.5, (this.diameter(pp) * this.o.spacing) / 100)
    }
    this.residual = dist - len
    this.last = { x, y, p }
    this.rev++
  }

  /** Draws a straight segment to (x, y) (Shift-click lines). */
  lineTo(x: number, y: number, pressure: number): void {
    this.add(x, y, pressure)
  }
}
