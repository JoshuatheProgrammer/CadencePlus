/**
 * Everything drawn over the document that is not pixels: marching ants,
 * in-progress tool previews, the crop box and the brush cursor.
 * All drawing is in CSS pixels × dpr.
 */
import type { ImageDocument, Rect } from '@core/model'
import type { Selection } from '@core/selection'
import type { View } from '@core/view'
import { antsEdges } from '../../engine/selection'
import { transformGeometry } from './tool-handlers'

export interface OverlayState {
  marquee?: { shape: 'rect' | 'ellipse'; rect: Rect } | null
  lasso?: number[] | null
  gradient?: [number, number, number, number] | null
  zoomRect?: Rect | null
  /** Pointer position in viewport CSS pixels (null when outside). */
  pointer?: { x: number; y: number } | null
}

export const overlay: OverlayState = {}

let listener: (() => void) | null = null
export function onOverlayRequest(cb: (() => void) | null): void {
  listener = cb
}
export function requestOverlay(): void {
  listener?.()
}

export interface OverlayFrame {
  doc: ImageDocument
  view: View
  /** CSS pixels */
  w: number
  h: number
  dpr: number
  crop: Rect | null
  /** Brush/eraser diameter in document pixels, when one of them is active. */
  brushSize: number | null
  antsPhase: number
  /** Draw the Free Transform box. */
  transform?: boolean
}

const toScreen = (f: OverlayFrame, x: number, y: number): [number, number] => [(x - f.view.cx) * f.view.zoom + f.w / 2, (y - f.view.cy) * f.view.zoom + f.h / 2]

// ---------------------------------------------------------------------------
// Marching ants (cached edge list, re-coloured each tick)
// ---------------------------------------------------------------------------

let antsKey: { sel: Selection | null; zoom: number; cx: number; cy: number; W: number; H: number; dw: number; dh: number } | null = null
let edges: Uint32Array = new Uint32Array(0)
let antsCanvas: OffscreenCanvas | null = null
let antsImage: ImageData | null = null
let edgeBox = { x0: 0, y0: 0, x1: 0, y1: 0 }

