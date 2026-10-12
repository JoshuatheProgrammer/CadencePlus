/**
 * Drawing type and shape layers. Text is laid out with the 2D canvas's own
 * metrics (so on-screen, thumbnail and export layouts match), cached per
 * immutable text object.
 */
import { paramsToMatrix, transformedBounds, type Affine } from '@core/affine'
import type { Rect, VectorContent } from '@core/model'
import type { ShapeData, TextData, TextStyle } from '@core/vector'
import type { Ctx2D } from './tiles'

export function fontString(s: TextStyle): string {
  const fam = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(s.font) ? s.font : `"${s.font.replace(/"/g, '')}"`
  return `${s.italic ? 'italic ' : ''}${s.weight} ${Math.max(1, s.size)}px ${fam}, sans-serif`
}

export interface TextLayout {
  lines: { text: string; x: number; width: number }[]
  w: number
  h: number
  /** Baseline offset of the first line from the box top. */
  ascent: number
  lineHeight: number
}

const measure = new OffscreenCanvas(1, 1).getContext('2d')!
const layouts = new WeakMap<TextData, TextLayout>()

export function layoutText(t: TextData): TextLayout {
  const hit = layouts.get(t)
  if (hit) return hit
  measure.font = fontString(t)
  measure.letterSpacing = `${t.tracking}px`
  const raw = t.text.split(/\r?\n/)
  const widths = raw.map((line) => (line ? measure.measureText(line).width : 0))
  const m = measure.measureText('Hg')
  const ascent = m.fontBoundingBoxAscent || t.size * 0.8
  const descent = m.fontBoundingBoxDescent || t.size * 0.2
  const lineHeight = Math.max(1, t.size * t.leading)
  const w = Math.max(1, Math.ceil(Math.max(0, ...widths)))
  // Box height: full line pitch between lines, font height on the last.
  const h = Math.max(1, Math.ceil((raw.length - 1) * lineHeight + ascent + descent))
  const lines = raw.map((text, i) => ({ text, width: widths[i], x: t.align === 'left' ? 0 : t.align === 'center' ? (w - widths[i]) / 2 : w - widths[i] }))
  const out = { lines, w, h, ascent, lineHeight }
  layouts.set(t, out)
  return out
}

/** Local box size of a vector layer. */
export function vectorSize(c: VectorContent): { w: number; h: number } {
  if (c.type === 'text') {
    const l = layoutText(c.text)
    return { w: l.w, h: l.h }
  }
  return { w: Math.max(1, c.shape.w), h: Math.max(1, c.shape.h) }
}

/** Matrix mapping the layer's local box to document pixels. */
export function vectorMatrix(c: VectorContent): Affine {
  const s = vectorSize(c)
  return paramsToMatrix(c.params, s.w, s.h)
}

/** Document bounds of a vector layer (including stroke). */
export function vectorBounds(c: VectorContent): Rect {
  const s = vectorSize(c)
  const pad = c.type === 'shape' && c.shape.stroke ? Math.ceil(c.shape.strokeWidth / 2) + 1 : 2
  const m = paramsToMatrix(c.params, s.w, s.h)
  const b = transformedBounds(m, s.w, s.h)
  const k = Math.ceil(pad * Math.max(Math.abs(c.params.sx), Math.abs(c.params.sy)))
  return { x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k }
}

function shapePath(s: ShapeData): Path2D {
  const p = new Path2D()
  const w = Math.max(1, s.w)
  const h = Math.max(1, s.h)
  if (s.kind === 'rect') {
    const r = Math.max(0, Math.min(s.radius, w / 2, h / 2))
    if (r > 0) p.roundRect(0, 0, w, h, r)
    else p.rect(0, 0, w, h)
  } else if (s.kind === 'ellipse') p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (s.kind === 'line') {
    p.moveTo(0, h / 2)
    p.lineTo(w, h / 2)
  } else {
    const n = Math.max(3, Math.round(s.sides))
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
      const x = w / 2 + (Math.cos(a) * w) / 2
      const y = h / 2 + (Math.sin(a) * h) / 2
      if (i) p.lineTo(x, y)
      else p.moveTo(x, y)
    }
    p.closePath()
  }
  return p
}

/**
 * Draws a vector layer into `ctx`, where `toTarget` maps document pixels to
 * target pixels (e.g. the viewport's scale + offset).
 */
export function drawVector(ctx: Ctx2D, c: VectorContent, toTarget: Affine, params = c.params): void {
  const s = vectorSize(c)
  const m = paramsToMatrix(params, s.w, s.h)
  const t = toTarget
  ctx.save()
  // target ← document ← local
  ctx.setTransform(t.a * m.a + t.c * m.b, t.b * m.a + t.d * m.b, t.a * m.c + t.c * m.d, t.b * m.c + t.d * m.d, t.a * m.e + t.c * m.f + t.e, t.b * m.e + t.d * m.f + t.f)
  if (c.type === 'text') {
    const L = layoutText(c.text)
    ctx.font = fontString(c.text)
    ctx.letterSpacing = `${c.text.tracking}px`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = c.text.color
    L.lines.forEach((line, i) => line.text && ctx.fillText(line.text, line.x, L.ascent + i * L.lineHeight))
  } else {
    const sh = c.shape
    const p = shapePath(sh)
    if (sh.fill && sh.kind !== 'line') {
      ctx.fillStyle = sh.fill
      ctx.fill(p)
    }
    if (sh.stroke && sh.strokeWidth > 0) {
      ctx.strokeStyle = sh.stroke
      ctx.lineWidth = sh.strokeWidth
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke(p)
    }
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const CANDIDATES = [
  'Segoe UI', 'Segoe UI Variable Display', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free',
  'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'MV Boli', 'Palatino Linotype', 'Segoe Print', 'Segoe Script',
  'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Helvetica', 'Roboto', 'Inter', 'Open Sans'
]

let available: string[] | null = null

/** Installed fonts from a curated list (detected by comparing glyph widths against fallbacks). */
export function availableFonts(): string[] {
  if (available) return available
  const probe = 'mmmmmmmmmmlliWW@#0123456789'
  const base = ['monospace', 'serif', 'sans-serif'].map((f) => {
    measure.font = `72px ${f}`
    return measure.measureText(probe).width
  })
  available = CANDIDATES.filter((name) =>
    ['monospace', 'serif', 'sans-serif'].some((f, i) => {
      measure.font = `72px "${name}", ${f}`
      return measure.measureText(probe).width !== base[i]
    })
  )
  return (available = [...available, 'serif', 'sans-serif', 'monospace'])
}
