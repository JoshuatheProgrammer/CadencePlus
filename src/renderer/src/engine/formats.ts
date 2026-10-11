/**
 * Other file formats: Photoshop (PSD) import/export, TIFF import/export and
 * camera RAW import. Every import says what it could not carry over.
 */
import type { Layer as PsdLayer, Psd } from 'ag-psd'
import { readPsd, writePsd } from 'ag-psd'
import * as UTIF from 'utif2'
import { defaultAdjustment, type Adjustment } from '@core/adjustments'
import { convertPixels, isWideGamut, matchesWorkingSpace, parseIcc, type IccProfile, type Mat3 } from '@core/icc'
import { IDENTITY_CURVE } from '@core/lut'
import { createLayer, docColor, isVector, rasterBounds, unionRect, uid, type BlendMode, type DocColor, type ImageDocument, type Layer, type TileMap } from '@core/model'
import { inflate } from '@core/png'
import { tree } from '@core/tree'
import { ctx2d, withFormat } from './format'
import { canvasFromRgba, documentFromRgba, type ImportResult } from './io'
import { rasterizeTiles } from './pixels'
import { renderComposite } from './render'
import { drawTiles, rasterToCanvas, tilesFromCanvas } from './tiles'

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

type AnyPixels = Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array

/** RGBA in any numeric range → floats 0..1. */
function toFloat(data: AnyPixels, bits: number): Float32Array {
  const out = new Float32Array(data.length)
  const max = data instanceof Float32Array ? 1 : bits === 16 || data instanceof Uint16Array ? 65535 : 255
  for (let i = 0; i < data.length; i++) out[i] = data[i] / max
  return out
}

function readRgba8(c: OffscreenCanvas, colorSpace: PredefinedColorSpace = 'srgb'): Uint8ClampedArray {
  return ctx2d(c).getImageData(0, 0, c.width, c.height, { colorSpace }).data
}

// ---------------------------------------------------------------------------
// PSD import
// ---------------------------------------------------------------------------

const PSD_BLEND: Record<string, BlendMode> = {
  'pass through': 'pass-through',
  normal: 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity'
}
const TO_PSD_BLEND = Object.fromEntries(Object.entries(PSD_BLEND).map(([k, v]) => [v, k])) as Record<BlendMode, PsdLayer['blendMode']>

function psdAdjustment(a: NonNullable<PsdLayer['adjustment']>, missing: Set<string>): Adjustment | null {
  switch (a.type) {
    case 'brightness/contrast':
      return { kind: 'brightnessContrast', params: { brightness: Math.max(-100, Math.min(100, (a.brightness ?? 0) / 1.5)), contrast: Math.max(-100, Math.min(100, a.contrast ?? 0)) } }
    case 'levels': {
      const c = a.rgb
      if (!c) return defaultAdjustment('levels')
      if (a.red || a.green || a.blue) missing.add('per-channel Levels')
      return { kind: 'levels', params: { inBlack: c.shadowInput, inWhite: c.highlightInput, gamma: c.midtoneInput, outBlack: c.shadowOutput, outWhite: c.highlightOutput } }
    }
    case 'curves': {
      const pts = (ch?: { input: number; output: number }[]) => (ch && ch.length ? ch.flatMap((p) => [p.input, p.output]) : undefined)
      return { kind: 'curves', params: {}, curves: { rgb: pts(a.rgb) ?? [...IDENTITY_CURVE], r: pts(a.red), g: pts(a.green), b: pts(a.blue) } }
    }
    case 'hue/saturation':
      if (a.master?.lightness) missing.add('Hue/Saturation lightness')
      return { kind: 'hueSaturation', params: { hue: a.master?.hue ?? 0, saturation: a.master?.saturation ?? 0 } }
    case 'invert':
      return defaultAdjustment('invert')
    case 'black & white':
      return defaultAdjustment('blackWhite')
    default:
      missing.add(`${a.type} adjustment layers`)
      return null
  }
}