function updateAnts(f: OverlayFrame, W: number, H: number): void {
  const sel = f.doc.selection
  const k = antsKey
  if (k && k.sel === sel && k.zoom === f.view.zoom && k.cx === f.view.cx && k.cy === f.view.cy && k.W === W && k.H === H && k.dw === f.doc.width && k.dh === f.doc.height) return
  antsKey = { sel, zoom: f.view.zoom, cx: f.view.cx, cy: f.view.cy, W, H, dw: f.doc.width, dh: f.doc.height }
  if (!sel) {
    edges = new Uint32Array(0)
    return
  }
  const scale = f.view.zoom * f.dpr
  edges = antsEdges(sel, f.doc.width, f.doc.height, { scale, ox: (f.w / 2 - f.view.cx * f.view.zoom) * f.dpr, oy: (f.h / 2 - f.view.cy * f.view.zoom) * f.dpr }, W, H)
  if (!antsCanvas || antsCanvas.width !== W || antsCanvas.height !== H) {
    antsCanvas = new OffscreenCanvas(W, H)
    antsImage = new ImageData(W, H)
  } else {
    // Each frame only uploads the edge bounding box, so wipe both buffers here.
    antsImage!.data.fill(0)
    antsCanvas.getContext('2d')!.clearRect(0, 0, W, H)
  }
  let x0 = W
  let y0 = H
  let x1 = 0
  let y1 = 0
  for (const i of edges) {
    const x = i % W
    const y = (i - x) / W
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  edgeBox = { x0, y0, x1, y1 }
}

function drawAnts(ctx: CanvasRenderingContext2D, f: OverlayFrame, W: number, H: number): void {
  updateAnts(f, W, H)
  if (!edges.length || !antsCanvas || !antsImage) return
  const d = antsImage.data
  for (const i of edges) {
    const x = i % W
    const y = (i - x) / W
    const on = ((x + y + f.antsPhase) >> 2) & 1
    const p = i * 4
    const v = on ? 255 : 0
    d[p] = d[p + 1] = d[p + 2] = v
    d[p + 3] = 255
  }
  const g = antsCanvas.getContext('2d')!
  const { x0, y0, x1, y1 } = edgeBox
  g.putImageData(antsImage, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
  ctx.drawImage(antsCanvas, 0, 0)
}

export function hasAnts(): boolean {
  return edges.length > 0
}

// ---------------------------------------------------------------------------
// Crop box geometry (shared with the crop tool's hit testing)
// ---------------------------------------------------------------------------

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

export function cropHandleAt(f: { view: View; w: number; h: number }, crop: Rect, px: number, py: number): CropHandle | null {
  const ff = f as OverlayFrame
  const [x0, y0] = toScreen(ff, crop.x, crop.y)
  const [x1, y1] = toScreen(ff, crop.x + crop.w, crop.y + crop.h)
  const near = (a: number, b: number) => Math.abs(a - b) <= 6
  const inX = px >= x0 - 6 && px <= x1 + 6
  const inY = py >= y0 - 6 && py <= y1 + 6
  if (!inX || !inY) return null
  const n = near(py, y0)
  const s = near(py, y1)
  const w = near(px, x0)
  const e = near(px, x1)
  if (n && w) return 'nw'
  if (n && e) return 'ne'
  if (s && w) return 'sw'
  if (s && e) return 'se'
  if (n) return 'n'
  if (s) return 's'
  if (w) return 'w'
  if (e) return 'e'
  if (px > x0 && px < x1 && py > y0 && py < y1) return 'move'
  return null
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/**
 * Visible on any image: dashed = black line with white dashes (marquee
 * style); solid = white line on a soft dark halo (cursors, guides).
 */
function dualStroke(ctx: CanvasRenderingContext2D, path: Path2D, w: number, dashed = false): void {
  ctx.setLineDash([])
  ctx.lineWidth = dashed ? w : w * 3
  ctx.strokeStyle = dashed ? '#000' : 'rgba(0,0,0,0.5)'
  ctx.stroke(path)
  ctx.lineWidth = w
  ctx.strokeStyle = '#fff'
  if (dashed) ctx.setLineDash([4 * w, 4 * w])
  ctx.stroke(path)
  ctx.setLineDash([])
}

export function drawOverlay(canvas: HTMLCanvasElement, f: OverlayFrame): void {
  const W = canvas.width
  const H = canvas.height
  const ctx = canvas.getContext('2d')!
  const dpr = f.dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)

  if (!f.transform) drawAnts(ctx, f, W, H)

  ctx.save()
  ctx.scale(dpr, dpr)
  const S = (x: number, y: number) => toScreen(f, x, y)

  if (overlay.marquee) {
    const { rect, shape } = overlay.marquee
    const [x0, y0] = S(rect.x, rect.y)
    const [x1, y1] = S(rect.x + rect.w, rect.y + rect.h)
    const p = new Path2D()
    if (shape === 'rect') p.rect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0))
    else p.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2)
    dualStroke(ctx, p, 1, true)
  }

  if (overlay.lasso && overlay.lasso.length >= 4) {
    const pts = overlay.lasso
    const p = new Path2D()
    const [sx, sy] = S(pts[0], pts[1])
    p.moveTo(sx, sy)
    for (let i = 2; i < pts.length; i += 2) {
      const [x, y] = S(pts[i], pts[i + 1])
      p.lineTo(x, y)
    }
    dualStroke(ctx, p, 1, true)
  }

  if (overlay.gradient) {
    const [ax, ay, bx, by] = overlay.gradient
    const [x0, y0] = S(ax, ay)
    const [x1, y1] = S(bx, by)
    const p = new Path2D()
    p.moveTo(x0, y0)
    p.lineTo(x1, y1)
    dualStroke(ctx, p, 1)
    for (const [x, y] of [
      [x0, y0],
      [x1, y1]
    ]) {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  if (overlay.zoomRect) {
    const r = overlay.zoomRect
    const [x0, y0] = S(r.x, r.y)
    const [x1, y1] = S(r.x + r.w, r.y + r.h)
    const p = new Path2D()
    p.rect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)
    dualStroke(ctx, p, 1, true)
  }

  if (f.crop) {
    const c = f.crop
    const [x0, y0] = S(c.x, c.y)
    const [x1, y1] = S(c.x + c.w, c.y + c.h)
    const shade = new Path2D()
    shade.rect(0, 0, f.w, f.h)
    shade.rect(x0, y0, x1 - x0, y1 - y0)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill(shade, 'evenodd')
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const t of [1 / 3, 2 / 3]) {
      ctx.moveTo(x0 + (x1 - x0) * t, y0)
      ctx.lineTo(x0 + (x1 - x0) * t, y1)
      ctx.moveTo(x0, y0 + (y1 - y0) * t)
      ctx.lineTo(x1, y0 + (y1 - y0) * t)
    }
    ctx.stroke()
    const box = new Path2D()
    box.rect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0))
    dualStroke(ctx, box, 1)
    const hs = 7
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    for (const [hx, hy] of [
      [x0, y0],
      [(x0 + x1) / 2, y0],
      [x1, y0],
      [x0, (y0 + y1) / 2],
      [x1, (y0 + y1) / 2],
      [x0, y1],
      [(x0 + x1) / 2, y1],
      [x1, y1]
    ]) {
      ctx.fillRect(Math.round(hx - hs / 2), Math.round(hy - hs / 2), hs, hs)
      ctx.strokeRect(Math.round(hx - hs / 2) + 0.5, Math.round(hy - hs / 2) + 0.5, hs - 1, hs - 1)
    }
    // Size readout
    const label = `${Math.round(c.w)} × ${Math.round(c.h)} px`
    ctx.font = '11px Segoe UI, system-ui, sans-serif'
    const tw = ctx.measureText(label).width + 12
    const lx = Math.min(Math.max(4, x0), f.w - tw - 4)
    const ly = y0 > 26 ? y0 - 24 : y1 + 6
    ctx.fillStyle = 'rgba(20,22,26,0.9)'
    ctx.fillRect(lx, ly, tw, 18)
    ctx.fillStyle = '#e8ecf2'
    ctx.fillText(label, lx + 6, ly + 13)
  }

  if (f.transform) {
    const g = transformGeometry({ view: f.view, w: f.w, h: f.h })
    if (g) {
      const p = new Path2D()
      p.moveTo(g.box[0].x, g.box[0].y)
      for (const q of g.box.slice(1)) p.lineTo(q.x, q.y)
      p.closePath()
      dualStroke(ctx, p, 1)
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.lineWidth = 1
      for (const h of g.handles) {
        ctx.fillRect(Math.round(h.x) - 3.5, Math.round(h.y) - 3.5, 7, 7)
        ctx.strokeRect(Math.round(h.x) - 3, Math.round(h.y) - 3, 6, 6)
      }
      const cp = new Path2D()
      cp.arc(g.center.x, g.center.y, 4, 0, Math.PI * 2)
      cp.moveTo(g.center.x - 7, g.center.y)
      cp.lineTo(g.center.x + 7, g.center.y)
      cp.moveTo(g.center.x, g.center.y - 7)
      cp.lineTo(g.center.x, g.center.y + 7)
      dualStroke(ctx, cp, 1)
    }
  }

  if (f.brushSize && overlay.pointer) {
    const { x, y } = overlay.pointer
    const r = (f.brushSize * f.view.zoom) / 2
    const p = new Path2D()
    if (r >= 3) p.arc(x, y, r, 0, Math.PI * 2)
    // A small crosshair keeps the hotspot visible for every size.
    p.moveTo(x - 4, y)
    p.lineTo(x + 4, y)
    p.moveTo(x, y - 4)
    p.lineTo(x, y + 4)
    dualStroke(ctx, p, 1)
  }
  ctx.restore()
}
