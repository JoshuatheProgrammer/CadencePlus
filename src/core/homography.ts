/**
 * Projective transforms (3 × 3, row-major) for Distort and Perspective:
 * x' = (a·x + b·y + c) / (g·x + h·y + i), y' = (d·x + e·y + f) / (g·x + h·y + i).
 */
import type { Affine } from './affine'

export type Mat3 = [number, number, number, number, number, number, number, number, number]

/** Four corners, clockwise from top-left: [x0, y0, x1, y1, x2, y2, x3, y3]. */
export type Quad = [number, number, number, number, number, number, number, number]

export function applyH(m: Mat3, x: number, y: number): { x: number; y: number } {
  const w = m[6] * x + m[7] * y + m[8]
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }
}

export function multiplyH(p: Mat3, q: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += p[i * 3 + k] * q[k * 3 + j]
  return r
}

export function invertH(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('The shape is degenerate.')
  const k = 1 / det
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
}

export const fromAffine = (m: Affine): Mat3 => [m.a, m.c, m.e, m.b, m.d, m.f, 0, 0, 1]

export const translateH = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1]

/** Maps the unit square (0,0)(1,0)(1,1)(0,1) onto a quad (Heckbert). */
export function squareToQuad(q: Quad): Mat3 {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}

/** Maps a w × h box (origin at 0,0) onto a quad. */
export function rectToQuad(w: number, h: number, q: Quad): Mat3 {
  return multiplyH(squareToQuad(q), [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1])
}

/** The quad an affine places a w × h box at. */
export function affineQuad(m: Affine, w: number, h: number): Quad {
  const p = (x: number, y: number) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
  return [...p(0, 0), ...p(w, 0), ...p(w, h), ...p(0, h)] as Quad
}

/** False for self-intersecting or reflex quads (they cannot be drawn as a projective map). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const ax = q[i * 2]
    const ay = q[i * 2 + 1]
    const bx = q[((i + 1) % 4) * 2]
    const by = q[((i + 1) % 4) * 2 + 1]
    const cx = q[((i + 2) % 4) * 2]
    const cy = q[((i + 2) % 4) * 2 + 1]
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cross) < 1e-9) return false
    if (!sign) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

/** Axis-aligned bounds of a quad, in whole pixels. */
export function quadBounds(q: Quad): { x: number; y: number; w: number; h: number } {
  const xs = [q[0], q[2], q[4], q[6]]
  const ys = [q[1], q[3], q[5], q[7]]
  const x = Math.floor(Math.min(...xs))
  const y = Math.floor(Math.min(...ys))
  return { x, y, w: Math.max(1, Math.ceil(Math.max(...xs)) - x), h: Math.max(1, Math.ceil(Math.max(...ys)) - y) }
}
