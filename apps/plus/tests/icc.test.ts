import { describe, expect, it } from 'vitest'
import * as I from '../src/core/icc'

/** Builds a minimal matrix/TRC ICC profile (v2 desc, XYZ primaries, gamma curves). */
function profile(name: string, m: I.Mat3, gamma: number | 'srgb'): Uint8Array {
  const tags: [string, Uint8Array][] = []
  const s15 = (v: number) => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setInt32(0, Math.round(v * 65536))
    return b
  }
  const xyz = (x: number, y: number, z: number) => new Uint8Array([...new TextEncoder().encode('XYZ '), 0, 0, 0, 0, ...s15(x), ...s15(y), ...s15(z)])
  const text = new TextEncoder().encode(name)
  const desc = new Uint8Array(12 + text.length + 1 + 80)
  desc.set(new TextEncoder().encode('desc'))
  new DataView(desc.buffer).setUint32(8, text.length + 1)
  desc.set(text, 12)
  tags.push(['desc', desc])
  tags.push(['rXYZ', xyz(m[0], m[3], m[6])], ['gXYZ', xyz(m[1], m[4], m[7])], ['bXYZ', xyz(m[2], m[5], m[8])])
  let trc: Uint8Array
  if (gamma === 'srgb') {
    // parametric type 3: the sRGB curve
    const p = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045]
    trc = new Uint8Array([...new TextEncoder().encode('para'), 0, 0, 0, 0, 0, 3, 0, 0, ...p.flatMap((v) => [...s15(v)])])
  } else trc = new Uint8Array([...new TextEncoder().encode('curv'), 0, 0, 0, 0, 0, 0, 0, 1, Math.floor(gamma), Math.round((gamma % 1) * 256)])
  tags.push(['rTRC', trc], ['gTRC', trc], ['bTRC', trc])
  let off = 132 + tags.length * 12
  const body: Uint8Array[] = []
  const table = new Uint8Array(4 + tags.length * 12)
  const tdv = new DataView(table.buffer)
  tdv.setUint32(0, tags.length)
  tags.forEach(([sig, data], i) => {
    for (let k = 0; k < 4; k++) table[4 + i * 12 + k] = sig.charCodeAt(k)
    tdv.setUint32(8 + i * 12, off)
    tdv.setUint32(12 + i * 12, data.length)
    body.push(data)
    off += data.length + ((4 - (data.length % 4)) % 4)
    if (data.length % 4) body.push(new Uint8Array((4 - (data.length % 4)) % 4))
  })
  const out = new Uint8Array(off)
  out.set(new TextEncoder().encode('RGB '), 16)
  out.set(new TextEncoder().encode('acsp'), 36)
  out.set(table, 128)
  let p = 132 + tags.length * 12
  for (const b of body) {
    out.set(b, p)
    p += b.length
  }
  return out
}

// Adobe RGB (1998), D50-adapted
const ADOBE: I.Mat3 = [0.6097559, 0.2052401, 0.149224, 0.3111242, 0.625656, 0.0632197, 0.0194811, 0.0608902, 0.7448387]

describe('ICC profiles', () => {
  it('parses name, matrix and curves; recognises sRGB and P3', () => {
    const s = I.parseIcc(profile('sRGB IEC61966-2.1', I.SRGB_TO_XYZ, 'srgb'))
    expect(s.name).toBe('sRGB IEC61966-2.1')
    expect(s.matrixShaper).toBe(true)
    expect(I.matchesWorkingSpace(s)).toBe('srgb')
    expect(I.matchesWorkingSpace(I.parseIcc(profile('Display P3', I.P3_TO_XYZ, 'srgb')))).toBe('display-p3')
    const a = I.parseIcc(profile('Adobe RGB (1998)', ADOBE, 2.19921875))
    expect(I.matchesWorkingSpace(a)).toBeNull()
    expect(I.isWideGamut(a)).toBe(true)
    expect(I.isWideGamut(s)).toBe(false)
  })

  it('converts Adobe RGB to sRGB: grey stays grey, saturated green clips', () => {
    const a = I.parseIcc(profile('Adobe RGB (1998)', ADOBE, 2.19921875))
    const px = new Float32Array([0.5, 0.5, 0.5, 1, 0, 1, 0, 1])
    I.convertPixels(px, a, 'srgb')
    // Adobe RGB 50% grey (gamma 2.2) ≈ sRGB 0.4996 (encoded)
    expect(px[0]).toBeCloseTo(px[1], 3)
    expect(Math.abs(px[0] - 0.4996)).toBeLessThan(0.01)
    expect(px[4]).toBe(0)
    expect(px[5]).toBeCloseTo(1, 5)
    expect(px[7]).toBe(1)
  })

  it('P3 ↔ sRGB colours: P3 red is outside sRGB; white maps to white', () => {
    const red = I.convertColor([1, 0, 0], 'display-p3', 'srgb')
    expect(red[0]).toBeGreaterThan(1.05)
    expect(red[1]).toBeLessThan(0)
    const w = I.convertColor([1, 1, 1], 'srgb', 'display-p3')
    w.forEach((v) => expect(v).toBeCloseTo(1, 3))
    const back = I.convertColor(I.convertColor([0.2, 0.6, 0.3], 'srgb', 'display-p3'), 'display-p3', 'srgb')
    back.forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.6, 0.3][i], 4))
  })

  it('rejects non-profiles', () => {
    expect(() => I.parseIcc(new Uint8Array(200))).toThrow(I.IccError)
  })
})
