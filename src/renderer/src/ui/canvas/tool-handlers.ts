/**
 * Pointer behaviour for each tool. A handler receives the press and returns a
 * session that follows the drag; commits happen on release as single edits.
 */
import { activeLayer, type ImageDocument, type Rect } from '@core/model'
import { apply, scaleFromHandle } from '@core/affine'
import * as E from '@core/edit'
import { descendants, effectivelyVisible } from '@core/tree'
import { hexToRgb } from '@core/color'
import { dragRect, type SelMode } from '@core/selection'
import { clampZoom, panBy, zoomAt, type View } from '@core/view'
import { Stroke } from '../../engine/brush'
import { layerAlphaAt } from '../../engine/pixels'
import { floatSize } from '../../engine/transform'
import { commitText, createShape, editText, moveVector, startNewText, textLayerAt } from '../../state/vector-actions'
import { edit, setView } from '../../state/doc-actions'
import * as A from '../../state/image-actions'
import { get, set, toast, type ToolId } from '../../state/store'
import { commitTransform, startTransform, transformMatrix, updateTransform } from '../../state/transform-actions'
import { cropHandleAt, overlay, requestOverlay, type CropHandle } from './overlay'

export interface Pt {
  /** Document coordinates (unrounded). */
  x: number
  y: number
  /** Viewport CSS pixels. */
  sx: number
  sy: number
}

export interface ToolContext {
  docId: string
  doc: ImageDocument
  view: View
  /** Viewport size, CSS pixels. */
  w: number
  h: number
}

export interface Session {
  move(p: Pt, e: PointerEvent): void
  up(p: Pt, e: PointerEvent): void
  cancel?(): void
}

type Handler = (c: ToolContext, p: Pt, e: PointerEvent) => Session | null

const NOOP: Session = { move() {}, up() {} }

/** Selection mode from modifier keys (Shift add, Alt subtract, both intersect), else the options bar mode. */
function selMode(e: PointerEvent, base: SelMode): SelMode {
  if (e.shiftKey && e.altKey) return 'intersect'
  if (e.shiftKey) return 'add'
  if (e.altKey) return 'subtract'
  return base
}

const modeLabel = (m: SelMode, what: string) => (m === 'add' ? `Add to ${what}` : m === 'subtract' ? `Subtract from ${what}` : m === 'intersect' ? `Intersect ${what}` : what)

// ---------------------------------------------------------------------------

export function panSession(c: ToolContext, p: Pt): Session {
  const start = c.view
  return {
    move(q) {
      setView(c.docId, panBy(start, q.sx - p.sx, q.sy - p.sy))
    },
    up() {}
  }
}

const move: Handler = (c, p) => {
  let doc = c.doc
  // With a selection, the Move tool lifts and moves the selected pixels.
  if (doc.selection) {
    if (!startTransform('move')) return null
    const s = transformSession(c, p, { kind: 'move' })
    return {
      move: s.move,
      up() {
        commitTransform()
      },
      cancel() {
        commitTransform()
      }
    }
  }
  if (get().options.move.autoSelect) {
    const id = topLayerAt(doc, p.x, p.y)
    if (id && id !== doc.activeLayerId) {
      A.selectLayer(id)
      doc = { ...doc, activeLayerId: id }
    }
  }
  const l = activeLayer(doc)
  if (!l) return null
  if (l.locked) return toast(`“${l.name}” is locked. Unlock it to move it.`, 'warn'), null
  if (l.content.type === 'group') {
    const starts = E.positionsOf(doc, descendants(doc.layers, l.id).map((x) => x.id))
    const gkey = `move:${l.id}:${Date.now()}`
    return {
      move(q, e) {
        let dx = Math.round(q.x - p.x)
        let dy = Math.round(q.y - p.y)
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
        edit('Move', (x) => E.offsetLayers(x, starts, dx, dy), gkey)
      },
      up() {}
    }
  }
  if (l.content.type === 'text' || l.content.type === 'shape') {
    const start = l.content.params
    const vkey = `move:${l.id}:${Date.now()}`
    return {
      move(q, e) {
        let dx = Math.round(q.x - p.x)
        let dy = Math.round(q.y - p.y)
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
        moveVector(l.id, start, dx, dy, vkey)
      },
      up() {}
    }
  }
  if (l.content.type !== 'raster') return toast(`“${l.name}” covers the whole canvas and cannot be moved.`, 'warn'), null
  const x0 = l.content.x
  const y0 = l.content.y
  const key = `move:${l.id}:${Date.now()}`
  return {
    move(q, e) {
      let dx = Math.round(q.x - p.x)
      let dy = Math.round(q.y - p.y)
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
      A.setLayerPosition(l.id, x0 + dx, y0 + dy, key)
    },
    up() {}
  }
}

