/**
 * The .cadenceimg container: a versioned JSON header followed by binary blobs
 * (PNG-encoded tiles and masks).
 *
 *   bytes 0..7   magic "CADIMG\r\n"
 *   bytes 8..11  header length (uint32, little-endian)
 *   header       UTF-8 JSON  { format, app, document, blobs: { id: [offset, length] } }
 *   blobs        concatenated; offsets are relative to the end of the header
 */
import type { ImageDocument } from './model'

export const FORMAT_VERSION = 1
export const PROJECT_EXTENSION = 'cadenceimg'
const MAGIC = 'CADIMG\r\n'

export interface ProjectHeader {
  format: number
  app: string
  document: ImageDocument
  /** Blob id → [offset, length]. Tile and mask ids share this table. */
  blobs: Record<string, [number, number]>
}

export class FormatError extends Error {}

export function packProject(document: ImageDocument, app: string, blobs: Map<string, Uint8Array>): Uint8Array {
  const table: Record<string, [number, number]> = {}
  let offset = 0
  for (const [id, b] of blobs) {
    table[id] = [offset, b.length]
    offset += b.length
  }
  const header: ProjectHeader = { format: FORMAT_VERSION, app, document, blobs: table }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(12 + json.length + offset)
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i)
  new DataView(out.buffer).setUint32(8, json.length, true)
  out.set(json, 12)
  let p = 12 + json.length
  for (const b of blobs.values()) {
    out.set(b, p)
    p += b.length
  }
  return out
}

export function unpackProject(bytes: Uint8Array): { header: ProjectHeader; blob(id: string): Uint8Array } {
  for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw new FormatError('This is not a Cadence+ document.')
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true)
  if (12 + len > bytes.length) throw new FormatError('The document is truncated.')
  let header: ProjectHeader
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len))) as ProjectHeader
  } catch {
    throw new FormatError('The document header is damaged.')
  }
  if (typeof header.format !== 'number') throw new FormatError('The document header is damaged.')
  if (header.format > FORMAT_VERSION) throw new FormatError(`This document was saved by a newer version of Cadence+ (format ${header.format}). Update Cadence+ to open it.`)
  const base = 12 + len
  return {
    header: migrate(header),
    blob(id) {
      const e = header.blobs[id]
      if (!e) throw new FormatError(`The document is missing data block ${id}.`)
      if (base + e[0] + e[1] > bytes.length) throw new FormatError('The document is truncated.')
      return bytes.subarray(base + e[0], base + e[0] + e[1])
    }
  }
}

/** Upgrades older headers to the current format (none yet). */
function migrate(h: ProjectHeader): ProjectHeader {
  return h
}
