/**
 * The Cadence+ document model: plain, serialisable data.
 *
 * Raster pixels live in immutable 256×256 tiles held by the renderer's tile
 * store; layers reference them by id. An edit that changes pixels creates new
 * tiles for the touched area only and swaps the ids in the model, so the
 * snapshot-based undo history records exactly the changed tiles per step.
 */
import type { Adjustment } from './adjustments'
import type { Selection } from './selection'

export const TILE = 256
/** Chromium's canvas limit is 16384 × 16384 (268 M pixels). */
export const MAX_DIMENSION = 16384

export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

/** Grouped as in the Layers panel menu; null = separator. */
export const BLEND_MODES: ({ id: BlendMode; label: string } | null)[] = [
  { id: 'normal', label: 'Normal' },
  null,
  { id: 'darken', label: 'Darken' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'color-burn', label: 'Color Burn' },
  null,
  { id: 'lighten', label: 'Lighten' },
  { id: 'screen', label: 'Screen' },
  { id: 'color-dodge', label: 'Color Dodge' },
  null,
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft Light' },
  { id: 'hard-light', label: 'Hard Light' },
  null,
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  null,
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' }
]

/** "tx,ty" (layer-local tile coordinates) → tile id. */
export type TileMap = Record<string, string>

export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`
export function parseTileKey(k: string): [number, number] {
  const i = k.indexOf(',')
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))]
}

export type LayerContent =
  /** Pixels. (x, y) is the document position of the layer's tile (0,0) origin. */
  | { type: 'raster'; x: number; y: number; tiles: TileMap }
  /** A solid colour covering the whole canvas. */
  | { type: 'fill'; color: string }
  /** Non-destructive adjustment applied to everything below. */
  | { type: 'adjustment'; adjustment: Adjustment }

/** Pixels addressed by tiles from an origin; shared by raster content and masks. */
export interface TileSurface {
  x: number
  y: number
  tiles: TileMap
}

/**
 * A layer mask. Tiles hold how much of the layer is hidden, in alpha
 * (0 = visible, 255 = hidden); missing tiles are fully visible. The mask
 * moves with its layer.
 */
export interface LayerMask extends TileSurface {
  enabled: boolean
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  /** Locked layers refuse every edit except visibility and unlocking. */
  locked: boolean
  /** 0..1 */
  opacity: number
  blend: BlendMode
  content: LayerContent
  mask?: LayerMask | null
}

export interface ImageDocument {
  id: string
  name: string
  width: number
  height: number
  /** Pixels per inch; metadata only. */
  resolution: number
  /** Bottom → top. */
  layers: Layer[]
  activeLayerId: string | null
  selection: Selection | null
  /** Which part of the active layer edits go to (missing = pixels). */
  target?: 'pixels' | 'mask'
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

let counter = 0
export function uid(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function createLayer(name: string, content: LayerContent = { type: 'raster', x: 0, y: 0, tiles: {} }): Layer {
  return { id: uid('layer'), name, visible: true, locked: false, opacity: 1, blend: 'normal', content }
}

export function checkDimensions(width: number, height: number): void {
  if (!(width >= 1 && height >= 1)) throw new Error('Width and height must be at least 1 pixel.')
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error(`Width and height are limited to ${MAX_DIMENSION.toLocaleString()} pixels.`)
}

/** A document whose first layer has the given tiles (or is empty). */
export function createDocument(opts: { name: string; width: number; height: number; resolution?: number; baseName?: string; tiles?: TileMap }): ImageDocument {
  const width = Math.round(opts.width)
  const height = Math.round(opts.height)
  checkDimensions(width, height)
  const base = createLayer(opts.baseName ?? (opts.tiles ? 'Background' : 'Layer 1'), { type: 'raster', x: 0, y: 0, tiles: opts.tiles ?? {} })
  return {
    id: uid('doc'),
    name: opts.name.trim() || 'Untitled',
    width,
    height,
    resolution: opts.resolution ?? 72,
    layers: [base],
    activeLayerId: base.id,
    selection: null
  }
}

export function findLayer(doc: ImageDocument, id: string | null): Layer | undefined {
  return id ? doc.layers.find((l) => l.id === id) : undefined
}

export function activeLayer(doc: ImageDocument): Layer | undefined {
  return findLayer(doc, doc.activeLayerId)
}

/** Document-space bounds of a surface's tiles (null when empty). */
export function rasterBounds(content: TileSurface): Rect | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const k of Object.keys(content.tiles)) {
    const [tx, ty] = parseTileKey(k)
    x0 = Math.min(x0, tx)
    y0 = Math.min(y0, ty)
    x1 = Math.max(x1, tx + 1)
    y1 = Math.max(y1, ty + 1)
  }
  if (x0 === Infinity) return null
  return { x: content.x + x0 * TILE, y: content.y + y0 * TILE, w: (x1 - x0) * TILE, h: (y1 - y0) * TILE }
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.w, b.x + b.w)
  const btm = Math.min(a.y + a.h, b.y + b.h)
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** Expands a rect outward to whole pixels. */
export function roundOut(r: Rect): Rect {
  const x = Math.floor(r.x)
  const y = Math.floor(r.y)
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y }
}

/** Every tile id referenced by a document (for the tile garbage collector). */
export function collectTileIds(doc: ImageDocument, out: Set<string>): void {
  for (const l of doc.layers) {
    if (l.content.type === 'raster') for (const id of Object.values(l.content.tiles)) out.add(id)
    if (l.mask) for (const id of Object.values(l.mask.tiles)) out.add(id)
  }
}