/** Topmost visible layer with a non-transparent pixel at (x, y). */
function topLayerAt(doc: ImageDocument, x: number, y: number): string | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]
    if (l.content.type === 'adjustment' || l.content.type === 'group' || !effectivelyVisible(doc, l)) continue
    if (l.content.type === 'fill') return l.id
    const px = layerAlphaAt(doc, l, x, y)
    if (px > 0) return l.id
  }
  return null
}

const marquee: Handler = (c, p, e) => {
  const o = get().options.marquee
  const mode = selMode(e, o.mode)
  const shiftStart = e.shiftKey
  const altStart = e.altKey
  let rect: Rect | null = null
  return {
    move(q, ev) {
      rect = dragRect(p.x, p.y, q.x, q.y, ev.shiftKey && !shiftStart, ev.altKey && !altStart)
      if (o.shape === 'rect') rect = roundRect(rect)
      overlay.marquee = { shape: o.shape, rect }
      requestOverlay()
    },
    up() {
      overlay.marquee = null
      requestOverlay()
      if (!rect || rect.w < 1 || rect.h < 1) {
        if (mode === 'replace') A.deselect()
        return
      }
      A.addSelectionShape({ kind: o.shape, ...rect }, mode, modeLabel(mode, o.shape === 'rect' ? 'Rectangular Marquee' : 'Elliptical Marquee'))
    },
    cancel() {
      overlay.marquee = null
      requestOverlay()
    }
  }
}

function roundRect(r: Rect): Rect {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }
}

const lasso: Handler = (_c, p, e) => {
  const mode = selMode(e, get().options.lasso.mode)
  const pts = [p.x, p.y]
  overlay.lasso = pts
  return {
    move(q) {
      const lx = pts[pts.length - 2]
      const ly = pts[pts.length - 1]
      if (Math.hypot(q.x - lx, q.y - ly) * _c.view.zoom < 2) return
      pts.push(q.x, q.y)
      requestOverlay()
    },
    up() {
      overlay.lasso = null
      requestOverlay()
      if (pts.length < 6) {
        if (mode === 'replace') A.deselect()
        return
      }
      A.addSelectionShape({ kind: 'polygon', points: pts.map((v) => Math.round(v * 100) / 100) }, mode, modeLabel(mode, 'Lasso'))
    },
    cancel() {
      overlay.lasso = null
      requestOverlay()
    }
  }
}

const wand: Handler = (_c, p, e) => {
  A.wandSelect(p.x, p.y, selMode(e, get().options.wand.mode))
  return NOOP
}

const eyedropper: Handler = (_c, p, e) => {
  A.pickColor(p.x, p.y, e.altKey)
  return {
    move(q, ev) {
      A.pickColor(q.x, q.y, ev.altKey)
    },
    up() {}
  }
}

/** Last painted point per document, for Shift+click straight lines. */
const lastPaint = new Map<string, { x: number; y: number }>()

function paint(erase: boolean): Handler {
  return (c, p, e) => {
    const s = get()
    if (!erase && e.altKey) return eyedropper(c, p, e)
    const t = A.paintTarget(erase ? 'erase' : 'paint on it')
    if (!t) return null
    const o = erase ? s.options.eraser : s.options.brush
    const stroke = new Stroke(c.doc.width, c.doc.height, s.fg, o, erase)
    const { r, g, b } = hexToRgb(s.fg)
    // On a mask the brush paints its darkness: black hides, white reveals.
    const maskValue = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255
    const pressure = (ev: PointerEvent) => (ev.pointerType === 'pen' ? ev.pressure : 1)
    const last = lastPaint.get(c.docId)
    if (e.shiftKey && last) {
      stroke.add(last.x, last.y, pressure(e))
      stroke.lineTo(p.x, p.y, pressure(e))
    } else stroke.add(p.x, p.y, pressure(e))
    const preview = () => set({ stroke: { layerId: t.layer.id, canvas: stroke.canvas, opacity: stroke.opacity, erase, rev: stroke.rev, target: t.kind, maskValue } })
    preview()
    let lastPt = { x: p.x, y: p.y }
    return {
      move(q, ev) {
        const evs = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : []
        if (evs.length > 1) {
          for (const ce of evs) {
            const d = toDocFromEvent(c, ce)
            stroke.add(d.x, d.y, pressure(ce))
            lastPt = d
          }
        } else {
          stroke.add(q.x, q.y, pressure(ev))
          lastPt = { x: q.x, y: q.y }
        }
        preview()
      },
      up() {
        lastPaint.set(c.docId, lastPt)
        A.commitStroke(stroke, erase ? 'Eraser' : 'Brush')
        set({ stroke: null })
      },
      cancel() {
        set({ stroke: null })
      }
    }
  }
}