/** Opens a PSD with its layers, groups, masks, blend modes and supported adjustment layers. */
export function importPsd(bytes: Uint8Array, name: string): ImportResult {
  const psd = readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true })
  if (psd.colorMode !== undefined && psd.colorMode !== 3 && psd.colorMode !== 1) throw new Error('Only RGB and Grayscale PSDs can be opened (this one is CMYK, Lab or indexed).')
  const bits = psd.bitsPerChannel ?? 8
  const color: DocColor = { depth: bits > 8 ? 16 : 8, space: 'srgb' }
  const missing = new Set<string>()
  if (bits === 32) missing.add('32-bit precision (opened at 16 bits)')

  return withFormat(color, () => {
    const layers: Layer[] = []
    const walk = (list: PsdLayer[] | undefined, parent: string | null) => {
      for (const pl of list ?? []) {
        const base = {
          name: pl.name ?? 'Layer',
          visible: !pl.hidden,
          opacity: pl.opacity ?? 1,
          blend: (pl.blendMode && PSD_BLEND[pl.blendMode]) || 'normal',
          parent
        }
        if (pl.blendMode && !PSD_BLEND[pl.blendMode]) missing.add(`“${pl.blendMode}” blend mode`)
        if (pl.clipping) missing.add('clipping masks')
        if (pl.effects) missing.add('layer styles (effects)')
        if (pl.text) missing.add('live type (imported as pixels)')
        if (pl.placedLayer) missing.add('smart objects (imported as pixels)')
        if (pl.vectorMask) missing.add('vector masks')
        if (pl.children) {
          const g: Layer = { ...createLayer(base.name, { type: 'group', collapsed: !pl.opened }), ...base, blend: base.blend === 'normal' && pl.blendMode === 'pass through' ? 'pass-through' : base.blend }
          walk(pl.children, g.id)
          layers.push(g)
          continue
        }
        let l: Layer
        if (pl.adjustment) {
          const adj = psdAdjustment(pl.adjustment, missing)
          if (!adj) continue
          l = { ...createLayer(base.name, { type: 'adjustment', adjustment: adj }), ...base }
        } else {
          let tiles: TileMap = {}
          if (pl.imageData && pl.imageData.width > 0 && pl.imageData.height > 0) {
            const c = canvasFromRgba(toFloat(pl.imageData.data as AnyPixels, bits), pl.imageData.width, pl.imageData.height, color)
            tiles = tilesFromCanvas(c, pl.left ?? 0, pl.top ?? 0, 0, 0)
          }
          l = { ...createLayer(base.name, { type: 'raster', x: 0, y: 0, tiles }), ...base }
        }
        const m = pl.mask
        if (m?.imageData && (m.right ?? 0) > (m.left ?? 0)) {
          // PSD masks are grey (white = visible); ours store the hidden amount.
          const mw = m.imageData.width
          const mh = m.imageData.height
          const left = m.left ?? 0
          const top = m.top ?? 0
          const area = unionRect({ x: left, y: top, w: mw, h: mh }, m.defaultColor === 0 ? { x: 0, y: 0, w: psd.width, h: psd.height } : null)!
          const mc = new OffscreenCanvas(area.w, area.h)
          const g = mc.getContext('2d')!
          if (m.defaultColor === 0) {
            g.fillStyle = '#000'
            g.fillRect(0, 0, area.w, area.h)
            g.clearRect(left - area.x, top - area.y, mw, mh)
          }
          const img = new ImageData(mw, mh)
          const src = m.imageData.data as AnyPixels
          const max = src instanceof Uint16Array ? 65535 : src instanceof Float32Array ? 1 : 255
          for (let i = 0; i < mw * mh; i++) img.data[i * 4 + 3] = 255 - Math.round((src[i * 4] / max) * 255)
          const tmp = new OffscreenCanvas(mw, mh)
          tmp.getContext('2d')!.putImageData(img, 0, 0)
          g.drawImage(tmp, left - area.x, top - area.y)
          l.mask = { x: 0, y: 0, tiles: tilesFromCanvas(mc, area.x, area.y, 0, 0), enabled: !m.disabled }
        }
        layers.push(l)
      }
    }
    walk(psd.children, null)
    if (!layers.length && psd.imageData) {
      const c = canvasFromRgba(toFloat(psd.imageData.data as AnyPixels, bits), psd.width, psd.height, color)
      layers.push(createLayer('Background', { type: 'raster', x: 0, y: 0, tiles: tilesFromCanvas(c, 0, 0, 0, 0) }))
      missing.add('layers (this PSD only has a flattened image)')
    }
    if (!layers.length) throw new Error('This PSD has no layers or image data Cadence+ can read.')
    const doc: ImageDocument = {
      id: uid('doc'),
      name,
      width: psd.width,
      height: psd.height,
      resolution: 72,
      layers,
      activeLayerId: layers[layers.length - 1].id,
      selection: null,
      ...(color.depth === 16 ? { color } : {})
    }
    return { doc, note: missing.size ? `Not carried over: ${[...missing].join(', ')}.` : null }
  })
}

