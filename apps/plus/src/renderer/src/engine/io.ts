/**
 * Reading and writing pixels: colour-managed image import, the .cadenceimg
 * project format (16-bit and Display P3 tiles round-trip exactly), and
 * flattened export (16-bit PNG, embedded P3 profiles).
 */
import { packProject, unpackProject, FormatError } from '@core/format'
import { isWideGamut, matchesWorkingSpace, parseIcc, convertPixels, type IccProfile } from '@core/icc'
import { collectTileIds, createDocument, docColor, uid, type DocColor, type ImageDocument } from '@core/model'
import { decodePng, pngInfo } from '@core/png'
import { collectMaskIds } from '@core/selection'
import { ctx2d, pixelCanvas, withFormat, type PixelFormat } from './format'
import { renderComposite } from './render'
import { getMask, getTile, putMask, putTile, tilesFromCanvas } from './tiles'

export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp'
}

/** Camera RAW extensions LibRaw can develop. */
export const RAW_EXTENSIONS = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw']

export const extOf = (path: string): string => /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
export const baseName = (path: string): string => path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')

/** Decodes an image file with Chromium (8-bit, converted to sRGB). */
export async function decodeImage(bytes: Uint8Array, ext: string, conversion: ColorSpaceConversion = 'default'): Promise<ImageBitmap> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: IMAGE_MIME[ext] ?? '' })
  try {
    return await createImageBitmap(blob, { colorSpaceConversion: conversion, premultiplyAlpha: 'default' })
  } catch {
    throw new Error(`Cadence+ could not decode this ${ext ? ext.toUpperCase() + ' ' : ''}file. It may be damaged, or use a format variant Chromium does not support.`)
  }
}

export function documentFromBitmap(name: string, bmp: ImageBitmap): ImageDocument {
  const tiles = tilesFromCanvas(bmp, 0, 0, 0, 0)
  return createDocument({ name, width: bmp.width, height: bmp.height, tiles, baseName: 'Background' })
}

// ---------------------------------------------------------------------------
// Float pixels → canvases in a given format
// ---------------------------------------------------------------------------

/** Writes straight-alpha RGBA floats (0..1) into a new canvas of format `f`, in strips. */
export function canvasFromRgba(rgba: Float32Array, w: number, h: number, f: PixelFormat): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h)
  const g = ctx2d(c, undefined, f)
  const strip = Math.max(1, Math.floor(4_000_000 / Math.max(1, w)))
  for (let y0 = 0; y0 < h; y0 += strip) {
    const sh = Math.min(strip, h - y0)
    const n = w * sh * 4
    const src = rgba.subarray(y0 * w * 4, y0 * w * 4 + n)
    let img: ImageData
    if (f.depth === 16) {
      img = new ImageData(w, sh, { colorSpace: f.space, pixelFormat: 'rgba-float16' } as ImageDataSettings)
      ;(img.data as unknown as Float16Array).set(src)
    } else {
      img = new ImageData(w, sh, { colorSpace: f.space })
      const d = img.data
      for (let i = 0; i < n; i++) d[i] = Math.round(src[i] * 255)
    }
    g.putImageData(img, 0, y0)
  }
  return c
}

export function documentFromRgba(name: string, w: number, h: number, rgba: Float32Array, color: DocColor): ImageDocument {
  return withFormat(color, () => {
    const c = canvasFromRgba(rgba, w, h, color)
    const tiles = tilesFromCanvas(c, 0, 0, 0, 0)
    c.width = c.height = 1
    return createDocument({ name, width: w, height: h, tiles, baseName: 'Background', color })
  })
}

// ---------------------------------------------------------------------------
// Embedded profiles
// ---------------------------------------------------------------------------

