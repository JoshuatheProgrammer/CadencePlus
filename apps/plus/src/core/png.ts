/**
 * A PNG decoder that keeps full precision. Chromium decodes images to 8 bits
 * per channel, so 16-bit PNGs (and Cadence+'s own 16-bit tiles) are decoded
 * here: every bit depth (1–16), every colour type, tRNS transparency and
 * Adam7 interlacing. Colour chunks (iCCP, sRGB, gAMA, cHRM, cICP) are
 * reported so the caller can colour-manage the pixels.
 */

export interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlaced: boolean
  /** Embedded ICC profile (decompressed) and its name. */
  icc: { name: string; profile: Uint8Array } | null
  /** sRGB chunk rendering intent, if present. */
  srgbIntent: number | null
  /** gAMA as a decimal (e.g. 0.45455). */
  gamma: number | null
  /** cICP colour primaries / transfer codes, if present. */
  cicp: { primaries: number; transfer: number } | null
}

export interface DecodedPng extends PngInfo {
  /** Straight-alpha RGBA, 0..1, row-major. */
  rgba: Float32Array
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

export class PngError extends Error {}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

interface Chunks {
  ihdr: Uint8Array
  idat: Uint8Array[]
  plte: Uint8Array | null
  trns: Uint8Array | null
  iccp: Uint8Array | null
  srgb: number | null
  gama: number | null
  cicp: { primaries: number; transfer: number } | null
}

function readChunks(b: Uint8Array): Chunks {
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw new PngError('Not a PNG file.')
  const c: Chunks = { ihdr: new Uint8Array(0), idat: [], plte: null, trns: null, iccp: null, srgb: null, gama: null, cicp: null }
  let o = 8
  while (o + 8 <= b.length) {
    const len = u32(b, o)
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7])
    const d = b.subarray(o + 8, o + 8 + len)
    if (o + 12 + len > b.length) throw new PngError('The PNG file is truncated.')
    if (type === 'IHDR') c.ihdr = d
    else if (type === 'IDAT') c.idat.push(d)
    else if (type === 'PLTE') c.plte = d
    else if (type === 'tRNS') c.trns = d
    else if (type === 'iCCP') c.iccp = d
    else if (type === 'sRGB') c.srgb = d[0]
    else if (type === 'gAMA') c.gama = u32(d, 0) / 100000
    else if (type === 'cICP') c.cicp = { primaries: d[0], transfer: d[1] }
    else if (type === 'IEND') break
    o += 12 + len
  }
  if (c.ihdr.length < 13) throw new PngError('The PNG header is missing.')
  return c
}

/** Header and colour information without decoding pixels. */
export async function pngInfo(b: Uint8Array): Promise<PngInfo> {
  const c = readChunks(b)
  return info(c)
}

async function info(c: Chunks): Promise<PngInfo> {
  const h = c.ihdr
  let icc: PngInfo['icc'] = null
  if (c.iccp) {
    const z = c.iccp.indexOf(0)
    const name = new TextDecoder('latin1').decode(c.iccp.subarray(0, z))
    try {
      icc = { name, profile: await inflate(c.iccp.subarray(z + 2)) }
    } catch {
      icc = null
    }
  }
  return { width: u32(h, 0), height: u32(h, 4), bitDepth: h[8], colorType: h[9], interlaced: h[12] === 1, icc, srgbIntent: c.srgb, gamma: c.gama, cicp: c.cicp }
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Undoes PNG row filters in place for a w×h pass; returns the next read offset. */
function unfilter(raw: Uint8Array, off: number, rowBytes: number, h: number, bpp: number, out: Uint8Array): number {
  let prev: Uint8Array = new Uint8Array(rowBytes)
  for (let y = 0; y < h; y++) {
    const f = raw[off++]
    const row = out.subarray(y * rowBytes, (y + 1) * rowBytes)
    row.set(raw.subarray(off, off + rowBytes))
    off += rowBytes
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      if (f === 1) row[i] = (row[i] + a) & 255
      else if (f === 2) row[i] = (row[i] + b) & 255
      else if (f === 3) row[i] = (row[i] + ((a + b) >> 1)) & 255
      else if (f === 4) row[i] = (row[i] + paeth(a, b, c)) & 255
      else if (f !== 0) throw new PngError(`Unknown PNG filter ${f}.`)
    }
    prev = row
  }
  return off
}