// ---------------------------------------------------------------------------
// PSD export
// ---------------------------------------------------------------------------

function psdAdjustmentOf(a: Adjustment): PsdLayer['adjustment'] | null {
  const p = (k: string, d: number) => a.params[k] ?? d
  switch (a.kind) {
    case 'brightnessContrast':
      return { type: 'brightness/contrast', brightness: Math.round(p('brightness', 0) * 1.5), contrast: Math.round(p('contrast', 0)), useLegacy: false }
    case 'levels':
      return { type: 'levels', rgb: { shadowInput: p('inBlack', 0), highlightInput: p('inWhite', 255), midtoneInput: p('gamma', 1), shadowOutput: p('outBlack', 0), highlightOutput: p('outWhite', 255) } }
    case 'curves': {
      const ch = (pts?: number[]) => (pts ? Array.from({ length: pts.length / 2 }, (_, i) => ({ input: pts[i * 2], output: pts[i * 2 + 1] })) : undefined)
      return { type: 'curves', rgb: ch(a.curves?.rgb), red: ch(a.curves?.r), green: ch(a.curves?.g), blue: ch(a.curves?.b) }
    }
    case 'hueSaturation':
      return { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: p('hue', 0), saturation: p('saturation', 0), lightness: 0 } }
    case 'invert':
      return { type: 'invert' }
    case 'blackWhite':
      return { type: 'black & white' }
    default:
      return null
  }
}

/** Saves a layered PSD (8 bits/channel, sRGB). Returns the bytes and what could not be written. */
export function exportPsd(doc: ImageDocument): { bytes: Uint8Array; note: string | null } {
  const missing = new Set<string>()
  const f = docColor(doc)
  if (f.depth === 16) missing.add('16-bit precision (saved as 8 bits)')
  if (f.space !== 'srgb') missing.add('Display P3 (converted to sRGB)')
  const t = tree(doc.layers)
  const pixelsOf = (c: OffscreenCanvas) => ({ width: c.width, height: c.height, data: readRgba8(c) })
  const convert = (l: Layer): PsdLayer | null => {
    const base: PsdLayer = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: TO_PSD_BLEND[l.blend] ?? 'normal' }
    let out: PsdLayer
    if (l.content.type === 'group') {
      out = { ...base, opened: !l.content.collapsed, children: (t.get(l.id) ?? []).map(convert).filter((x): x is PsdLayer => !!x) }
    } else if (l.content.type === 'adjustment') {
      const adj = psdAdjustmentOf(l.content.adjustment)
      if (!adj) {
        missing.add(`${l.name} (no Photoshop equivalent)`)
        return null
      }
      out = { ...base, adjustment: adj }
    } else {
      // Pixels: raster as-is; fill, type and shapes rasterized.
      if (l.content.type !== 'raster') missing.add(isVector(l.content) ? 'live type and shapes (written as pixels)' : 'fill layers (written as pixels)')
      const content = l.content.type === 'raster' ? l.content : { x: 0, y: 0, tiles: rasterizeTiles(doc, l) }
      const r = rasterToCanvas(content, 'psd')
      out = r ? { ...base, left: r.rect.x, top: r.rect.y, right: r.rect.x + r.rect.w, bottom: r.rect.y + r.rect.h, imageData: pixelsOf(r.canvas) } : { ...base }
    }
    if (l.mask) {
      const mb = rasterBounds(l.mask) ?? { x: 0, y: 0, w: 1, h: 1 }
      const mc = new OffscreenCanvas(mb.w, mb.h)
      const g = mc.getContext('2d', { willReadFrequently: true })!
      drawTiles(g, l.mask, -mb.x, -mb.y)
      const hide = g.getImageData(0, 0, mb.w, mb.h).data
      const data = new Uint8ClampedArray(mb.w * mb.h * 4)
      for (let i = 0; i < mb.w * mb.h; i++) {
        const v = 255 - hide[i * 4 + 3]
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
        data[i * 4 + 3] = 255
      }
      out.mask = { left: mb.x, top: mb.y, right: mb.x + mb.w, bottom: mb.y + mb.h, defaultColor: 255, disabled: !l.mask.enabled, imageData: { width: mb.w, height: mb.h, data } }
    }
    return out
  }
  const children = (t.get(null) ?? []).map(convert).filter((x): x is PsdLayer => !!x)
  const comp = withFormat(f, () => renderComposite(doc, 'psd.comp'))
  const c8 = new OffscreenCanvas(doc.width, doc.height)
  c8.getContext('2d')!.drawImage(comp, 0, 0)
  const psd: Psd = { width: doc.width, height: doc.height, children, imageData: { width: doc.width, height: doc.height, data: c8.getContext('2d')!.getImageData(0, 0, doc.width, doc.height).data } }
  const buf = writePsd(psd, { noBackground: false } as Parameters<typeof writePsd>[1])
  return { bytes: new Uint8Array(buf), note: missing.size ? `Not written: ${[...missing].join(', ')}.` : null }
}

