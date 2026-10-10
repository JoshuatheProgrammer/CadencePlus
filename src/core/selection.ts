/**
 * Selections as plain data: an ordered list of steps that the renderer
 * rasterises into an 8-bit mask. Keeping them as data makes selection changes
 * undoable and serialisable like any other edit.
 */
import type { Rect } from './model'

export type SelShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number }
  /** Flat [x0, y0, x1, y1, …] in document pixels; filled even-odd. */
  | { kind: 'polygon'; points: number[] }
  /** A rasterised mask (magic wand, pasted alpha) placed at (x, y). */
  | { kind: 'mask'; maskId: string; x: number; y: number }

export type SelMode = 'replace' | 'add' | 'subtract' | 'intersect'

export type SelStep =
  | { op: 'add' | 'subtract' | 'intersect'; shape: SelShape }
  | { op: 'invert' }
  | { op: 'feather'; radius: number }

export interface Selection {
  steps: SelStep[]
}

export function combine(sel: Selection | null, mode: SelMode, shape: SelShape): Selection | null {
  if (mode === 'replace') return { steps: [{ op: 'add', shape }] }
  // Subtracting from or intersecting with nothing leaves nothing.
  if (!sel) return mode === 'add' ? { steps: [{ op: 'add', shape }] } : null
  return { steps: [...sel.steps, { op: mode, shape }] }
}

export function selectAll(width: number, height: number): Selection {
  return { steps: [{ op: 'add', shape: { kind: 'rect', x: 0, y: 0, w: width, h: height } }] }
}

export function invert(sel: Selection | null): Selection | null {
  if (!sel) return null
  const last = sel.steps[sel.steps.length - 1]
  // Inverting twice is a no-op; drop the pair instead of growing the list.
  if (last?.op === 'invert') return { steps: sel.steps.slice(0, -1) }
  return { steps: [...sel.steps, { op: 'invert' }] }
}

export function feather(sel: Selection | null, radius: number): Selection | null {
  if (!sel || !(radius > 0)) return sel
  return { steps: [...sel.steps, { op: 'feather', radius }] }
}

function moveShape(s: SelShape, dx: number, dy: number): SelShape {
  switch (s.kind) {
    case 'polygon':
      return { kind: 'polygon', points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) }
    default:
      return { ...s, x: s.x + dx, y: s.y + dy }
  }
}

/**
 * Shifts a selection. Inverted selections are measured against the canvas,
 * so they are moved shape by shape like everything else; the canvas edge
 * stays where it is.
 */
export function translate(sel: Selection | null, dx: number, dy: number): Selection | null {
  if (!sel || (dx === 0 && dy === 0)) return sel
  return { steps: sel.steps.map((st) => ('shape' in st ? { ...st, shape: moveShape(st.shape, dx, dy) } : st)) }
}

/** Normalises a drag from (x0, y0) to (x1, y1) into a rect; Shift = square, Alt = from centre. */
export function dragRect(x0: number, y0: number, x1: number, y1: number, square: boolean, fromCenter: boolean): Rect {
  let w = x1 - x0
  let h = y1 - y0
  if (square) {
    const m = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * m
    h = Math.sign(h || 1) * m
  }
  if (fromCenter) return { x: x0 - Math.abs(w), y: y0 - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 }
  return { x: Math.min(x0, x0 + w), y: Math.min(y0, y0 + h), w: Math.abs(w), h: Math.abs(h) }
}

export function collectMaskIds(sel: Selection | null, out: Set<string>): void {
  if (!sel) return
  for (const st of sel.steps) if ('shape' in st && st.shape.kind === 'mask') out.add(st.shape.maskId)
}