export async function decodePng(b: Uint8Array): Promise<DecodedPng> {
  const c = readChunks(b)
  const inf = await info(c)
  const { width: W, height: H, bitDepth: depth, colorType: ct } = inf
  const ch = CHANNELS[ct]
  if (!ch || ![1, 2, 4, 8, 16].includes(depth)) throw new PngError(`Unsupported PNG format (colour type ${ct}, ${depth}-bit).`)
  if (!c.idat.length) throw new PngError('The PNG has no image data.')
  let total = 0
  for (const d of c.idat) total += d.length
  const z = new Uint8Array(total)
  let p = 0
  for (const d of c.idat) {
    z.set(d, p)
    p += d.length
  }
  const raw = await inflate(z)
  const bpp = Math.max(1, (ch * depth) >> 3)
  const max = (1 << depth) - 1
  const rgba = new Float32Array(W * H * 4)

  // Palette and transparency tables
  const pal = c.plte
  const trns = c.trns
  const trnsGray = trns && ct === 0 ? (trns[0] << 8) | trns[1] : -1
  const trnsRgb = trns && ct === 2 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null

  const sample = (row: Uint8Array, i: number): number => {
    if (depth === 16) return (row[i * 2] << 8) | row[i * 2 + 1]
    if (depth === 8) return row[i]
    const per = 8 / depth
    const byte = row[Math.floor(i / per)]
    const shift = 8 - depth - (i % per) * depth
    return (byte >> shift) & max
  }

  const writePass = (rows: Uint8Array, pw: number, ph: number, rowBytes: number, map: (x: number, y: number) => number) => {
    for (let y = 0; y < ph; y++) {
      const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes)
      for (let x = 0; x < pw; x++) {
        const o = map(x, y) * 4
        if (ct === 3) {
          const i = sample(row, x)
          if (!pal || i * 3 + 2 >= pal.length) throw new PngError('The PNG palette is missing or too short.')
          rgba[o] = pal[i * 3] / 255
          rgba[o + 1] = pal[i * 3 + 1] / 255
          rgba[o + 2] = pal[i * 3 + 2] / 255
          rgba[o + 3] = trns && i < trns.length ? trns[i] / 255 : 1
          continue
        }
        const s0 = sample(row, x * ch)
        if (ct === 0 || ct === 4) {
          const v = s0 / max
          rgba[o] = rgba[o + 1] = rgba[o + 2] = v
          rgba[o + 3] = ct === 4 ? sample(row, x * ch + 1) / max : s0 === trnsGray ? 0 : 1
        } else {
          const s1 = sample(row, x * ch + 1)
          const s2 = sample(row, x * ch + 2)
          rgba[o] = s0 / max
          rgba[o + 1] = s1 / max
          rgba[o + 2] = s2 / max
          rgba[o + 3] = ct === 6 ? sample(row, x * ch + 3) / max : trnsRgb && s0 === trnsRgb[0] && s1 === trnsRgb[1] && s2 === trnsRgb[2] ? 0 : 1
        }
      }
    }
  }

  if (!inf.interlaced) {
    const rowBytes = Math.ceil((W * ch * depth) / 8)
    const rows = new Uint8Array(rowBytes * H)
    unfilter(raw, 0, rowBytes, H, bpp, rows)
    writePass(rows, W, H, rowBytes, (x, y) => y * W + x)
  } else {
    // Adam7
    const passes = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2]
    ]
    let off = 0
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((W - x0) / dx)
      const ph = Math.ceil((H - y0) / dy)
      if (pw <= 0 || ph <= 0) continue
      const rowBytes = Math.ceil((pw * ch * depth) / 8)
      const rows = new Uint8Array(rowBytes * ph)
      off = unfilter(raw, off, rowBytes, ph, bpp, rows)
      writePass(rows, pw, ph, rowBytes, (x, y) => (y0 + y * dy) * W + x0 + x * dx)
    }
  }
  return { ...inf, rgba }
}
