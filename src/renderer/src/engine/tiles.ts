/**
 * The runtime pixel store. Tiles are immutable 256×256 ImageBitmaps, masks
 * are immutable ImageBitmaps of any size. The document model references both
 * by id, so undo snapshots share pixels instead of copying them.
 */
import { parseTileKey, rasterBounds, tileKey, TILE, type Rect, type TileMap, type TileSurface } from '@core/model'

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const tiles = new Map<string, ImageBitmap>()
const masks = new Map<string, ImageBitmap>()
const solid = new Map<string, string>()
let seq = 0

function nextId(prefix: string): string {
  seq += 1
  return `${prefix}${seq.toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function getTile(id: string): ImageBitmap | undefined {
  return tiles.get(id)
}

export function putTile(bmp: ImageBitmap, id = nextId('t')): string {
  tiles.set(id, bmp)
  return id
}

export function getMask(id: string): ImageBitmap | undefined {
  return masks.get(id)
}

export function putMask(bmp: ImageBitmap, id = nextId('m')): string {
  masks.set(id, bmp)
  return id
}

const scratch = new OffscreenCanvas(TILE, TILE)
const sctx = scratch.getContext('2d')!

/** Builds a tile by drawing into a cleared 256×256 scratch canvas. */
export function makeTile(draw: (ctx: OffscreenCanvasRenderingContext2D) => void): string {
  sctx.save()
  sctx.clearRect(0, 0, TILE, TILE)
  draw(sctx)
  sctx.restore()
  return putTile(scratch.transferToImageBitmap())
}

/** A shared, immutable tile of one colour (a white background costs one tile). */
export function solidTile(color: string): string {
  let id = solid.get(color)
  if (!id) {
    id = makeTile((g) => {
      g.fillStyle = color
      g.fillRect(0, 0, TILE, TILE)
    })
    solid.set(color, id)
  }
  return id
}

/** Tile map covering `w × h` pixels from the layer origin with a solid colour. */
export function solidTiles(w: number, h: number, color: string): TileMap {
  const id = solidTile(color)
  const out: TileMap = {}
  for (let ty = 0; ty < Math.ceil(h / TILE); ty++) for (let tx = 0; tx < Math.ceil(w / TILE); tx++) out[tileKey(tx, ty)] = id
  return out
}

/** Reusable canvases keyed by purpose; resized on demand. */
const pool = new Map<string, OffscreenCanvas>()
export function poolCanvas(key: string, w: number, h: number): OffscreenCanvas {
  w = Math.max(1, Math.ceil(w))
  h = Math.max(1, Math.ceil(h))
  let c = pool.get(key)
  if (!c) {
    c = new OffscreenCanvas(w, h)
    pool.set(key, c)
  } else if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  } else {
    // reset() clears the pixels and every piece of state (composite op, filter, transform, clip).
    c.getContext('2d')!.reset()
  }
  return c
}

/** Frees pooled canvases (they can be large). */
export function releasePool(key: string): void {
  const c = pool.get(key)
  if (c) {
    c.width = c.height = 1
    pool.delete(key)
  }
}

const emptyCheck = new OffscreenCanvas(TILE, TILE)
const ectx = emptyCheck.getContext('2d', { willReadFrequently: true })!

function isTransparent(src: CanvasImageSource): boolean {
  ectx.clearRect(0, 0, TILE, TILE)
  ectx.drawImage(src, 0, 0)
  const d = ectx.getImageData(0, 0, TILE, TILE).data
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false
  return true
}

/**
 * Slices `src` (whose pixel (0,0) sits at document (srcX, srcY)) into tiles
 * for a layer whose origin is (layerX, layerY). Fully transparent tiles are
 * dropped. Returns a complete tile map for the covered area.
 */
export function tilesFromCanvas(src: CanvasImageSource & { width: number; height: number }, srcX: number, srcY: number, layerX: number, layerY: number): TileMap {
  const out: TileMap = {}
  const tx0 = Math.floor((srcX - layerX) / TILE)
  const ty0 = Math.floor((srcY - layerY) / TILE)
  const tx1 = Math.ceil((srcX + src.width - layerX) / TILE)
  const ty1 = Math.ceil((srcY + src.height - layerY) / TILE)
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      const ox = layerX + tx * TILE - srcX
      const oy = layerY + ty * TILE - srcY
      sctx.clearRect(0, 0, TILE, TILE)
      sctx.drawImage(src, -ox, -oy)
      if (isTransparent(scratch)) continue
      out[tileKey(tx, ty)] = putTile(scratch.transferToImageBitmap())
    }
  }
  return out
}

/** Draws a raster layer's tiles at 1:1 into `ctx`, with document (0,0) at (dx, dy). */
export function drawTiles(ctx: Ctx2D, content: TileSurface, dx: number, dy: number): void {
  for (const [k, id] of Object.entries(content.tiles)) {
    const bmp = tiles.get(id)
    if (!bmp) continue
    const [tx, ty] = parseTileKey(k)
    ctx.drawImage(bmp, dx + content.x + tx * TILE, dy + content.y + ty * TILE)
  }
}

/** A raster layer's pixels as one canvas covering its tile bounds (null if empty). */
export function rasterToCanvas(content: TileSurface, key = 'raster'): { canvas: OffscreenCanvas; rect: Rect } | null {
  const r = rasterBounds(content)
  if (!r) return null
  const c = poolCanvas(key, r.w, r.h)
  drawTiles(c.getContext('2d')!, content, -r.x, -r.y)
  return { canvas: c, rect: r }
}

/** Deletes tiles and masks no longer referenced by any open document or history step. */
export function collectGarbage(liveTiles: Set<string>, liveMasks: Set<string>): number {
  const keep = new Set(solid.values())
  let freed = 0
  for (const [id, bmp] of tiles) {
    if (!liveTiles.has(id) && !keep.has(id)) {
      bmp.close()
      tiles.delete(id)
      freed++
    }
  }
  for (const [id, bmp] of masks) {
    if (!liveMasks.has(id)) {
      bmp.close()
      masks.delete(id)
      freed++
    }
  }
  return freed
}

export function storeStats(): { tiles: number; masks: number; bytes: number } {
  let bytes = 0
  for (const b of tiles.values()) bytes += b.width * b.height * 4
  for (const b of masks.values()) bytes += b.width * b.height * 4
  return { tiles: tiles.size, masks: masks.size, bytes }
}