// ---------------------------------------------------------------------------
// TIFF
// ---------------------------------------------------------------------------

const tag = (ifd: UTIF.IFD, n: number) => ifd[`t${n}`] as number[] | undefined

/** Opens the first image of a TIFF (8 or 16 bits/channel, RGB or grey, with alpha and embedded profile). */
export async function importTiff(bytes: Uint8Array, name: string): Promise<ImportResult> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const ifds = UTIF.decode(buf)
  const ifd = ifds.find((d) => tag(d, 256))
  if (!ifd) throw new Error('This TIFF contains no image.')
  UTIF.decodeImage(buf, ifd)
  const w = ifd.width
  const h = ifd.height
  const bps = tag(ifd, 258)?.[0] ?? 8
  const spp = tag(ifd, 277)?.[0] ?? 1
  const photometric = tag(ifd, 262)?.[0] ?? 2
  const notes: string[] = []
  if (ifds.filter((d) => tag(d, 256)).length > 1) notes.push('Only the first page was opened.')
  let rgba: Float32Array
  let depth: 8 | 16 = 8
  if (bps === 16 && (photometric === 2 || photometric === 1 || photometric === 0) && ifd.data) {
    // UTIF hands 16-bit samples back little-endian.
    depth = 16
    const d16 = new Uint16Array(ifd.data.buffer, ifd.data.byteOffset, w * h * spp)
    rgba = new Float32Array(w * h * 4)
    const grey = photometric !== 2
    for (let i = 0; i < w * h; i++) {
      const s = i * spp
      const o = i * 4
      let v = d16[s] / 65535
      if (photometric === 0) v = 1 - v
      rgba[o] = v
      rgba[o + 1] = grey ? v : d16[s + 1] / 65535
      rgba[o + 2] = grey ? v : d16[s + 2] / 65535
      const alphaAt = grey ? 1 : 3
      rgba[o + 3] = spp > alphaAt ? d16[s + alphaAt] / 65535 : 1
    }
  } else {
    const d8 = UTIF.toRGBA8(ifd)
    rgba = new Float32Array(d8.length)
    for (let i = 0; i < d8.length; i++) rgba[i] = d8[i] / 255
    if (bps > 16) notes.push(`${bps}-bit samples were reduced to 8 bits.`)
  }
  let space: DocColor['space'] = 'srgb'
  const icc = ifd['t34675'] as Uint8Array | number[] | undefined
  if (icc) {
    try {
      const p = parseIcc(icc instanceof Uint8Array ? icc : Uint8Array.from(icc))
      const same = matchesWorkingSpace(p)
      if (same) space = same
      else if (p.matrixShaper) {
        space = isWideGamut(p) ? 'display-p3' : 'srgb'
        convertPixels(rgba, p, space)
        notes.push(`Converted from “${p.name}” to ${space === 'srgb' ? 'sRGB' : 'Display P3'}.`)
      } else notes.push(`The embedded profile “${p.name}” uses lookup tables and was ignored (treated as sRGB).`)
    } catch {
      notes.push('The embedded colour profile could not be read (treated as sRGB).')
    }
  }
  if (depth === 16) notes.unshift('Opened at 16 bits/channel.')
  return { doc: documentFromRgba(name, w, h, rgba, { depth, space }), note: notes.join(' ') || null }
}

