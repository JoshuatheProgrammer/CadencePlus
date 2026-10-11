/**
 * Select → Color Range: how selected each pixel is (0..1) for a sampled
 * colour with fuzziness, a hue family, or a tonal range.
 */

export type RangeKind = 'sampled' | 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'highlights' | 'midtones' | 'shadows'

export const RANGE_LABELS: Record<RangeKind, string> = {
  sampled: 'Sampled Colors',
  reds: 'Reds',
  yellows: 'Yellows',
  greens: 'Greens',
  cyans: 'Cyans',
  blues: 'Blues',
  magentas: 'Magentas',
  highlights: 'Highlights',
  midtones: 'Midtones',
  shadows: 'Shadows'
}

export interface RangeSpec {
  kind: RangeKind
  /** Sampled colour, 0..255. */
  color: [number, number, number]
  /** 0..200: how far (in RGB levels) from the sampled colour selection fades out. */
  fuzziness: number
}

const HUE_CENTRE: Partial<Record<RangeKind, number>> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 }

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Builds a per-pixel function for a spec (8-bit RGB in, 0..1 out). */
export function rangeFunction(spec: RangeSpec): (r: number, g: number, b: number) => number {
  if (spec.kind === 'sampled') {
    const [sr, sg, sb] = spec.color
    const f = Math.max(1, spec.fuzziness)
    return (r, g, b) => {
      const d = Math.sqrt(((r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2) / 3)
      return Math.max(0, 1 - d / f)
    }
  }
  const centre = HUE_CENTRE[spec.kind]
  if (centre !== undefined) {
    // Full inside ±30° of the family's hue, fading out by ±60°; greys are never selected.
    return (r, g, b) => {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const c = max - min
      if (c === 0) return 0
      let h: number
      if (max === r) h = ((g - b) / c) % 6
      else if (max === g) h = (b - r) / c + 2
      else h = (r - g) / c + 4
      h = (h * 60 + 360) % 360
      const dh = Math.min(Math.abs(h - centre), 360 - Math.abs(h - centre))
      const sat = c / 255
      return (1 - smooth(30, 60, dh)) * smooth(0.04, 0.2, sat)
    }
  }
  return (r, g, b) => {
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    if (spec.kind === 'shadows') return 1 - smooth(0.25, 0.42, l)
    if (spec.kind === 'highlights') return smooth(0.58, 0.75, l)
    return smooth(0.2, 0.4, l) * (1 - smooth(0.6, 0.8, l))
  }
}
