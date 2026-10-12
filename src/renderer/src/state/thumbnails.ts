/**
 * Previews for the Recent list on the home screen. A small render of the
 * composite is cached per file (in the user-data folder) whenever a file is
 * opened or saved; files without one, or changed on disk since, get theirs
 * made in the background.
 */
import { docColor, type ImageDocument } from '@core/model'
import { withFormat } from '../engine/format'
import { baseName, decodeProject, extOf, importImage } from '../engine/io'
import { renderDocument } from '../engine/render'
import { holdingTiles, scheduleGc } from './doc-actions'

export type ThumbMeta = {
  width: number
  height: number
  layers: number
  /** e.g. "RGB/16 · Display P3" */
  mode: string
  /** File modification time the preview was made from. */
  mtime: number
}

export interface RecentInfo {
  url: string | null
  meta: ThumbMeta | null
  /** Null when the file no longer exists. */
  stat: { size: number; mtime: number } | null
}

const MAX = 480

function modeOf(doc: ImageDocument): string {
  const c = docColor(doc)
  return `RGB/${c.depth}${c.space === 'display-p3' ? ' · Display P3' : ''}`
}

/** Renders and caches the preview of `doc`, which was just read from or written to `path`. */
export async function storeThumbnail(doc: ImageDocument, path: string): Promise<void> {
  const s = Math.min(1, MAX / Math.max(doc.width, doc.height))
  const w = Math.max(1, Math.round(doc.width * s))
  const h = Math.max(1, Math.round(doc.height * s))
  const full = withFormat(docColor(doc), () => {
    const c = new OffscreenCanvas(w, h)
    renderDocument(c, doc, { xf: { scale: s, ox: 0, oy: 0 }, width: w, height: h })
    return c
  })
  // An 8-bit sRGB PNG is plenty for a preview.
  const out = new OffscreenCanvas(w, h)
  out.getContext('2d')!.drawImage(full, 0, 0)
  const png = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer())
  const stat = await window.cadencePlus.statFile(path)
  const meta: ThumbMeta = { width: doc.width, height: doc.height, layers: doc.layers.length, mode: modeOf(doc), mtime: stat?.mtime ?? Date.now() }
  await window.cadencePlus.putThumbnail(path, png, meta)
  urls.delete(path.toLowerCase())
}

const urls = new Map<string, string>()
let queue: Promise<void> = Promise.resolve()

/** Opens a file only to draw its preview (one at a time, tiles freed afterwards). */
function generate(path: string): Promise<void> {
  queue = queue.then(() =>
    holdingTiles(async () => {
      const bytes = await window.cadencePlus.readFile(path)
      const ext = extOf(path)
      const doc = ext === 'cadenceimg' ? await decodeProject(bytes) : (await importImage(bytes, ext, baseName(path))).doc
      await storeThumbnail(doc, path)
    })
      .catch(() => undefined)
      .finally(scheduleGc)
  )
  return queue
}

/** Preview, details and file status for a recent file; makes the preview if it is missing or stale. */
export async function recentInfo(path: string): Promise<RecentInfo> {
  const stat = await window.cadencePlus.statFile(path)
  if (!stat) return { url: null, meta: null, stat: null }
  let t = await window.cadencePlus.getThumbnail(path)
  if (!t || t.meta.mtime + 1000 < stat.mtime) {
    await generate(path)
    t = await window.cadencePlus.getThumbnail(path)
  }
  if (!t) return { url: null, meta: null, stat }
  const key = path.toLowerCase()
  let url = urls.get(key)
  if (!url) {
    url = URL.createObjectURL(new Blob([t.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
    urls.set(key, url)
  }
  return { url, meta: t.meta as unknown as ThumbMeta, stat }
}

/** "just now", "5 min ago", "3 h ago", "yesterday", or a date. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86400) return 'yesterday'
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
