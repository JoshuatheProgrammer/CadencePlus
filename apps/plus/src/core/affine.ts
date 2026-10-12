/**
 * 2D affine maths for Free Transform. Matrices use the canvas convention
 * [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
import type { Rect } from './model'

export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * A transform as the user edits it: the floating content's centre position,
 * scale and rotation. The content's own size (w, h) is fixed.
 */
export interface TransformParams {
  /** Document position of the content's centre. */
  cx: number
  cy: number
  sx: number
  sy: number
  /** Radians, clockwise on screen. */
  rot: number
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f
  }
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c
  if (!det) throw new Error('Matrix is not invertible')
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det
  }
}

export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

/** Matrix mapping content-local pixels (0..w, 0..h) to document pixels. */
export function paramsToMatrix(p: TransformParams, w: number, h: number): Affine {
  const cos = Math.cos(p.rot)
  const sin = Math.sin(p.rot)
  // T(cx,cy) · R(rot) · S(sx,sy) · T(−w/2, −h/2)
  const a = cos * p.sx
  const b = sin * p.sx
  const c = -sin * p.sy
  const d = cos * p.sy
  return { a, b, c, d, e: p.cx - (a * w) / 2 - (c * h) / 2, f: p.cy - (b * w) / 2 - (d * h) / 2 }
}

/** Identity params for content occupying `r` in the document. */
export function paramsForRect(r: Rect): TransformParams {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, sx: 1, sy: 1, rot: 0 }
}

/** The four corners (TL, TR, BR, BL) of a w×h box after `m`. */
export function corners(m: Affine, w: number, h: number): { x: number; y: number }[] {
  return [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)]
}

/** Integer bounding box of a transformed w×h box. */
export function transformedBounds(m: Affine, w: number, h: number): Rect {
  const pts = corners(m, w, h)
  const x0 = Math.floor(Math.min(...pts.map((p) => p.x)) + 1e-6)
  const y0 = Math.floor(Math.min(...pts.map((p) => p.y)) + 1e-6)
  const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)) - 1e-6)
  const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)) - 1e-6)
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

export function isIdentityParams(p: TransformParams, r: Rect): boolean {
  const q = paramsForRect(r)
  return Math.abs(p.cx - q.cx) < 1e-9 && Math.abs(p.cy - q.cy) < 1e-9 && p.sx === 1 && p.sy === 1 && Math.abs(p.rot) < 1e-12
}

/** True when the matrix is a whole-pixel translation (no resampling needed). */
export function isIntegerTranslation(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && Number.isInteger(m.e) && Number.isInteger(m.f)
}

/**
 * Scales the box by dragging one handle while the opposite handle stays
 * fixed (or the centre, with `fromCenter`). `hx`, `hy` ∈ {−1, 0, 1} name the
 * handle in content space (0 = edge midpoint axis left unchanged).
 * `local` is the pointer in content-local units relative to the centre,
 * already un-rotated. Returns new params.
 */
export function scaleFromHandle(p: TransformParams, w: number, h: number, hx: number, hy: number, local: { x: number; y: number }, keepAspect: boolean, fromCenter: boolean): TransformParams {
  // Current half extents (signed scale preserves flips)
  const halfW = (w / 2) * p.sx
  const halfH = (h / 2) * p.sy
  let nsx = p.sx
  let nsy = p.sy
  // The dragged side sits at hx·(w/2)·sx from the centre; the anchor is the
  // opposite side (or the centre). New scale = span from anchor / content size.
  if (hx !== 0) nsx = fromCenter ? (2 * hx * local.x) / w : (hx * (local.x + hx * halfW)) / w
  if (hy !== 0) nsy = fromCenter ? (2 * hy * local.y) / h : (hy * (local.y + hy * halfH)) / h
  if (keepAspect) {
    if (hx !== 0 && hy !== 0) {
      // Corner: use the larger relative change, keep the original ratio and signs.
      const k = Math.max(Math.abs(nsx / p.sx), Math.abs(nsy / p.sy))
      nsx = Math.sign(nsx || 1) * Math.abs(p.sx) * k
      nsy = Math.sign(nsy || 1) * Math.abs(p.sy) * k
    } else if (hx !== 0) nsy = Math.sign(p.sy) * Math.abs(p.sy * (nsx / p.sx))
    else if (hy !== 0) nsx = Math.sign(p.sx) * Math.abs(p.sx * (nsy / p.sy))
  }
  // Keep a tiny minimum so the matrix stays invertible.
  const min = 1 / Math.max(w, h, 1)
  if (Math.abs(nsx) < min) nsx = Math.sign(nsx || 1) * min
  if (Math.abs(nsy) < min) nsy = Math.sign(nsy || 1) * min
  if (fromCenter) return { ...p, sx: nsx, sy: nsy }
  // Move the centre so the anchor stays put.
  const cos = Math.cos(p.rot)
  const sin = Math.sin(p.rot)
  const ax = hx !== 0 ? -hx * halfW : 0
  const ay = hy !== 0 ? -hy * halfH : 0
  const nax = hx !== 0 ? -hx * (w / 2) * nsx : 0
  const nay = hy !== 0 ? -hy * (h / 2) * nsy : 0
  const dx = ax - nax
  const dy = ay - nay
  return { ...p, sx: nsx, sy: nsy, cx: p.cx + dx * cos - dy * sin, cy: p.cy + dx * sin + dy * cos }
}

const near = (v: number, t: number, eps: number) => Math.abs(v - t) < eps

/**
 * When `m` is a whole-pixel transform (90° rotations, flips, integer moves)
 * returns it with exact entries; otherwise null (needs resampling).
 */
export function exactPixelMatrix(m: Affine): Affine | null {
  const r = (v: number) => (near(v, Math.round(v), 1e-9) ? Math.round(v) : NaN)
  const a = r(m.a)
  const b = r(m.b)
  const c = r(m.c)
  const d = r(m.d)
  if ([a, b, c, d].some((v) => Number.isNaN(v) || Math.abs(v) > 1) || Math.abs(a * d - b * c) !== 1) return null
  if (!near(m.e, Math.round(m.e), 1e-6) || !near(m.f, Math.round(m.f), 1e-6)) return null
  return { a, b, c, d, e: Math.round(m.e), f: Math.round(m.f) }
}

/** Shifts the centre so a 90°-multiple transform lands on whole pixels. */
export function snapToPixelGrid(p: TransformParams, w: number, h: number): TransformParams {
  const m = paramsToMatrix(p, w, h)
  const rot = [m.a, m.b, m.c, m.d].every((v) => near(v, Math.round(v), 1e-9))
  if (!rot) return p
  return { ...p, cx: p.cx + (Math.round(m.e) - m.e), cy: p.cy + (Math.round(m.f) - m.f) }
}
