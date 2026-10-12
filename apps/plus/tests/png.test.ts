import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { decodePng, PngError } from '../src/core/png'

function crc32(b: Uint8Array): number {
  let c = ~0
  for (const x of b) {
    c ^= x
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function png(w: number, h: number, depth: number, ct: number, rows: Uint8Array, extra: Uint8Array[] = [], interlace = 0): Uint8Array {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr.set([depth, ct, 0, 0, interlace], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Rows with filter type 0 prepended. */
function rowsOf(bytesPerRow: number, h: number, fill: (y: number, i: number) => number, filter = 0): Uint8Array {
  const out = new Uint8Array((bytesPerRow + 1) * h)
  for (let y = 0; y < h; y++) {
    out[y * (bytesPerRow + 1)] = filter
    for (let i = 0; i < bytesPerRow; i++) out[y * (bytesPerRow + 1) + 1 + i] = fill(y, i)
  }
  return out
}

describe('PNG decoder', () => {
  it('keeps 16-bit precision', async () => {
    // 4×1 RGBA16: red = 0x8000 + x (values 8-bit decoding would merge)
    const rows = rowsOf(8 * 4, 1, (_y, i) => {
      const px = i >> 3
      const ch = (i >> 1) & 3
      const v = ch === 0 ? 0x8000 + px : ch === 3 ? 0xffff : 0
      return i & 1 ? v & 255 : v >> 8
    })
    const d = await decodePng(png(4, 1, 16, 6, rows))
    expect(d.bitDepth).toBe(16)
    const reds = [0, 1, 2, 3].map((x) => Math.round(d.rgba[x * 4] * 65535))
    expect(reds).toEqual([0x8000, 0x8001, 0x8002, 0x8003])
    expect(d.rgba[3]).toBe(1)
  })

  it('undoes every filter type', async () => {
    // A gradient filtered with Sub (1): bytes store differences from the left pixel.
    const w = 5
    const want = [10, 20, 35, 55, 80]
    const sub = rowsOf(w, 1, (_y, i) => (i === 0 ? want[0] : want[i] - want[i - 1]), 1)
    const d = await decodePng(png(w, 1, 8, 0, sub))
    expect(Array.from({ length: w }, (_, x) => Math.round(d.rgba[x * 4] * 255))).toEqual(want)
    // Up (2) on the second row, Average (3) and Paeth (4) on a flat row reproduce the row above.
    for (const f of [2, 3, 4]) {
      const r = new Uint8Array([0, 50, 60, 70, f, 0, 0, 0])
      const fixed = f === 3 ? new Uint8Array([0, 50, 60, 70, 3, 25, 5, 5]) : r
      const out = await decodePng(png(3, 2, 8, 0, fixed))
      expect([0, 1, 2].map((x) => Math.round(out.rgba[(3 + x) * 4] * 255))).toEqual([50, 60, 70])
    }
  })

  it('palette (2-bit) with tRNS, and grey with a transparent key', async () => {
    const plte = chunk('PLTE', new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))
    const trns = chunk('tRNS', new Uint8Array([255, 128]))
    // indices 0,1,2,3 packed into one byte: 00 01 10 11
    const d = await decodePng(png(4, 1, 2, 3, new Uint8Array([0, 0b00011011]), [plte, trns]))
    expect(Array.from(d.rgba.subarray(0, 8)).map((v) => Math.round(v * 255))).toEqual([255, 0, 0, 255, 0, 255, 0, 128])
    expect(d.rgba[11]).toBe(1)
    const g = await decodePng(png(2, 1, 8, 0, new Uint8Array([0, 7, 9]), [chunk('tRNS', new Uint8Array([0, 7]))]))
    expect([g.rgba[3], g.rgba[7]]).toEqual([0, 1])
  })

  it('Adam7 interlacing matches the plain image', async () => {
    const W = 9
    const H = 9
    const val = (x: number, y: number) => (x * 17 + y * 29) & 255
    const plain = rowsOf(W, H, (y, x) => val(x, y))
    const passes = [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2]
    ]
    const bytes: number[] = []
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((W - x0) / dx)
      const ph = Math.ceil((H - y0) / dy)
      if (pw <= 0 || ph <= 0) continue
      for (let y = 0; y < ph; y++) {
        bytes.push(0)
        for (let x = 0; x < pw; x++) bytes.push(val(x0 + x * dx, y0 + y * dy))
      }
    }
    const a = await decodePng(png(W, H, 8, 0, plain))
    const b = await decodePng(png(W, H, 8, 0, new Uint8Array(bytes), [], 1))
    expect(b.interlaced).toBe(true)
    expect(Array.from(b.rgba)).toEqual(Array.from(a.rgba))
  })

  it('reads the embedded ICC profile and rejects broken files', async () => {
    const profile = new Uint8Array([1, 2, 3, 4, 5])
    const iccp = chunk('iCCP', new Uint8Array([...new TextEncoder().encode('Display P3'), 0, 0, ...deflateSync(profile)]))
    const d = await decodePng(png(1, 1, 8, 0, new Uint8Array([0, 5]), [iccp]))
    expect(d.icc?.name).toBe('Display P3')
    expect(Array.from(d.icc!.profile)).toEqual([1, 2, 3, 4, 5])
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow(PngError)
  })
})
