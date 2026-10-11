/**
 * ICC profiles for RGB matrix/curve ("matrix-shaper") profiles: sRGB,
 * Display P3, Adobe RGB, ProPhoto and most camera and monitor profiles.
 * Pixels convert source → linear (tone curves) → XYZ (D50 PCS) →
 * destination linear → destination encoding. Lookup-table (A2B) profiles are
 * recognised and reported as unsupported.
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Curve = (v: number) => number

export interface IccProfile {
  name: string
  colorSpace: string
  /** Device RGB (linear) → XYZ (D50). */
  toXYZ: Mat3 | null
  trc: [Curve, Curve, Curve] | null
  /** Matrix/curve data present; false for LUT-only profiles. */
  matrixShaper: boolean
}

export class IccError extends Error {}

const sig = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
const u32 = (dv: DataView, o: number) => dv.getUint32(o)
const s15 = (dv: DataView, o: number) => dv.getInt32(o) / 65536

// ---------------------------------------------------------------------------
// sRGB / Display P3 (both use the sRGB transfer function), D50-adapted
// ---------------------------------------------------------------------------

export const srgbDecode: Curve = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
export const srgbEncode: Curve = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

export const SRGB_TO_XYZ: Mat3 = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733]
export const P3_TO_XYZ: Mat3 = [0.5151187, 0.2919778, 0.1571035, 0.2411892, 0.6922441, 0.0665668, -0.0010505, 0.0418791, 0.7840713]

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return r
}

export function inv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new IccError('The profile matrix cannot be inverted.')
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}