let p3IccCache: Uint8Array | null = null

/** The Display P3 profile Chromium embeds in its own P3 PNGs (reused for TIFFs). */
async function p3Profile(): Promise<Uint8Array> {
  if (p3IccCache) return p3IccCache
  const c = new OffscreenCanvas(1, 1)
  c.getContext('2d', { colorSpace: 'display-p3' })!.fillRect(0, 0, 1, 1)
  const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let o = 8
  while (o < png.length) {
    const len = (png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3]
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8))
    if (type === 'iCCP') {
      const d = png.subarray(o + 8, o + 8 + len)
      const z = d.indexOf(0)
      return (p3IccCache = await inflate(d.subarray(z + 2)))
    }
    o += 12 + len
  }
  throw new Error('Could not obtain a Display P3 profile.')
}

/** Uncompressed RGBA TIFF, 8 or 16 bits/channel, with an embedded profile for P3 documents. */
export async function exportTiff(doc: ImageDocument, sixteenBit: boolean): Promise<Uint8Array> {
  const f = docColor(doc)
  const W = doc.width
  const H = doc.height
  const comp = withFormat(f, () => renderComposite(doc, 'tiff'))
  const bits = sixteenBit && f.depth === 16 ? 16 : 8
  const g = comp.getContext('2d') as OffscreenCanvasRenderingContext2D
  const icc = f.space === 'display-p3' ? await p3Profile() : null
  const bpp = bits / 8
  const pixelBytes = W * H * 4 * bpp
  // Header (8) + IFD + tag data + pixels
  const entries: [number, number, number, number[] | Uint8Array][] = [
    [256, 4, 1, [W]],
    [257, 4, 1, [H]],
    [258, 3, 4, [bits, bits, bits, bits]],
    [259, 3, 1, [1]],
    [262, 3, 1, [2]],
    [273, 4, 1, [0]], // strip offset, patched below
    [277, 3, 1, [4]],
    [278, 4, 1, [H]],
    [279, 4, 1, [pixelBytes]],
    [284, 3, 1, [1]],
    [338, 3, 1, [2]] // unassociated alpha
  ]
  if (icc) entries.push([34675, 7, icc.length, icc])
  entries.sort((a, b) => a[0] - b[0])
  const size = (t: number) => (t === 3 ? 2 : t === 4 ? 4 : 1)
  const ifdSize = 2 + entries.length * 12 + 4
  let dataOff = 8 + ifdSize
  const extra: { off: number; e: (typeof entries)[number] }[] = []
  for (const e of entries) {
    const n = e[2] * size(e[1])
    if (n > 4) {
      extra.push({ off: dataOff, e })
      dataOff += n + (n & 1)
    }
  }
  const pixOff = dataOff
  const out = new Uint8Array(pixOff + pixelBytes)
  const dv = new DataView(out.buffer)
  out.set([0x49, 0x49, 42, 0])
  dv.setUint32(4, 8, true)
  dv.setUint16(8, entries.length, true)
  const write = (off: number, t: number, vals: number[] | Uint8Array) => {
    for (let i = 0; i < vals.length; i++) {
      if (t === 3) dv.setUint16(off + i * 2, vals[i], true)
      else if (t === 4) dv.setUint32(off + i * 4, vals[i], true)
      else out[off + i] = vals[i]
    }
  }
  entries.forEach((e, i) => {
    const o = 10 + i * 12
    const [id, t, count, vals] = e
    dv.setUint16(o, id, true)
    dv.setUint16(o + 2, t, true)
    dv.setUint32(o + 4, count, true)
    const ex = extra.find((x) => x.e === e)
    if (id === 273) dv.setUint32(o + 8, pixOff, true)
    else if (ex) {
      dv.setUint32(o + 8, ex.off, true)
      write(ex.off, t, vals)
    } else write(o + 8, t, vals)
  })
  // Pixels, in strips of rows to bound memory.
  const strip = Math.max(1, Math.floor(2_000_000 / W))
  for (let y = 0; y < H; y += strip) {
    const sh = Math.min(strip, H - y)
    if (bits === 16) {
      const d = g.getImageData(0, y, W, sh, { colorSpace: f.space, pixelFormat: 'rgba-float16' } as ImageDataSettings).data as unknown as ArrayLike<number>
      for (let i = 0; i < W * sh * 4; i++) dv.setUint16(pixOff + (y * W * 4 + i) * 2, Math.round(Math.min(1, Math.max(0, d[i])) * 65535), true)
    } else {
      const d = g.getImageData(0, y, W, sh, { colorSpace: f.space }).data
      out.set(d, pixOff + y * W * 4)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Camera RAW
// ---------------------------------------------------------------------------

// Adobe RGB (1998) primaries, D50-adapted: LibRaw develops into linear Adobe RGB, we convert to Display P3.
const ADOBE_TO_XYZ: Mat3 = [0.6097559, 0.2052401, 0.149224, 0.3111242, 0.625656, 0.0632197, 0.0194811, 0.0608902, 0.7448387]

/** Inverse of dcraw's gamma_curve(0.45, 4.5), i.e. the BT.709 transfer function. */
function bt709Decode(v: number): number {
  return v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45)
}

/**
 * Develops a camera RAW file with LibRaw (camera white balance, AHD
 * demosaic) into a 16-bit Display P3 document.
 */
export async function importRaw(bytes: Uint8Array, name: string, settings: Record<string, unknown> = {}): Promise<ImportResult> {
  const { default: LibRaw } = await import('libraw-wasm')
  const raw = new LibRaw()
  try {
    // LibRaw's wasm build always applies its default BT.709 tone curve (the gamm setting is
    // not honoured), so ask for exactly that curve and undo it below to get linear light.
    await raw.open(new Uint8Array(bytes), { outputBps: 16, outputColor: 2, gamm: [0.45, 4.5], useCameraWb: true, userQual: 3, noAutoBright: true, ...settings })
    const meta = await raw.metadata()
    const img = await raw.imageData()
    if (!img || !img.data) throw new Error('LibRaw could not develop this file.')
    const { width: w, height: h, colors } = img
    const src = img.data
    const max = img.bits === 16 ? 65535 : 255
    const linear = new Float32Array(max + 1)
    for (let v = 0; v <= max; v++) linear[v] = bt709Decode(v / max)
    const rgba = new Float32Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = linear[src[i * colors + Math.min(k, colors - 1)]]
      rgba[i * 4 + 3] = 1
    }
    const linearAdobe: IccProfile = { name: 'Linear Adobe RGB', colorSpace: 'RGB', toXYZ: ADOBE_TO_XYZ, trc: [(v) => v, (v) => v, (v) => v], matrixShaper: true }
    convertPixels(rgba, linearAdobe, 'display-p3')
    const doc = documentFromRgba(name, w, h, rgba, { depth: 16, space: 'display-p3' })
    const cam = meta ? `${meta.camera_make} ${meta.camera_model}`.trim() : ''
    return { doc, note: `Developed${cam ? ` (${cam})` : ''} with LibRaw: camera white balance, 16 bits/channel, Display P3.` }
  } finally {
    raw.dispose()
  }
}
