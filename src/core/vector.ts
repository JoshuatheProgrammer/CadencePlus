/**
 * Vector layer data: type and shapes. Each is drawn in its own local box
 * (0..w, 0..h) and placed by TransformParams (centre, scale, rotation), so
 * moving, scaling and rotating never resamples anything.
 */
import type { TransformParams } from './affine'

export interface TextStyle {
  font: string
  /** Pixels */
  size: number
  /** 100–900 */
  weight: number
  italic: boolean
  color: string
  align: 'left' | 'center' | 'right'
  /** Line height as a multiple of the size. */
  leading: number
  /** Extra space between letters, pixels. */
  tracking: number
}

export interface TextData extends TextStyle {
  text: string
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'polygon'

export interface ShapeData {
  kind: ShapeKind
  /** Local box size. A line runs along the box's horizontal centre. */
  w: number
  h: number
  fill: string | null
  stroke: string | null
  strokeWidth: number
  /** Rectangle corner radius. */
  radius: number
  /** Polygon side count. */
  sides: number
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Segoe UI',
  size: 48,
  weight: 400,
  italic: false,
  color: '#000000',
  align: 'left',
  leading: 1.2,
  tracking: 0
}

/** Moves the params' centre so the box's top-left corner stays where it was when the size changes. */
export function keepTopLeft(p: TransformParams, oldW: number, oldH: number, newW: number, newH: number): TransformParams {
  const cos = Math.cos(p.rot)
  const sin = Math.sin(p.rot)
  const dx = ((newW - oldW) / 2) * p.sx
  const dy = ((newH - oldH) / 2) * p.sy
  return { ...p, cx: p.cx + dx * cos - dy * sin, cy: p.cy + dx * sin + dy * cos }
}

/** Remaps a vector layer's placement through a whole-document change (crop, resize, rotate, flip). */
export type PointMap = (x: number, y: number) => { x: number; y: number }

export function mapParams(p: TransformParams, map: PointMap, opts: { scaleX?: number; scaleY?: number; rotate?: number; flipX?: boolean; flipY?: boolean } = {}): TransformParams {
  const c = map(p.cx, p.cy)
  let { sx, sy, rot } = p
  sx *= opts.scaleX ?? 1
  sy *= opts.scaleY ?? 1
  if (opts.flipX) {
    sx = -sx
    rot = -rot
  }
  if (opts.flipY) {
    sy = -sy
    rot = -rot
  }
  rot += opts.rotate ?? 0
  return { cx: c.x, cy: c.y, sx, sy, rot }
}
