/**
 * Mip levels for zoomed-out views. For each raster layer and level L
 * (1/2^L scale) we keep one downscaled canvas of the whole layer, built once
 * with high-quality filtering and then patched tile by tile when the layer's
 * tile map changes. Zoomed-out frames then draw one image per layer instead
 * of hundreds of downscaled tiles.
 */
import { parseTileKey, TILE, type TileMap, type TileSurface } from '@core/model'
import { formatKey } from './format'
import { getTile } from './tiles'
import { ctx2d } from './format'

export interface MipEntry {
  tiles: TileMap
  level: number
  canvas: OffscreenCanvas
  /** Layer-local tile coordinates of the canvas origin. */
  tx0: number
  ty0: number
  cols: number
  rows: number
  used: number
}

const MAX_LEVEL = 7
const BUDGET = 768 * 1024 * 1024
const MAX_SIDE = 16384

const cache = new Map<string, MipEntry>()
let bytes = 0
let clock = 0

/** Level whose scale keeps the remaining downscale within (0.5, 1]. 0 = draw tiles directly. */
export function mipLevel(scale: number): number {
  if (scale >= 0.5) return 0
  return Math.min(MAX_LEVEL, Math.floor(Math.log2(1 / scale)))
}

function tileBounds(tiles: TileMap): { tx0: number; ty0: number; tx1: number; ty1: number } | null {
  let tx0 = Infinity
  let ty0 = Infinity
  let tx1 = -Infinity
  let ty1 = -Infinity
  for (const k of Object.keys(tiles)) {
    const [tx, ty] = parseTileKey(k)
    if (tx < tx0) tx0 = tx
    if (ty < ty0) ty0 = ty
    if (tx + 1 > tx1) tx1 = tx + 1
    if (ty + 1 > ty1) ty1 = ty + 1
  }
  return tx0 === Infinity ? null : { tx0, ty0, tx1, ty1 }
}

function drawCell(g: OffscreenCanvasRenderingContext2D, e: MipEntry, k: string, id: string | undefined): void {
  const cell = TILE >> e.level
  const [tx, ty] = parseTileKey(k)
  const x = (tx - e.tx0) * cell
  const y = (ty - e.ty0) * cell
  g.clearRect(x, y, cell, cell)
  const bmp = id ? getTile(id) : undefined
  if (bmp) g.drawImage(bmp, x, y, cell, cell)
}

function sizeOf(e: MipEntry): number {
  return e.canvas.width * e.canvas.height * 4
}

function evict(keep: string): void {
  while (bytes > BUDGET && cache.size > 1) {
    let oldest: string | null = null
    let t = Infinity
    for (const [k, e] of cache) {
      if (k !== keep && e.used < t) {
        t = e.used
        oldest = k
      }
    }
    if (!oldest) break
    const e = cache.get(oldest)!
    bytes -= sizeOf(e)
    e.canvas.width = e.canvas.height = 1
    cache.delete(oldest)
  }
}

/** The layer at `level`, up to date with its tiles (null if empty or too large). */
export function layerMip(layerId: string, c: TileSurface, level: number): MipEntry | null {
  const key = `${layerId}|${level}|${formatKey()}`
  let e = cache.get(key)
  if (e && e.tiles === c.tiles) {
    e.used = ++clock
    return e
  }
  const b = tileBounds(c.tiles)
  if (!b) return null
  const cell = TILE >> level
  const fits = e && b.tx0 >= e.tx0 && b.ty0 >= e.ty0 && b.tx1 <= e.tx0 + e.cols && b.ty1 <= e.ty0 + e.rows
  if (!e || !fits) {
    const cols = b.tx1 - b.tx0
    const rows = b.ty1 - b.ty0
    if (cols * cell > MAX_SIDE || rows * cell > MAX_SIDE) return null
    if (e) {
      bytes -= sizeOf(e)
      e.canvas.width = e.canvas.height = 1
    }
    e = { tiles: c.tiles, level, canvas: new OffscreenCanvas(cols * cell, rows * cell), tx0: b.tx0, ty0: b.ty0, cols, rows, used: 0 }
    const g = ctx2d(e.canvas)
    g.imageSmoothingQuality = 'high'
    for (const [k, id] of Object.entries(c.tiles)) drawCell(g, e, k, id)
    cache.set(key, e)
    bytes += sizeOf(e)
  } else {
    // Patch only the cells whose tile id changed.
    const g = ctx2d(e.canvas)
    g.imageSmoothingQuality = 'high'
    const old = e.tiles
    for (const k of Object.keys(old)) if (old[k] !== c.tiles[k]) drawCell(g, e, k, c.tiles[k])
    for (const k of Object.keys(c.tiles)) if (!(k in old)) drawCell(g, e, k, c.tiles[k])
  }
  e.tiles = c.tiles
  e.used = ++clock
  evict(key)
  return e
}

export function mipStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes }
}