/** The ICC profile embedded in a JPEG (APP2 ICC_PROFILE segments) or WebP (ICCP chunk). */
export function extractIcc(b: Uint8Array, ext: string): Uint8Array | null {
  if (ext === 'jpg' || ext === 'jpeg') {
    if (b[0] !== 0xff || b[1] !== 0xd8) return null
    const parts: { seq: number; data: Uint8Array }[] = []
    let o = 2
    while (o + 4 < b.length && b[o] === 0xff) {
      const marker = b[o + 1]
      if (marker === 0xda || marker === 0xd9) break
      const len = (b[o + 2] << 8) | b[o + 3]
      if (marker === 0xe2 && String.fromCharCode(...b.subarray(o + 4, o + 15)) === 'ICC_PROFILE') parts.push({ seq: b[o + 16], data: b.subarray(o + 18, o + 2 + len) })
      o += 2 + len
    }
    if (!parts.length) return null
    parts.sort((x, y) => x.seq - y.seq)
    const out = new Uint8Array(parts.reduce((n, p) => n + p.data.length, 0))
    let p = 0
    for (const part of parts) {
      out.set(part.data, p)
      p += part.data.length
    }
    return out
  }
  if (ext === 'webp') {
    if (String.fromCharCode(...b.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...b.subarray(8, 12)) !== 'WEBP') return null
    let o = 12
    while (o + 8 <= b.length) {
      const type = String.fromCharCode(...b.subarray(o, o + 4))
      const len = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)
      if (type === 'ICCP') return b.subarray(o + 8, o + 8 + len)
      o += 8 + len + (len & 1)
    }
  }
  return null
}

export interface ImportResult {
  doc: ImageDocument
  /** What colour handling happened, for the user. */
  note: string | null
}

const spaceName = (s: DocColor['space']) => (s === 'srgb' ? 'sRGB' : 'Display P3')

/**
 * Brings pixels described by `profile` into a working space: kept as-is
 * when they already are sRGB/P3, otherwise converted (into P3 when the
 * source gamut is wider than sRGB, so less is clipped).
 */
function manage(rgba: Float32Array, profile: IccProfile | null, fallback: DocColor['space']): { space: DocColor['space']; note: string | null } {
  if (!profile) return { space: fallback, note: null }
  const same = matchesWorkingSpace(profile)
  if (same) return { space: same, note: same === 'srgb' ? null : `Kept in ${spaceName(same)}.` }
  const space = isWideGamut(profile) ? 'display-p3' : 'srgb'
  convertPixels(rgba, profile, space)
  return { space, note: `Converted from “${profile.name || 'embedded profile'}” to ${spaceName(space)}.` }
}

/**
 * Opens an image file as a document. 16-bit PNGs keep 16 bits; images with
 * embedded profiles are colour-managed into sRGB or Display P3. Everything
 * else takes Chromium's 8-bit sRGB decode.
 */
export async function importImage(bytes: Uint8Array, ext: string, name: string): Promise<ImportResult> {
  if (ext === 'psd' || ext === 'psb') return (await import('./formats')).importPsd(bytes, name)
  if (ext === 'tif' || ext === 'tiff') return (await import('./formats')).importTiff(bytes, name)
  if (RAW_EXTENSIONS.includes(ext)) return (await import('./formats')).importRaw(bytes, name)
  if (ext === 'png') {
    const info = await pngInfo(bytes).catch(() => null)
    const profile = info?.icc ? tryParse(info.icc.profile) : null
    const p3 = info?.cicp?.primaries === 12
    const special = info && (info.bitDepth === 16 || p3 || (profile && matchesWorkingSpace(profile) !== 'srgb'))
    if (info && special && (!profile || profile.matrixShaper)) {
      const png = await decodePng(bytes)
      const { space, note } = manage(png.rgba, profile, p3 ? 'display-p3' : 'srgb')
      const depth = png.bitDepth === 16 ? 16 : 8
      const doc = documentFromRgba(name, png.width, png.height, png.rgba, { depth, space })
      return { doc, note: [depth === 16 ? 'Opened at 16 bits/channel.' : null, note].filter(Boolean).join(' ') || null }
    }
  } else {
    const icc = extractIcc(bytes, ext)
    const profile = icc ? tryParse(icc) : null
    if (profile && profile.matrixShaper && matchesWorkingSpace(profile) !== 'srgb') {
      // Raw (unconverted) pixels, then our own conversion.
      const bmp = await decodeImage(bytes, ext, 'none')
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(bmp, 0, 0)
      bmp.close()
      const d = g.getImageData(0, 0, c.width, c.height).data
      const rgba = new Float32Array(d.length)
      for (let i = 0; i < d.length; i++) rgba[i] = d[i] / 255
      const { space, note } = manage(rgba, profile, 'srgb')
      return { doc: documentFromRgba(name, c.width, c.height, rgba, { depth: 8, space }), note }
    }
  }
  const bmp = await decodeImage(bytes, ext)
  const doc = documentFromBitmap(name, bmp)
  bmp.close()
  return { doc, note: null }
}