/** Set by the viewport: maps a pointer event to document coordinates. */
let toDocFromEvent: (c: ToolContext, e: PointerEvent) => { x: number; y: number } = () => ({ x: 0, y: 0 })
export function setEventMapper(fn: typeof toDocFromEvent): void {
  toDocFromEvent = fn
}

const gradient: Handler = (_c, p) => {
  if (!A.paintTarget('draw a gradient on it')) return null
  let end = { x: p.x, y: p.y }
  return {
    move(q, e) {
      end = { x: q.x, y: q.y }
      if (e.shiftKey) {
        const a = Math.atan2(q.y - p.y, q.x - p.x)
        const snapped = Math.round(a / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(q.x - p.x, q.y - p.y)
        end = { x: p.x + Math.cos(snapped) * len, y: p.y + Math.sin(snapped) * len }
      }
      overlay.gradient = [p.x, p.y, end.x, end.y]
      requestOverlay()
    },
    up() {
      overlay.gradient = null
      requestOverlay()
      A.gradientFill(p.x, p.y, end.x, end.y)
    },
    cancel() {
      overlay.gradient = null
      requestOverlay()
    }
  }
}

const bucket: Handler = (_c, p) => {
  A.bucketFill(p.x, p.y)
  return NOOP
}

const zoom: Handler = (c, p, e) => {
  const out = e.altKey !== get().options.zoom.out
  let dragged = false
  return {
    move(q) {
      if (!dragged && Math.hypot(q.sx - p.sx, q.sy - p.sy) < 5) return
      dragged = true
      overlay.zoomRect = dragRect(p.x, p.y, q.x, q.y, false, false)
      requestOverlay()
    },
    up(q) {
      const r = overlay.zoomRect
      overlay.zoomRect = null
      requestOverlay()
      if (dragged && r && r.w > 0 && r.h > 0) {
        const z = clampZoom(Math.min(c.w / r.w, c.h / r.h))
        setView(c.docId, { zoom: z, cx: r.x + r.w / 2, cy: r.y + r.h / 2 })
        return
      }
      const factor = out ? 1 / 2 : 2
      setView(c.docId, zoomAt(c.view, c.w, c.h, c.view.zoom * factor, q.sx, q.sy))
    }
  }
}

const crop: Handler = (c, p) => {
  const cur = get().crop
  const handle: CropHandle | null = cur ? cropHandleAt(c, cur, p.sx, p.sy) : null
  const docRect = { x: 0, y: 0, w: c.doc.width, h: c.doc.height }
  const start = cur ?? docRect
  return {
    move(q, e) {
      const dx = q.x - p.x
      const dy = q.y - p.y
      let r: Rect
      if (!handle) r = dragRect(p.x, p.y, q.x, q.y, e.shiftKey, e.altKey)
      else if (handle === 'move') r = { ...start, x: start.x + dx, y: start.y + dy }
      else {
        let x0 = start.x
        let y0 = start.y
        let x1 = start.x + start.w
        let y1 = start.y + start.h
        if (handle.includes('w')) x0 += dx
        if (handle.includes('e')) x1 += dx
        if (handle.includes('n')) y0 += dy
        if (handle.includes('s')) y1 += dy
        r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
      }
      set({ crop: roundRect(r) })
    },
    up() {
      const r = get().crop
      if (!handle && (!r || r.w < 1 || r.h < 1)) set({ crop: cur })
    }
  }
}

const type: Handler = (_c, p) => {
  if (get().textEdit) commitText()
  const hit = textLayerAt(p.x, p.y)
  if (hit) editText(hit)
  else startNewText(p.x, p.y)
  return NOOP
}

const shape: Handler = (_c, p, e) => {
  const kind = get().options.shape.kind
  const altStart = e.altKey
  let rect: Rect | null = null
  let end = { x: p.x, y: p.y }
  return {
    move(q, ev) {
      end = { x: q.x, y: q.y }
      if (kind === 'line') {
        if (ev.shiftKey) {
          const a = Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4)) * (Math.PI / 4)
          const len = Math.hypot(q.x - p.x, q.y - p.y)
          end = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len }
        }
        overlay.gradient = [p.x, p.y, end.x, end.y]
      } else {
        rect = roundRect(dragRect(p.x, p.y, q.x, q.y, ev.shiftKey, ev.altKey || altStart))
        overlay.marquee = { shape: kind === 'ellipse' ? 'ellipse' : 'rect', rect }
      }
      requestOverlay()
    },
    up() {
      overlay.marquee = null
      overlay.gradient = null
      requestOverlay()
      createShape(rect ?? { x: p.x, y: p.y, w: 0, h: 0 }, p, end)
    },
    cancel() {
      overlay.marquee = null
      overlay.gradient = null
      requestOverlay()
    }
  }
}

