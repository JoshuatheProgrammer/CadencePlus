/**
 * Draws a layer with its styles. Shadow and outer glow composite beneath
 * the layer with their own blend modes; stroke, inner glow and colour
 * overlay are applied to the layer's pixels, which then composite with the
 * layer's blend mode. Everything works at the render target's scale.
 *
 * Stroke widths come from blur + threshold (a GPU pass): exact on straight
 * edges, slightly rounded at sharp corners.
 */
import { shadowOffset, type LayerEffects } from '@core/effects'
import type { BlendMode, Layer } from '@core/model'
import { ctx2d } from './format'
import { drawShaderOp } from './shaders'
import { poolCanvas, type Ctx2D } from './tiles'

const blendToComposite = (b: BlendMode): GlobalCompositeOperation => (b === 'normal' || b === 'pass-through' ? 'source-over' : (b as GlobalCompositeOperation))

/** Gaussian σ whose 2% contour sits `d` pixels outside a straight edge. */
const sigmaFor = (d: number) => Math.max(0.3, d / 2.05)

/** `src`'s alpha, blurred by σ, as an opaque colour layer. */
function blurredAlpha(src: OffscreenCanvas, key: string, sigma: number, color: string, dx = 0, dy = 0, invert = false): OffscreenCanvas {
  const W = src.width
  const H = src.height
  const c = poolCanvas(key, W, H)
  const g = ctx2d(c)
  g.save()
  g.clearRect(0, 0, W, H)
  if (invert) {
    // Inverted alpha: opaque everywhere except the layer.
    const inv = poolCanvas(`${key}.inv`, W, H)
    const ig = ctx2d(inv)
    ig.globalCompositeOperation = 'source-over'
    ig.fillStyle = '#000'
    ig.fillRect(0, 0, W, H)
    ig.globalCompositeOperation = 'destination-out'
    ig.drawImage(src, 0, 0)
    ig.globalCompositeOperation = 'source-over'
    src = inv
  }
  if (sigma > 0.05) g.filter = `blur(${sigma}px)`
  g.drawImage(src, dx, dy)
  g.filter = 'none'
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, W, H)
  g.restore()
  return c
}

/** Alpha grown by `d` pixels (d > 0), as white. */
function grown(src: OffscreenCanvas, key: string, d: number): OffscreenCanvas {
  const b = blurredAlpha(src, `${key}.blur`, sigmaFor(d), '#fff')
  const c = poolCanvas(key, src.width, src.height)
  const g = ctx2d(c)
  g.clearRect(0, 0, c.width, c.height)
  drawShaderOp(g, b, { shader: 'alphaThreshold', params: { lo: 0.012, hi: 0.03 } })
  return c
}

/** The layer's alpha shrunk by `d` pixels, as white. */
function shrunk(src: OffscreenCanvas, key: string, d: number): OffscreenCanvas {
  const W = src.width
  const H = src.height
  const inv = poolCanvas(`${key}.inv`, W, H)
  const ig = ctx2d(inv)
  ig.globalCompositeOperation = 'source-over'
  ig.fillStyle = '#fff'
  ig.fillRect(0, 0, W, H)
  ig.globalCompositeOperation = 'destination-out'
  ig.drawImage(src, 0, 0)
  ig.globalCompositeOperation = 'source-over'
  const gInv = grown(inv, `${key}.grow`, d)
  const c = poolCanvas(key, W, H)
  const g = ctx2d(c)
  g.clearRect(0, 0, W, H)
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(gInv, 0, 0)
  g.globalCompositeOperation = 'source-over'
  return c
}

function strokeRing(src: OffscreenCanvas, fx: NonNullable<LayerEffects['stroke']>, scale: number): OffscreenCanvas {
  const s = fx.size * scale
  const W = src.width
  const H = src.height
  const ring = poolCanvas('fx.ring', W, H)
  const g = ctx2d(ring)
  g.save()
  g.clearRect(0, 0, W, H)
  if (fx.position === 'outside') {
    g.drawImage(grown(src, 'fx.out', s), 0, 0)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(src, 0, 0)
  } else if (fx.position === 'inside') {
    g.drawImage(src, 0, 0)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(shrunk(src, 'fx.in', s), 0, 0)
  } else {
    g.drawImage(grown(src, 'fx.out', s / 2), 0, 0)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(shrunk(src, 'fx.in', s / 2), 0, 0)
  }
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = fx.color
  g.fillRect(0, 0, W, H)
  g.restore()
  return ring
}

/**
 * Composites `content` (the layer at target scale, mask applied) and its
 * effects into `ctx` with the layer's opacity and blend.
 */
export function drawWithEffects(ctx: Ctx2D, content: OffscreenCanvas, l: Layer, fx: LayerEffects, scale: number, layerOp: GlobalCompositeOperation): void {
  const W = content.width
  const H = content.height
  // Beneath: drop shadow, outer glow.
  const under = (c: OffscreenCanvas, opacity: number, blend: Layer['blend']) => {
    ctx.save()
    ctx.globalAlpha = l.opacity * opacity
    ctx.globalCompositeOperation = blendToComposite(blend)
    ctx.drawImage(c, 0, 0)
    ctx.restore()
  }
  if (fx.dropShadow?.enabled) {
    const d = fx.dropShadow
    const { dx, dy } = shadowOffset(d.angle, d.distance * scale)
    under(blurredAlpha(content, 'fx.shadow', (d.size * scale) / 2, d.color, dx, dy), d.opacity, d.blend)
  }
  if (fx.outerGlow?.enabled) {
    const o = fx.outerGlow
    under(blurredAlpha(content, 'fx.glow', (o.size * scale) / 2, o.color), o.opacity, o.blend)
  }
  // On the pixels: colour overlay, inner glow, stroke.
  const cc = poolCanvas('fx.content', W, H)
  const g = ctx2d(cc)
  g.save()
  g.clearRect(0, 0, W, H)
  g.drawImage(content, 0, 0)
  if (fx.colorOverlay?.enabled) {
    g.globalAlpha = fx.colorOverlay.opacity
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = fx.colorOverlay.color
    g.fillRect(0, 0, W, H)
    g.globalAlpha = 1
  }
  if (fx.innerGlow?.enabled) {
    const ig = fx.innerGlow
    const glow = blurredAlpha(content, 'fx.iglow', (ig.size * scale) / 2, ig.color, 0, 0, true)
    const gg = ctx2d(glow)
    gg.globalCompositeOperation = 'destination-in'
    gg.drawImage(content, 0, 0)
    gg.globalCompositeOperation = 'source-over'
    g.globalAlpha = ig.opacity
    g.globalCompositeOperation = blendToComposite(ig.blend)
    g.drawImage(glow, 0, 0)
    g.globalAlpha = 1
  }
  if (fx.stroke?.enabled && fx.stroke.size > 0) {
    g.globalAlpha = fx.stroke.opacity
    g.globalCompositeOperation = 'source-over'
    g.drawImage(strokeRing(content, fx.stroke, scale), 0, 0)
  }
  g.restore()
  ctx.save()
  ctx.globalAlpha = l.opacity
  ctx.globalCompositeOperation = layerOp
  ctx.drawImage(cc, 0, 0)
  ctx.restore()
}
