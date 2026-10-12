import { describe, expect, it } from 'vitest'
import { rangeFunction } from '../src/core/color-range'
import { motionBlurOp, scaleShaderOp, toneOp, unsharpOp } from '../src/core/filters'

describe('Color Range', () => {
  it('sampled colour: full at the colour, fading to nothing at the fuzziness distance', () => {
    const f = rangeFunction({ kind: 'sampled', color: [200, 40, 40], fuzziness: 40 })
    expect(f(200, 40, 40)).toBe(1)
    expect(f(220, 40, 40)).toBeGreaterThan(0.5)
    expect(f(40, 200, 40)).toBe(0)
  })
  it('hue families select their hue and never greys', () => {
    const reds = rangeFunction({ kind: 'reds', color: [0, 0, 0], fuzziness: 0 })
    const blues = rangeFunction({ kind: 'blues', color: [0, 0, 0], fuzziness: 0 })
    expect(reds(220, 30, 30)).toBeCloseTo(1, 2)
    expect(reds(30, 30, 220)).toBe(0)
    expect(blues(30, 30, 220)).toBeCloseTo(1, 2)
    expect(reds(128, 128, 128)).toBe(0)
  })
  it('tonal ranges split by luminance', () => {
    const sh = rangeFunction({ kind: 'shadows', color: [0, 0, 0], fuzziness: 0 })
    const hi = rangeFunction({ kind: 'highlights', color: [0, 0, 0], fuzziness: 0 })
    const mid = rangeFunction({ kind: 'midtones', color: [0, 0, 0], fuzziness: 0 })
    expect(sh(20, 20, 20)).toBe(1)
    expect(sh(240, 240, 240)).toBe(0)
    expect(hi(240, 240, 240)).toBe(1)
    expect(mid(128, 128, 128)).toBe(1)
    expect(mid(10, 10, 10)).toBe(0)
  })
})

describe('shader filter data', () => {
  it('unsharp params are normalised', () => {
    expect(unsharpOp(150, 2, 51).params).toEqual({ amount: 1.5, radius: 2, threshold: 0.2 })
  })
  it('scales lengths for zoomed previews but not strengths', () => {
    expect(scaleShaderOp(unsharpOp(100, 4, 0), 0.5).params.radius).toBe(2)
    expect(scaleShaderOp(motionBlurOp(30, 20), 0.25).params).toEqual({ angle: 30, dist: 5 })
    expect(scaleShaderOp(toneOp(true, 'shadows', 50), 0.5).params).toEqual({ range: 0, exposure: 0.5 })
  })
})
