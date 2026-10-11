/**
 * Layer styles (non-destructive effects drawn around or over a layer's
 * pixels): Drop Shadow, Outer Glow, Stroke, Inner Glow, Color Overlay.
 * Sizes and distances are in document pixels.
 */
import type { BlendMode, Layer } from './model'

export interface DropShadow {
  enabled: boolean
  color: string
  /** 0..1 */
  opacity: number
  blend: BlendMode
  /** Light angle in degrees (Photoshop convention: 120° casts down and to the right). */
  angle: number
  distance: number
  /** Blur size. */
  size: number
}

export interface Glow {
  enabled: boolean
  color: string
  opacity: number
  blend: BlendMode
  size: number
}

export interface StrokeEffect {
  enabled: boolean
  color: string
  opacity: number
  size: number
  position: 'outside' | 'inside' | 'center'
}

export interface ColorOverlay {
  enabled: boolean
  color: string
  opacity: number
}

export interface LayerEffects {
  dropShadow?: DropShadow
  outerGlow?: Glow
  stroke?: StrokeEffect
  innerGlow?: Glow
  colorOverlay?: ColorOverlay
}

export type EffectKind = keyof LayerEffects

/** Dialog order. */
export const EFFECT_KINDS: EffectKind[] = ['dropShadow', 'outerGlow', 'stroke', 'innerGlow', 'colorOverlay']

export const EFFECT_LABELS: Record<EffectKind, string> = {
  dropShadow: 'Drop Shadow',
  outerGlow: 'Outer Glow',
  stroke: 'Stroke',
  innerGlow: 'Inner Glow',
  colorOverlay: 'Color Overlay'
}

export const DEFAULT_EFFECTS: Required<LayerEffects> = {
  dropShadow: { enabled: true, color: '#000000', opacity: 0.75, blend: 'multiply', angle: 120, distance: 8, size: 10 },
  outerGlow: { enabled: true, color: '#ffffbe', opacity: 0.75, blend: 'screen', size: 12 },
  stroke: { enabled: true, color: '#000000', opacity: 1, size: 3, position: 'outside' },
  innerGlow: { enabled: true, color: '#ffffbe', opacity: 0.75, blend: 'screen', size: 10 },
  colorOverlay: { enabled: true, color: '#e02424', opacity: 1 }
}

/** Layers that can carry styles: pixels, type and shapes. */
export const canHaveEffects = (l: Layer): boolean => l.content.type === 'raster' || l.content.type === 'text' || l.content.type === 'shape'

/** True when any effect is switched on. */
export function hasActiveEffects(fx: LayerEffects | undefined): boolean {
  return !!fx && EFFECT_KINDS.some((k) => fx[k]?.enabled)
}

/** Shadow offset in document pixels for a light angle and distance. */
export function shadowOffset(angle: number, distance: number): { dx: number; dy: number } {
  const a = (angle * Math.PI) / 180
  return { dx: -Math.cos(a) * distance, dy: Math.sin(a) * distance }
}

/** How far effects reach beyond the layer's pixels (for bounds). */
export function effectsMargin(fx: LayerEffects | undefined): number {
  if (!fx) return 0
  let m = 0
  if (fx.dropShadow?.enabled) m = Math.max(m, fx.dropShadow.distance + fx.dropShadow.size * 1.5)
  if (fx.outerGlow?.enabled) m = Math.max(m, fx.outerGlow.size * 1.5)
  if (fx.stroke?.enabled && fx.stroke.position !== 'inside') m = Math.max(m, fx.stroke.size)
  return Math.ceil(m)
}
