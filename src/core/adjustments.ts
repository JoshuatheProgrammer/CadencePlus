/**
 * Colour adjustments shared by adjustment layers (non-destructive) and the
 * Image → Adjustments commands (destructive). Each maps onto standard
 * Filter Effects functions, evaluated by the GPU in 8-bit sRGB, so preview,
 * apply and export all produce the same pixels.
 */

import { combine, curveTable, IDENTITY_CURVE, isIdentityLut, levelsTable, type Channel } from './lut'

export type AdjustmentKind = 'brightnessContrast' | 'hueSaturation' | 'blackWhite' | 'invert' | 'sepia' | 'levels' | 'curves'

export interface Adjustment {
  kind: AdjustmentKind
  params: Record<string, number>
  /** Curves only: control points per channel, flat [x0, y0, x1, y1, …] in 0–255. */
  curves?: Partial<Record<Channel, number[]>>
}

export interface ParamDef {
  id: string
  label: string
  min: number
  max: number
  default: number
  unit?: string
  step?: number
}

export const ADJUSTMENTS: Record<AdjustmentKind, { label: string; params: ParamDef[] }> = {
  brightnessContrast: {
    label: 'Brightness/Contrast',
    params: [
      { id: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
      { id: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 }
    ]
  },
  hueSaturation: {
    label: 'Hue/Saturation',
    params: [
      { id: 'hue', label: 'Hue', min: -180, max: 180, default: 0, unit: '°' },
      { id: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 }
    ]
  },
  blackWhite: { label: 'Black & White', params: [{ id: 'amount', label: 'Amount', min: 0, max: 100, default: 100, unit: '%' }] },
  invert: { label: 'Invert', params: [] },
  sepia: { label: 'Sepia Tone', params: [{ id: 'amount', label: 'Amount', min: 0, max: 100, default: 100, unit: '%' }] },
  levels: {
    label: 'Levels',
    params: [
      { id: 'inBlack', label: 'Input black', min: 0, max: 253, default: 0 },
      { id: 'gamma', label: 'Midtones', min: 0.1, max: 9.99, default: 1, step: 0.01 },
      { id: 'inWhite', label: 'Input white', min: 2, max: 255, default: 255 },
      { id: 'outBlack', label: 'Output black', min: 0, max: 255, default: 0 },
      { id: 'outWhite', label: 'Output white', min: 0, max: 255, default: 255 }
    ]
  },
  curves: { label: 'Curves', params: [] }
}

export const ADJUSTMENT_KINDS = Object.keys(ADJUSTMENTS) as AdjustmentKind[]

export function defaultAdjustment(kind: AdjustmentKind): Adjustment {
  const a: Adjustment = { kind, params: Object.fromEntries(ADJUSTMENTS[kind].params.map((p) => [p.id, p.default])) }
  if (kind === 'curves') a.curves = { rgb: [...IDENTITY_CURVE] }
  return a
}

const IDENTITY_TABLE = Uint8Array.from({ length: 256 }, (_, i) => i)

/** Lookup table for tone adjustments (Levels, Curves); null for filter-based kinds. */
export function adjustmentLut(a: Adjustment): Uint8Array | null {
  if (a.kind === 'levels') {
    const p = (id: string, d: number) => a.params[id] ?? d
    const t = levelsTable({ inBlack: p('inBlack', 0), inWhite: p('inWhite', 255), gamma: p('gamma', 1), outBlack: p('outBlack', 0), outWhite: p('outWhite', 255) })
    return combine(t, IDENTITY_TABLE, IDENTITY_TABLE, IDENTITY_TABLE)
  }
  if (a.kind === 'curves') {
    const c = a.curves ?? {}
    const t = (ch: Channel) => (c[ch] ? curveTable(c[ch]!) : IDENTITY_TABLE)
    return combine(t('rgb'), t('r'), t('g'), t('b'))
  }
  return null
}

/** A pixel operation: a Canvas filter string, or a 256 × RGBA lookup table. */
export type PixelOp = string | Uint8Array

/** What an adjustment does to pixels, or null when it currently has no effect. */
export function adjustmentOp(a: Adjustment): PixelOp | null {
  const lut = adjustmentLut(a)
  if (lut) return isIdentityLut(lut) ? null : lut
  const f = adjustmentFilter(a)
  return f === 'none' ? null : f
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000)

/** CSS/Canvas filter string for an adjustment ('none' when it has no effect). */
export function adjustmentFilter(a: Adjustment): string {
  const p = (id: string) => a.params[id] ?? ADJUSTMENTS[a.kind].params.find((d) => d.id === id)?.default ?? 0
  const parts: string[] = []
  switch (a.kind) {
    case 'brightnessContrast':
      if (p('brightness')) parts.push(`brightness(${fmt(1 + p('brightness') / 100)})`)
      if (p('contrast')) parts.push(`contrast(${fmt(1 + p('contrast') / 100)})`)
      break
    case 'hueSaturation':
      if (p('hue')) parts.push(`hue-rotate(${fmt(p('hue'))}deg)`)
      if (p('saturation')) parts.push(`saturate(${fmt(1 + p('saturation') / 100)})`)
      break
    case 'blackWhite':
      if (p('amount')) parts.push(`grayscale(${fmt(p('amount') / 100)})`)
      break
    case 'invert':
      parts.push('invert(1)')
      break
    case 'sepia':
      if (p('amount')) parts.push(`sepia(${fmt(p('amount') / 100)})`)
      break
  }
  return parts.length ? parts.join(' ') : 'none'
}

/** Gaussian blur filter. Canvas blur() takes the standard deviation in pixels. */
export function blurFilter(radius: number): string {
  return radius > 0 ? `blur(${fmt(radius)}px)` : 'none'
}

/** Scales the length arguments of a filter (blur) for rendering at `scale`. */
export function scaleFilter(filter: string, scale: number): string {
  if (scale === 1) return filter
  return filter.replace(/blur\(([\d.]+)px\)/g, (_m, v: string) => `blur(${fmt(Number(v) * scale)}px)`)
}