export function apply3(m: Mat3, r: number, g: number, b: number): [number, number, number] {
  return [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function readCurve(b: Uint8Array, dv: DataView, o: number): Curve {
  const type = sig(b, o)
  if (type === 'curv') {
    const n = u32(dv, o + 8)
    if (n === 0) return (v) => v
    if (n === 1) {
      const g = dv.getUint16(o + 12) / 256
      return (v) => Math.pow(Math.max(0, v), g)
    }
    const table = new Float32Array(n)
    for (let i = 0; i < n; i++) table[i] = dv.getUint16(o + 12 + i * 2) / 65535
    return (v) => {
      const x = Math.min(1, Math.max(0, v)) * (n - 1)
      const i = Math.floor(x)
      const t = x - i
      return i >= n - 1 ? table[n - 1] : table[i] * (1 - t) + table[i + 1] * t
    }
  }
  if (type === 'para') {
    const fn = dv.getUint16(o + 8)
    const p = Array.from({ length: [1, 3, 4, 5, 7][fn] ?? 1 }, (_, i) => s15(dv, o + 12 + i * 4))
    const [g, a = 1, bb = 0, c = 0, d = 0, e = 0, f = 0] = p
    switch (fn) {
      case 0:
        return (v) => Math.pow(Math.max(0, v), g)
      case 1:
        return (v) => (v >= -bb / a ? Math.pow(a * v + bb, g) : 0)
      case 2:
        return (v) => (v >= -bb / a ? Math.pow(a * v + bb, g) + c : c)
      case 3:
        return (v) => (v >= d ? Math.pow(a * v + bb, g) : c * v)
      case 4:
        return (v) => (v >= d ? Math.pow(a * v + bb, g) + e : c * v + f)
    }
  }
  throw new IccError(`Unsupported tone curve type “${type}”.`)
}

function readText(b: Uint8Array, dv: DataView, o: number, len: number): string {
  const type = sig(b, o)
  if (type === 'desc') {
    const n = u32(dv, o + 8)
    return new TextDecoder('latin1').decode(b.subarray(o + 12, o + 12 + Math.max(0, n - 1)))
  }
  if (type === 'mluc') {
    const count = u32(dv, o + 8)
    if (!count) return ''
    const strLen = u32(dv, o + 20)
    const strOff = u32(dv, o + 24)
    return new TextDecoder('utf-16be').decode(b.subarray(o + strOff, o + strOff + strLen))
  }
  if (type === 'text') return new TextDecoder('latin1').decode(b.subarray(o + 8, o + len)).replace(/\0.*$/, '')
  return ''
}

export function parseIcc(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132 || sig(bytes, 36) !== 'acsp') throw new IccError('This is not an ICC profile.')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colorSpace = sig(bytes, 16).trim()
  const count = u32(dv, 128)
  const tags = new Map<string, { o: number; len: number }>()
  for (let i = 0; i < count; i++) {
    const t = 132 + i * 12
    if (t + 12 > bytes.length) break
    tags.set(sig(bytes, t), { o: u32(dv, t + 4), len: u32(dv, t + 8) })
  }
  const tag = (s: string) => tags.get(s)
  let name = ''
  const desc = tag('desc')
  if (desc) name = readText(bytes, dv, desc.o, desc.len)
  const xyz = (s: string): [number, number, number] | null => {
    const t = tag(s)
    if (!t || sig(bytes, t.o) !== 'XYZ ') return null
    return [s15(dv, t.o + 8), s15(dv, t.o + 12), s15(dv, t.o + 16)]
  }
  const r = xyz('rXYZ')
  const g = xyz('gXYZ')
  const b = xyz('bXYZ')
  let trc: IccProfile['trc'] = null
  const rt = tag('rTRC')
  const gt = tag('gTRC')
  const bt = tag('bTRC')
  if (rt && gt && bt) trc = [readCurve(bytes, dv, rt.o), readCurve(bytes, dv, gt.o), readCurve(bytes, dv, bt.o)]
  const toXYZ: Mat3 | null = r && g && b ? [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]] : null
  return { name: name.trim(), colorSpace, toXYZ, trc, matrixShaper: !!(toXYZ && trc) }
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export type WorkingSpace = 'srgb' | 'display-p3'

const near = (a: Mat3, b: Mat3, eps = 0.003) => a.every((v, i) => Math.abs(v - b[i]) < eps)

/** The working space a profile already is (so no conversion is needed), if any. */
export function matchesWorkingSpace(p: IccProfile): WorkingSpace | null {
  if (!p.toXYZ || !p.trc) return null
  const curveOk = [0.1, 0.5, 0.9].every((v) => p.trc!.every((c) => Math.abs(c(v) - srgbDecode(v)) < 0.004))
  if (!curveOk) return null
  if (near(p.toXYZ, SRGB_TO_XYZ)) return 'srgb'
  if (near(p.toXYZ, P3_TO_XYZ)) return 'display-p3'
  return null
}

/** Whether the profile's gamut reaches outside sRGB (choose a P3 working space to keep more of it). */
export function isWideGamut(p: IccProfile): boolean {
  if (!p.toXYZ) return false
  // Convert the profile's primaries to sRGB; any clearly negative component is out of gamut.
  const m = mul(inv(SRGB_TO_XYZ), p.toXYZ)
  return [0, 1, 2].some((col) => [0, 1, 2].some((row) => m[row * 3 + col] < -0.02))
}

/**
 * Converts straight-alpha RGBA (0..1) pixels in place from the profile into
 * a working space. Out-of-gamut values are clipped.
 */
export function convertPixels(rgba: Float32Array, from: IccProfile, to: WorkingSpace): void {
  if (!from.toXYZ || !from.trc) throw new IccError(`“${from.name || 'This profile'}” uses lookup tables, which Cadence+ cannot convert yet.`)
  const m = mul(inv(to === 'srgb' ? SRGB_TO_XYZ : P3_TO_XYZ), from.toXYZ)
  const [tr, tg, tb] = from.trc
  // Tone curves are evaluated through 4096-entry tables for speed.
  const N = 4096
  const lut = (c: Curve) => Float32Array.from({ length: N + 1 }, (_, i) => c(i / N))
  const lr = lut(tr)
  const lg = lut(tg)
  const lb = lut(tb)
  const look = (t: Float32Array, v: number) => {
    const x = Math.min(1, Math.max(0, v)) * N
    const i = Math.floor(x)
    return i >= N ? t[N] : t[i] + (t[i + 1] - t[i]) * (x - i)
  }
  for (let p = 0; p < rgba.length; p += 4) {
    const [r, g, b] = apply3(m, look(lr, rgba[p]), look(lg, rgba[p + 1]), look(lb, rgba[p + 2]))
    rgba[p] = srgbEncode(Math.min(1, Math.max(0, r)))
    rgba[p + 1] = srgbEncode(Math.min(1, Math.max(0, g)))
    rgba[p + 2] = srgbEncode(Math.min(1, Math.max(0, b)))
  }
}

/** Converts one working-space colour to another (0..1 encoded), unclipped. */
export function convertColor(rgb: [number, number, number], from: WorkingSpace, to: WorkingSpace): [number, number, number] {
  if (from === to) return rgb
  const m = mul(inv(to === 'srgb' ? SRGB_TO_XYZ : P3_TO_XYZ), from === 'srgb' ? SRGB_TO_XYZ : P3_TO_XYZ)
  const lin = rgb.map((v) => Math.sign(v) * srgbDecode(Math.abs(v))) as [number, number, number]
  return apply3(m, ...lin).map((v) => Math.sign(v) * srgbEncode(Math.abs(v))) as [number, number, number]
}
