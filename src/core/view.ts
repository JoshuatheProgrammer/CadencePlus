/**
 * Viewport maths: zoom levels, fitting, and screen ↔ document mapping.
 * A view is the zoom factor plus the document point at the viewport centre.
 */

export interface View {
  zoom: number
  /** Document coordinates shown at the centre of the viewport. */
  cx: number
  cy: number
}

export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 64

/** The stops used by Zoom In / Zoom Out, like Photoshop's. */
export const ZOOM_STEPS = [
  0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 48, 64
]

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function nextZoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z * 0.999) return ZOOM_STEPS[i]
  return MIN_ZOOM
}

/** Largest zoom that shows the whole document with a margin (never above 100%). */
export function fitView(docW: number, docH: number, viewW: number, viewH: number, margin = 24): View {
  const z = Math.min((viewW - margin * 2) / docW, (viewH - margin * 2) / docH, 1)
  return { zoom: clampZoom(z > 0 ? z : MIN_ZOOM), cx: docW / 2, cy: docH / 2 }
}

/** Zoom that fills the viewport in both directions (may crop). */
export function fillView(docW: number, docH: number, viewW: number, viewH: number): View {
  return { zoom: clampZoom(Math.max(viewW / docW, viewH / docH)), cx: docW / 2, cy: docH / 2 }
}

export function docToScreen(v: View, viewW: number, viewH: number, x: number, y: number): { x: number; y: number } {
  return { x: (x - v.cx) * v.zoom + viewW / 2, y: (y - v.cy) * v.zoom + viewH / 2 }
}

export function screenToDoc(v: View, viewW: number, viewH: number, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - viewW / 2) / v.zoom + v.cx, y: (sy - viewH / 2) / v.zoom + v.cy }
}

/** New view at `zoom` that keeps the document point under (sx, sy) still. */
export function zoomAt(v: View, viewW: number, viewH: number, zoom: number, sx: number, sy: number): View {
  const z = clampZoom(zoom)
  const p = screenToDoc(v, viewW, viewH, sx, sy)
  return { zoom: z, cx: p.x - (sx - viewW / 2) / z, cy: p.y - (sy - viewH / 2) / z }
}

/** Pans by a screen-space delta. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx / v.zoom, cy: v.cy - dy / v.zoom }
}

/** "66.7%", "100%", "1600%". */
export function formatZoom(z: number): string {
  const p = z * 100
  return `${p >= 100 || Number.isInteger(p) ? Math.round(p) : p.toFixed(p < 10 ? 2 : 1)}%`
}
