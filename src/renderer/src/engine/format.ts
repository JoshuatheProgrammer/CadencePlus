/**
 * The pixel format of the working pipeline: bit depth (8-bit unorm or
 * 16-bit float) and colour space (sRGB or Display P3). Every canvas that
 * holds image pixels gets its 2D context through here, so a 16-bit P3
 * document keeps its precision and gamut through tiles, compositing,
 * filters and export. Chromium colour-manages drawImage between spaces.
 *
 * The active document sets the format (see state/format-sync.ts); code that
 * works on another document (saving, autosave, import) passes its format
 * explicitly or wraps the work in withFormat().
 */

export type ColorSpaceId = 'srgb' | 'display-p3'

export interface PixelFormat {
  depth: 8 | 16
  space: ColorSpaceId
}

export const SRGB8: PixelFormat = { depth: 8, space: 'srgb' }

let current: PixelFormat = SRGB8

export function pipelineFormat(): PixelFormat {
  return current
}

export function setPipelineFormat(f: PixelFormat): void {
  current = f
}

/** Runs `fn` (synchronously) with `f` as the pipeline format. */
export function withFormat<T>(f: PixelFormat, fn: () => T): T {
  const prev = current
  current = f
  try {
    return fn()
  } finally {
    current = prev
  }
}

export const formatKey = (f: PixelFormat = current): string => `${f.depth}-${f.space}`

export function contextSettings(f: PixelFormat = current, extra: CanvasRenderingContext2DSettings = {}): CanvasRenderingContext2DSettings {
  return { colorSpace: f.space, colorType: f.depth === 16 ? 'float16' : 'unorm8', ...extra } as CanvasRenderingContext2DSettings
}

/**
 * The 2D context of a pixel canvas in the pipeline format. A canvas keeps
 * the settings of its first context, so create pixel canvases per format.
 */
export function ctx2d(c: OffscreenCanvas, extra?: CanvasRenderingContext2DSettings, f: PixelFormat = current): OffscreenCanvasRenderingContext2D {
  return c.getContext('2d', contextSettings(f, extra)) as OffscreenCanvasRenderingContext2D
}

/** A new pixel canvas whose context is created in format `f`. */
export function pixelCanvas(w: number, h: number, f: PixelFormat = current): OffscreenCanvas {
  const c = new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)))
  ctx2d(c, undefined, f)
  return c
}

/** A lazily created value per pipeline format (scratch canvases). */
export function perFormat<T>(make: () => T): () => T {
  const m = new Map<string, T>()
  return () => {
    const k = formatKey()
    let v = m.get(k)
    if (!v) m.set(k, (v = make()))
    return v
  }
}

export const formatLabel = (f: PixelFormat): string => `RGB/${f.depth} · ${f.space === 'srgb' ? 'sRGB' : 'Display P3'}`
