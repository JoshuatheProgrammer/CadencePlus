import { describe, expect, it } from 'vitest'
import { affineQuad, applyH, invertH, isConvexQuad, multiplyH, quadBounds, rectToQuad, type Quad } from '../src/core/homography'

const close = (a: { x: number; y: number }, x: number, y: number) => {
  expect(a.x).toBeCloseTo(x, 6)
  expect(a.y).toBeCloseTo(y, 6)
}

describe('homography', () => {
  const q: Quad = [10, 20, 110, 5, 130, 140, 0, 100]
  const H = rectToQuad(200, 100, q)
  it('maps the box corners exactly onto the quad', () => {
    close(applyH(H, 0, 0), 10, 20)
    close(applyH(H, 200, 0), 110, 5)
    close(applyH(H, 200, 100), 130, 140)
    close(applyH(H, 0, 100), 0, 100)
  })
  it('inverts', () => {
    const I = multiplyH(invertH(H), H)
    close(applyH(I, 37, 61), 37, 61)
  })
  it('reduces to the affine case for parallelograms', () => {
    const m = { a: 2, b: 0.5, c: -0.3, d: 1.5, e: 7, f: 9 }
    const p = affineQuad(m, 50, 40)
    const A = rectToQuad(50, 40, p)
    expect(A[6]).toBeCloseTo(0, 12)
    expect(A[7]).toBeCloseTo(0, 12)
    close(applyH(A, 25, 20), m.a * 25 + m.c * 20 + m.e, m.b * 25 + m.d * 20 + m.f)
  })
  it('detects quads that cannot be drawn', () => {
    expect(isConvexQuad(q)).toBe(true)
    expect(isConvexQuad([0, 0, 10, 10, 10, 0, 0, 10])).toBe(false)
    expect(quadBounds(q)).toEqual({ x: 0, y: 5, w: 130, h: 135 })
  })
})
