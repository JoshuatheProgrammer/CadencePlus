/**
 * Reading and writing pixels: image decode, the .cadenceimg project format,
 * and flattened export.
 */
import { packProject, unpackProject, FormatError } from '@core/format'
import { collectTileIds, createDocument, uid, type ImageDocument } from '@core/model'
import { collectMaskIds } from '@core/selection'
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

export const extOf = (path: string): string => /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
export const baseName = (path: string): string => path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')

/** Decodes an image file (8-bit, converted to sRGB). */
export async function decodeImage(bytes: Uint8Array, ext: string): Promise<ImageBitmap> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: IMAGE_MIME[ext] ?? '' })
  try {
    return await createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
  } catch {
    throw new Error(`Cadence+ could not decode this ${ext ? ext.toUpperCase() + ' ' : ''}file. It may be damaged, or use a format variant Chromium does not support.`)
  }
}

export function documentFromBitmap(name: string, bmp: ImageBitmap): ImageDocument {
  const tiles = tilesFromCanvas(bmp, 0, 0, 0, 0)
  return createDocument({ name, width: bmp.width, height: bmp.height, tiles, baseName: 'Background' })
}

async function pngOf(bmp: ImageBitmap): Promise<Uint8Array> {
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Encodes a document and every tile/mask it references. */
export async function encodeProject(doc: ImageDocument, appVersion: string): Promise<Uint8Array> {
  const tileIds = new Set<string>()
  const maskIds = new Set<string>()
  collectTileIds(doc, tileIds)
  collectMaskIds(doc.selection, maskIds)
  const blobs = new Map<string, Uint8Array>()
  const jobs: Promise<void>[] = []
  for (const id of tileIds) {
    const b = getTile(id)
    if (!b) throw new Error('Some pixel data is missing from memory; the document cannot be saved.')
    jobs.push(pngOf(b).then((png) => void blobs.set(id, png)))
  }
  for (const id of maskIds) {
    const b = getMask(id)
    if (b) jobs.push(pngOf(b).then((png) => void blobs.set(id, png)))
  }
  await Promise.all(jobs)
  return packProject(doc, `Cadence+ ${appVersion}`, blobs)
}

/** Decodes a .cadenceimg into a document whose tiles are loaded into the store. */
export async function decodeProject(bytes: Uint8Array): Promise<ImageDocument> {
  const { header, blob } = unpackProject(bytes)
  const doc = header.document
  if (!doc || !Array.isArray(doc.layers) || !(doc.width > 0 && doc.height > 0)) throw new FormatError('The document data is damaged.')
  const remap = new Map<string, string>()
  const load = async (id: string, mask: boolean) => {
    if (remap.has(id)) return
    remap.set(id, '')
    const png = blob(id)
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
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
  }
  if (doc.selection) {
    for (const st of doc.selection.steps) if ('shape' in st && st.shape.kind === 'mask') st.shape.maskId = remap.get(st.shape.maskId)!
  }
  return { ...doc, id: uid('doc') }
}

export type ExportFormat = 'png' | 'jpeg' | 'webp'

/** The flattened image. JPEG has no alpha, so transparency becomes `matte`. */
export async function exportImage(doc: ImageDocument, format: ExportFormat, quality: number, matte = '#ffffff'): Promise<Uint8Array> {
  const comp = renderComposite(doc, 'export')
  let src: OffscreenCanvas = comp
  if (format === 'jpeg') {
    src = new OffscreenCanvas(doc.width, doc.height)
    const g = src.getContext('2d')!
    g.fillStyle = matte
    g.fillRect(0, 0, doc.width, doc.height)
    g.drawImage(comp, 0, 0)
  }
  const blob = await src.convertToBlob({ type: `image/${format}`, quality: format === 'png' ? undefined : quality })
  if (blob.type !== `image/${format}`) throw new Error(`This system cannot encode ${format.toUpperCase()} images.`)
  return new Uint8Array(await blob.arrayBuffer())
}

/** Encodes a canvas as PNG bytes (clipboard). */
export async function canvasToPng(c: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await c.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
