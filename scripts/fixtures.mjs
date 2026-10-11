/**
 * Synthetic sample files for the format tests (no third-party samples are
 * shipped): a layered PSD, 8/16-bit TIFFs and a linear DNG.
 */
import { writePsdBuffer } from 'ag-psd'

const solid = (w, h, [r, g, b, a = 255]) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4)
  return { width: w, height: h, data }
}

/**
 * 64×64 PSD: red background; a pass-through group holding a 50% blue
 * multiply layer (32×32 at 16,16) whose mask hides its left half; an
 * Invert adjustment layer (hidden); a Levels layer.
 */
export function makePsd() {
  const mask = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const v = x < 16 ? 0 : 255
      mask.data.set([v, v, v, 255], (y * 32 + x) * 4)
    }
  const psd = {
    width: 64,
    height: 64,
    imageData: solid(64, 64, [255, 0, 0]),
    children: [
      { name: 'Background', left: 0, top: 0, right: 64, bottom: 64, imageData: solid(64, 64, [255, 0, 0]) },
      {
        name: 'Group',
        opened: true,
        blendMode: 'pass through',
        children: [
          {
            name: 'Blue',
            left: 16,
            top: 16,
            right: 48,
            bottom: 48,
            opacity: 0.5,
            blendMode: 'multiply',
            imageData: solid(32, 32, [0, 0, 255]),
            mask: { left: 16, top: 16, right: 48, bottom: 48, defaultColor: 255, imageData: mask }
          }
        ]
      },
      { name: 'Invert', hidden: true, adjustment: { type: 'invert' } },
      { name: 'Levels', adjustment: { type: 'levels', rgb: { shadowInput: 0, highlightInput: 255, midtoneInput: 1, shadowOutput: 0, highlightOutput: 255 } } }
    ]
  }
  return writePsdBuffer(psd, { noBackground: true })
}

/** Little-endian baseline TIFF writer (uncompressed, one strip). */
function tiff(w, h, { bits, spp, photometric = 2, pixels, extra = [] }) {
  const entries = [
    [256, 4, [w]],
    [257, 4, [h]],
    [258, 3, Array(spp).fill(bits)],
    [259, 3, [1]],
    [262, photometric > 65535 ? 4 : 3, [photometric]],
    [273, 4, [0]],
    [277, 3, [spp]],
    [278, 4, [h]],
    [279, 4, [pixels.length]],
    [284, 3, [1]],
    ...extra
  ].sort((a, b) => a[0] - b[0])
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8 }
  const count = (e) => (e[1] === 5 || e[1] === 10 ? e[2].length / 2 : e[2].length)
  let off = 8 + 2 + entries.length * 12 + 4
  const placed = entries.map((e) => {
    const n = count(e) * size[e[1]]
    if (n <= 4) return null
    const at = off
    off += n + (n & 1)
    return at
  })
  const pixOff = off
  const buf = Buffer.alloc(pixOff + pixels.length)
  buf.write('II', 0, 'latin1')
  buf.writeUInt16LE(42, 2)
  buf.writeUInt32LE(8, 4)
  buf.writeUInt16LE(entries.length, 8)
  const put = (at, t, vals) =>
    vals.forEach((v, i) => {
      if (t === 3) buf.writeUInt16LE(v, at + i * 2)
      else if (t === 4 || t === 5) buf.writeUInt32LE(v >>> 0, at + i * 4)
      else if (t === 10) buf.writeInt32LE(v, at + i * 4)
      else buf[at + i] = v
    })
  entries.forEach((e, i) => {
    const o = 10 + i * 12
    buf.writeUInt16LE(e[0], o)
    buf.writeUInt16LE(e[1], o + 2)
    buf.writeUInt32LE(count(e), o + 4)
    if (e[0] === 273) buf.writeUInt32LE(pixOff, o + 8)
    else if (placed[i] !== null) {
      buf.writeUInt32LE(placed[i], o + 8)
      put(placed[i], e[1], e[2])
    } else put(o + 8, e[1], e[2])
  })
  Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength).copy(buf, pixOff)
  return buf
}

/** 1024×8 16-bit RGB TIFF: a smooth red ramp (1024 distinct levels). */
export function makeTiff16() {
  const w = 1024
  const h = 8
  const px = new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      px[i] = Math.round((x / (w - 1)) * 65535)
      px[i + 1] = 16384
      px[i + 2] = 0
    }
  return tiff(w, h, { bits: 16, spp: 3, pixels: new Uint8Array(px.buffer) })
}

/** 32×32 8-bit RGBA TIFF: opaque green left half, transparent right half. */
export function makeTiff8() {
  const px = new Uint8Array(32 * 32 * 4)
  for (let i = 0; i < 32 * 32; i++) if (i % 32 < 16) px.set([0, 200, 0, 255], i * 4)
  return tiff(32, 32, { bits: 8, spp: 4, pixels: px, extra: [[338, 3, [2]]] })
}

/**
 * 64×64 linear DNG (LinearRaw, camera space = linear sRGB): left half 18%
 * grey, right half linear red 0.5.
 */
export function makeDng() {
  const w = 64
  const h = 64
  const px = new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const v = x < 32 ? [0.18, 0.18, 0.18] : [0.5, 0, 0]
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(v[k] * 65535)
    }
  // XYZ (D65) → linear sRGB, as SRATIONAL n/10000.
  const m = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057]
  const srational = m.flatMap((v) => [Math.round(v * 10000), 10000])
  const ascii = (s) => [...Buffer.from(`${s}\0`, 'latin1')]
  return tiff(w, h, {
    bits: 16,
    spp: 3,
    photometric: 34892,
    pixels: new Uint8Array(px.buffer),
    extra: [
      [254, 4, [0]],
      [271, 2, ascii('Cadence')],
      [272, 2, ascii('Synthetic')],
      [50706, 1, [1, 4, 0, 0]],
      [50708, 2, ascii('Cadence Synthetic')],
      [50714, 4, [0]],
      [50717, 4, [65535]],
      [50721, 10, srational],
      [50728, 5, [1, 1, 1, 1, 1, 1]],
      [50778, 3, [21]]
    ]
  })
}
