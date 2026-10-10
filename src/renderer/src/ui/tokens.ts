/**
 * Design tokens for code that draws on canvases (rulers, viewport, layer
 * thumbnails). Values come from the CSS custom properties in theme.css, so the
 * stylesheet remains the single source of truth.
 */
const cache = new Map<string, string>()

export function token(name: string, fallback = '#888'): string {
  let v = cache.get(name)
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    cache.set(name, v)
  }
  return v
}

export function tokenPx(name: string, fallback: number): number {
  const n = parseFloat(token(name, String(fallback)))
  return Number.isFinite(n) ? n : fallback
}

/** Hex colour → rgba() string with alpha. */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const checkerCache = new Map<number, HTMLCanvasElement>()

/** A 2×2-cell tile of the transparency checkerboard, `cell` device pixels per cell. */
export function checkerTile(cell: number): HTMLCanvasElement {
  const c = Math.max(1, Math.round(cell))
  let tile = checkerCache.get(c)
  if (!tile) {
    tile = document.createElement('canvas')
    tile.width = tile.height = c * 2
    const g = tile.getContext('2d')!
    g.fillStyle = token('--checker-a', '#f4f4f4')
    g.fillRect(0, 0, c * 2, c * 2)
    g.fillStyle = token('--checker-b', '#cdcdcd')
    g.fillRect(c, 0, c, c)
    g.fillRect(0, c, c, c)
    checkerCache.set(c, tile)
  }
  return tile
}
