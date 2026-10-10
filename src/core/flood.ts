/**
 * Colour-range masks for the Magic Wand and Paint Bucket.
 * A pixel matches when every channel (including alpha) is within `tolerance`
 * of the seed pixel, as in Photoshop.
 */

/** Returns a mask (0 or 255 per pixel) of pixels matching the seed. */
export function colorMask(data: Uint8ClampedArray, width: number, height: number, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const mask = new Uint8Array(width * height)
  sx = Math.floor(sx)
  sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask
  const s = (sy * width + sx) * 4
  const r0 = data[s]
  const g0 = data[s + 1]
  const b0 = data[s + 2]
  const a0 = data[s + 3]
  const tol = Math.max(0, Math.min(255, tolerance))
  const match = (i: number): boolean => {
    const p = i * 4
    return Math.abs(data[p] - r0) <= tol && Math.abs(data[p + 1] - g0) <= tol && Math.abs(data[p + 2] - b0) <= tol && Math.abs(data[p + 3] - a0) <= tol
  }
  if (!contiguous) {
    for (let i = 0; i < width * height; i++) if (match(i)) mask[i] = 255
    return mask
  }
  // Scanline flood fill (4-connected).
  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    let x = stack.pop()!
    const row = y * width
    while (x > 0 && !mask[row + x - 1] && match(row + x - 1)) x--
    let up = false
    let down = false
    for (; x < width && !mask[row + x] && match(row + x); x++) {
      mask[row + x] = 255
      if (y > 0) {
        const m = !mask[row - width + x] && match(row - width + x)
        if (m && !up) stack.push(x, y - 1)
        up = m
      }
      if (y < height - 1) {
        const m = !mask[row + width + x] && match(row + width + x)
        if (m && !down) stack.push(x, y + 1)
        down = m
      }
    }
  }
  return mask
}

/** Bounding box of non-zero mask pixels, or null. */
export function maskBounds(mask: Uint8Array | Uint8ClampedArray, width: number, height: number, stride = 1, channel = 0): { x: number; y: number; w: number; h: number } | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (mask[(row + x) * stride + channel]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