function tryParse(b: Uint8Array): IccProfile | null {
  try {
    return parseIcc(b)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

/** PNG of a tile in the document's format (16-bit for 16-bit documents; P3 tagged for P3). */
async function pngOf(bmp: ImageBitmap, f: PixelFormat): Promise<Uint8Array> {
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  ctx2d(c, undefined, f).drawImage(bmp, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Encodes a document and every tile/mask it references. */
export async function encodeProject(doc: ImageDocument, appVersion: string): Promise<Uint8Array> {
  // Quick Mask is a temporary editing mode; it is not saved.
  if (doc.quickMask) doc = { ...doc, quickMask: undefined }
  const f = docColor(doc)
  const tileIds = new Set<string>()
  const maskIds = new Set<string>()
  collectTileIds(doc, tileIds)
  collectMaskIds(doc.selection, maskIds)
  const blobs = new Map<string, Uint8Array>()
  const jobs: Promise<void>[] = []
  for (const id of tileIds) {
    const b = getTile(id)
    if (!b) throw new Error('Some pixel data is missing from memory; the document cannot be saved.')
    jobs.push(pngOf(b, f).then((png) => void blobs.set(id, png)))
  }
  for (const id of maskIds) {
    const b = getMask(id)
    if (b) jobs.push(pngOf(b, { depth: 8, space: 'srgb' }).then((png) => void blobs.set(id, png)))
  }
  await Promise.all(jobs)
  return packProject(doc, `Cadence+ ${appVersion}`, blobs)
}

/** Decodes a .cadenceimg into a document whose tiles are loaded into the store. */
export async function decodeProject(bytes: Uint8Array): Promise<ImageDocument> {
  const { header, blob } = unpackProject(bytes)
  const doc = header.document
  if (!doc || !Array.isArray(doc.layers) || !(doc.width > 0 && doc.height > 0)) throw new FormatError('The document data is damaged.')
  const f = docColor(doc)
  // 16-bit and P3 tiles are decoded exactly by our own decoder; Chromium would reduce them to 8-bit sRGB.
  const exact = f.depth === 16 || f.space !== 'srgb'
  const remap = new Map<string, string>()
  const load = async (id: string, mask: boolean) => {
    if (remap.has(id)) return
    remap.set(id, '')
    const png = blob(id)
    let bmp: ImageBitmap
    try {
      if (exact && !mask) {
        const d = await decodePng(png)
        bmp = canvasFromRgba(d.rgba, d.width, d.height, f).transferToImageBitmap()
      } else bmp = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
    } catch {
      throw new FormatError('Some pixel data in the document is damaged.')
    }
    remap.set(id, mask ? putMask(bmp) : putTile(bmp))
  }
  const tileIds = new Set<string>()
  const maskIds = new Set<string>()
  collectTileIds(doc, tileIds)
  collectMaskIds(doc.selection, maskIds)
  await Promise.all([...[...tileIds].map((id) => load(id, false)), ...[...maskIds].map((id) => load(id, true))])
  for (const l of doc.layers) {
    if (l.content.type === 'raster') for (const k of Object.keys(l.content.tiles)) l.content.tiles[k] = remap.get(l.content.tiles[k])!
    if (l.mask) for (const k of Object.keys(l.mask.tiles)) l.mask.tiles[k] = remap.get(l.mask.tiles[k])!
  }
  if (doc.selection) {
    for (const st of doc.selection.steps) if ('shape' in st && st.shape.kind === 'mask') st.shape.maskId = remap.get(st.shape.maskId)!
  }
  return { ...doc, id: uid('doc') }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'tiff' | 'psd'

export const EXPORT_EXTENSION: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', tiff: 'tif', psd: 'psd' }

export interface ExportOptions {
  /** JPEG has no alpha: transparency becomes this colour. */
  matte?: string
  /** 16-bit documents: write 16 bits/channel (PNG, TIFF). */
  sixteenBit?: boolean
  /** Output size relative to the document (1 = actual pixels). Not used for PSD. */
  scale?: number
}

/**
 * The flattened image at `scale`, in the document's format. Downscaling
 * halves in steps first so large reductions stay smooth.
 */
export function scaledComposite(doc: ImageDocument, scale = 1, key = 'export'): OffscreenCanvas {
  const comp = renderComposite(doc, key)
  if (Math.abs(scale - 1) < 1e-6) return comp
  const w = Math.max(1, Math.round(doc.width * scale))
  const h = Math.max(1, Math.round(doc.height * scale))
  let src: OffscreenCanvas = comp
  while (src.width / 2 >= w * 1.5 && src.height / 2 >= 1) {
    const half = pixelCanvas(Math.ceil(src.width / 2), Math.ceil(src.height / 2))
    const hg = ctx2d(half)
    hg.imageSmoothingQuality = 'high'
    hg.drawImage(src, 0, 0, half.width, half.height)
    src = half
  }
  const out = pixelCanvas(w, h)
  const g = ctx2d(out)
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, w, h)
  return out
}

/**
 * The flattened image, in the document's colour space (Display P3 files
 * carry an embedded profile).
 */
export async function exportImage(doc: ImageDocument, format: ExportFormat, quality: number, opts: ExportOptions = {}): Promise<Uint8Array> {
  return (await exportFile(doc, format, quality, opts)).bytes
}

/** Like exportImage, plus a note on anything the format could not carry (PSD). */
export async function exportFile(doc: ImageDocument, format: ExportFormat, quality: number, opts: ExportOptions = {}): Promise<{ bytes: Uint8Array; note: string | null }> {
  if (format === 'psd') return (await import('./formats')).exportPsd(doc)
  if (format === 'tiff') return { bytes: await (await import('./formats')).exportTiff(doc, !!opts.sixteenBit, opts.scale ?? 1), note: null }
  return { bytes: await encodeFlat(doc, format, quality, opts), note: null }
}

async function encodeFlat(doc: ImageDocument, format: 'png' | 'jpeg' | 'webp', quality: number, opts: ExportOptions): Promise<Uint8Array> {
  const f = docColor(doc)
  const src = withFormat(f, () => {
    const comp = scaledComposite(doc, opts.scale ?? 1)
    if (format === 'png' && f.depth === 16 && opts.sixteenBit) return comp
    const c = new OffscreenCanvas(comp.width, comp.height)
    const g = c.getContext('2d', { colorSpace: f.space })!
    if (format === 'jpeg') {
      g.fillStyle = opts.matte ?? '#ffffff'
      g.fillRect(0, 0, c.width, c.height)
    }
    g.drawImage(comp, 0, 0)
    return c
  })
  const blob = await src.convertToBlob({ type: `image/${format}`, quality: format === 'png' ? undefined : quality })
  if (blob.type !== `image/${format}`) throw new Error(`This system cannot encode ${format.toUpperCase()} images.`)
  return new Uint8Array(await blob.arrayBuffer())
}

/** Encodes a canvas as PNG bytes (clipboard). */
export async function canvasToPng(c: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await c.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
