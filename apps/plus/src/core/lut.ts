/**
 * Tone lookup tables for Levels and Curves (8-bit). A combined table is
 * 256 × RGBA bytes: entry i holds the output for input i in each channel.
 */

export type Channel = 'rgb' | 'r' | 'g' | 'b'
export const CHANNELS: Channel[] = ['rgb', 'r', 'g', 'b']

export interface LevelsParams {
  inBlack: number
  inWhite: number
  /** Midtone gamma, 0.1–9.99 (1 = linear). */
  gamma: number
  outBlack: number
  outWhite: number
}

export const DEFAULT_LEVELS: LevelsParams = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }

/** One channel of Levels. */
export function levelsTable(p: LevelsParams): Uint8Array {
  const t = new Uint8Array(256)
  const lo = Math.min(p.inBlack, p.inWhite - 1)
  const hi = Math.max(p.inWhite, lo + 1)
  const g = Math.min(9.99, Math.max(0.1, p.gamma))
  for (let i = 0; i < 256; i++) {
    const x = Math.min(1, Math.max(0, (i - lo) / (hi - lo)))
    const y = Math.pow(x, 1 / g)
    t[i] = Math.round(p.outBlack + y * (p.outWhite - p.outBlack))
  }
  return t
}

/**
 * One channel of Curves from control points (flat [x0, y0, x1, y1, …],
 * 0–255), interpolated with a monotone cubic so the curve never overshoots.
 * Outside the first/last point the curve is flat.
 */
export function curveTable(points: number[]): Uint8Array {
  const pts: [number, number][] = []
  for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i], points[i + 1]])
  pts.sort((a, b) => a[0] - b[0])
  // Drop duplicate x values (keep the last).
  const p = pts.filter((q, i) => i === pts.length - 1 || pts[i + 1][0] !== q[0])
  const t = new Uint8Array(256)
  if (p.length === 0) {
    for (let i = 0; i < 256; i++) t[i] = i
    return t
  }
  if (p.length === 1) return t.fill(Math.round(Math.min(255, Math.max(0, p[0][1]))))
  const n = p.length
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1][0] - p[i][0])
    slope.push((p[i + 1][1] - p[i][1]) / dx[i])
  }
  // Fritsch–Carlson tangents
  const m: number[] = new Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = m[i + 1] = 0
      continue
    }
    const a = m[i] / slope[i]
    const b = m[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      m[i] = k * a * slope[i]
      m[i + 1] = k * b * slope[i]
    }
  }
  let seg = 0
  for (let x = 0; x < 256; x++) {
    let y: number
    if (x <= p[0][0]) y = p[0][1]
    else if (x >= p[n - 1][0]) y = p[n - 1][1]
    else {
      while (seg < n - 2 && x > p[seg + 1][0]) seg++
      const h = dx[seg]
      const u = (x - p[seg][0]) / h
      const u2 = u * u
      const u3 = u2 * u
      y = (2 * u3 - 3 * u2 + 1) * p[seg][1] + (u3 - 2 * u2 + u) * h * m[seg] + (-2 * u3 + 3 * u2) * p[seg + 1][1] + (u3 - u2) * h * m[seg + 1]
    }
    t[x] = Math.round(Math.min(255, Math.max(0, y)))
  }
  return t
}

export const IDENTITY_CURVE = [0, 0, 255, 255]

/** Combines per-channel tables with a master table (channel first, then master). */
export function combine(master: Uint8Array, r: Uint8Array, g: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(1024)
  for (let i = 0; i < 256; i++) {
    out[i * 4] = master[r[i]]
    out[i * 4 + 1] = master[g[i]]
    out[i * 4 + 2] = master[b[i]]
    out[i * 4 + 3] = i
  }
  return out
}

export function isIdentityLut(lut: Uint8Array): boolean {
  for (let i = 0; i < 256; i++) if (lut[i * 4] !== i || lut[i * 4 + 1] !== i || lut[i * 4 + 2] !== i) return false
  return true
}

/** Applies a combined LUT to RGBA pixels in place (CPU path; alpha untouched). */
export function applyLutToPixels(data: Uint8ClampedArray, lut: Uint8Array): void {
  for (let p = 0; p < data.length; p += 4) {
    data[p] = lut[data[p] * 4]
    data[p + 1] = lut[data[p + 1] * 4 + 1]
    data[p + 2] = lut[data[p + 2] * 4 + 2]
  }
}

/** 256-bin histograms (luminosity and per channel) of non-transparent pixels. */
export function histogram(data: Uint8ClampedArray): Record<Channel, Uint32Array> {
  const h = { rgb: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) }
  for (let p = 0; p < data.length; p += 4) {
    if (!data[p + 3]) continue
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    h.r[r]++
    h.g[g]++
    h.b[b]++
    h.rgb[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++
  }
  return h
}