export const HANDLERS: Partial<Record<ToolId, Handler>> = {
  text: type,
  shape,
  move,
  marquee,
  lasso,
  wand,
  crop,
  eyedropper,
  brush: paint(false),
  eraser: paint(true),
  gradient,
  bucket,
  zoom
}

// ---------------------------------------------------------------------------
// Free Transform box
// ---------------------------------------------------------------------------

export type TransformHit = { kind: 'handle'; hx: number; hy: number } | { kind: 'move' } | { kind: 'rotate' }

const HANDLES: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
]

/** Screen positions of the box corners (TL, TR, BR, BL) and the eight handles. */
export function transformGeometry(c: { view: View; w: number; h: number }) {
  const t = get().transform
  if (!t) return null
  const m = transformMatrix(t)
  const { w: fw, h: fh } = floatSize(t.fs)
  const toScreen = (lx: number, ly: number) => {
    const d = apply(m, lx, ly)
    return { x: (d.x - c.view.cx) * c.view.zoom + c.w / 2, y: (d.y - c.view.cy) * c.view.zoom + c.h / 2 }
  }
  const box = [toScreen(0, 0), toScreen(fw, 0), toScreen(fw, fh), toScreen(0, fh)]
  const handles = HANDLES.map(([hx, hy]) => ({ hx, hy, ...toScreen((fw / 2) * (1 + hx), (fh / 2) * (1 + hy)) }))
  return { box, handles, center: toScreen(fw / 2, fh / 2) }
}

function inside(pts: { x: number; y: number }[], x: number, y: number): boolean {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    if (cross !== 0) {
      if (s === 0) s = Math.sign(cross)
      else if (Math.sign(cross) !== s) return false
    }
  }
  return true
}

export function transformHitAt(c: { view: View; w: number; h: number }, sx: number, sy: number): TransformHit | null {
  const g = transformGeometry(c)
  if (!g) return null
  for (const h of g.handles) if (Math.abs(h.x - sx) <= 6 && Math.abs(h.y - sy) <= 6) return { kind: 'handle', hx: h.hx, hy: h.hy }
  return inside(g.box, sx, sy) ? { kind: 'move' } : { kind: 'rotate' }
}

export function transformSession(c: ToolContext, p: Pt, hit: TransformHit): Session {
  const t = get().transform!
  const start = t.params
  const { w: fw, h: fh } = floatSize(t.fs)
  const exactMove = t.mode === 'move'
  void c
  if (hit.kind === 'move') {
    return {
      move(q, e) {
        let dx = q.x - p.x
        let dy = q.y - p.y
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
        if (exactMove) {
          dx = Math.round(dx)
          dy = Math.round(dy)
        }
        updateTransform({ ...start, cx: start.cx + dx, cy: start.cy + dy })
      },
      up() {}
    }
  }
  if (hit.kind === 'rotate') {
    const a0 = Math.atan2(p.y - start.cy, p.x - start.cx)
    return {
      move(q, e) {
        let rot = start.rot + Math.atan2(q.y - start.cy, q.x - start.cx) - a0
        if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
        updateTransform({ ...start, rot })
      },
      up() {}
    }
  }
  const corner = hit.hx !== 0 && hit.hy !== 0
  const cos = Math.cos(start.rot)
  const sin = Math.sin(start.rot)
  return {
    move(q, e) {
      const dx = q.x - start.cx
      const dy = q.y - start.cy
      const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
      // Corners keep proportions unless Shift is held (as in current Photoshop); edges stretch.
      const keep = corner ? !e.shiftKey : e.shiftKey
      updateTransform(scaleFromHandle(start, fw, fh, hit.hx, hit.hy, local, keep, e.altKey))
    },
    up() {}
  }
}
