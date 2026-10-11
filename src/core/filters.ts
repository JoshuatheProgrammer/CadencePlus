/**
 * Shader filters as plain data (they run on the GPU in engine/shaders.ts):
 * Unsharp Mask, High Pass, Add Noise, Motion Blur, and the per-pixel
 * kernels behind the Dodge, Burn and Sponge tools.
 */
import type { ShaderOp } from './adjustments'

/** The dialog-driven filters (Filter menu). */
export type FilterKind = 'unsharp' | 'highPass' | 'noise' | 'motionBlur'

/** Unsharp Mask: `amount` %, `radius` px (blur σ), `threshold` levels (0..255). */
export const unsharpOp = (amount: number, radius: number, threshold: number): ShaderOp => ({ shader: 'unsharp', params: { amount: amount / 100, radius, threshold: threshold / 255 } })

/** High Pass: keeps detail finer than `radius` px on a 50% grey base. */
export const highPassOp = (radius: number): ShaderOp => ({ shader: 'highPass', params: { radius } })

/** Add Noise: `amount` %; uniform or Gaussian; monochromatic adds the same value to R, G and B. */
export const noiseOp = (amount: number, gaussian: boolean, mono: boolean, seed: number): ShaderOp => ({
  shader: 'noise',
  params: { amount: amount / 100, gaussian: gaussian ? 1 : 0, mono: mono ? 1 : 0, seed }
})

/** Motion Blur: `angle` degrees (counter-clockwise from horizontal), `distance` px. */
export const motionBlurOp = (angle: number, distance: number): ShaderOp => ({ shader: 'motionBlur', params: { angle, dist: distance } })

export type ToneRange = 'shadows' | 'midtones' | 'highlights'
export const TONE_RANGES: ToneRange[] = ['shadows', 'midtones', 'highlights']

/** Dodge (lighten) or Burn (darken) a tonal range by `exposure` % at full coverage. */
export const toneOp = (burn: boolean, range: ToneRange, exposure: number): ShaderOp => ({
  shader: burn ? 'burn' : 'dodge',
  params: { range: TONE_RANGES.indexOf(range), exposure: exposure / 100 }
})

/** Sponge: saturate or desaturate by `flow` % at full coverage. */
export const spongeOp = (desaturate: boolean, flow: number): ShaderOp => ({ shader: 'sponge', params: { amount: (desaturate ? -1 : 1) * (flow / 100) } })

/** Lengths (px) in a shader op, scaled for rendering at a zoom level. */
export function scaleShaderOp(op: ShaderOp, scale: number): ShaderOp {
  if (scale === 1) return op
  const p = { ...op.params }
  for (const k of ['radius', 'dist'] as const) if (k in p) p[k] *= scale
  return { ...op, params: p }
}
