/**
 * Cadence+ icon set — 16px, 1.25px stroke icons drawn for this app, in the
 * same style as Cadence's set (shared glyphs keep their Cadence names).
 */
import type { CSSProperties, ReactElement } from 'react'

type P = { size?: number; style?: CSSProperties; title?: string }

function I(paths: ReactElement, fill = false) {
  return function Icon({ size = 16, style, title }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
        aria-hidden={title ? undefined : true}
      >
        {title && <title>{title}</title>}
        {paths}
      </svg>
    )
  }
}

// ---- Tools ----
export const IconMove = I(<path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />)
export const IconMarquee = I(<rect x="2.5" y="3.5" width="11" height="9" strokeDasharray="2 1.7" />)
export const IconLasso = I(
  <>
    <path d="M8 2.5c3.4 0 6 1.6 6 3.6S11.4 9.7 8 9.7 2 8.1 2 6.1 4.6 2.5 8 2.5z" />
    <path d="M4.6 9.2c-.8.9-.6 2 .4 2.5s1.4 1.6.9 2.8" />
  </>
)
export const IconWand = I(<path d="M2.5 13.5l7.5-7.5M9 5l2 2M12 1.5v2.5M10.75 2.75h2.5M14 6v1.5M13.25 6.75h1.5M6.5 2v1.5M5.75 2.75h1.5" />)
export const IconCrop = I(<path d="M4.5 1.5v10h10M1.5 4.5h10v10" />)
export const IconEyedropper = I(<path d="M10.2 2.3a1.6 1.6 0 012.3 0l1.2 1.2a1.6 1.6 0 010 2.3L12 7.5l.8.8-1.2 1.2-4.3-4.3 1.2-1.2.8.8zM8.6 6.1L3 11.7V13h1.3l5.6-5.6" />)
export const IconBrush = I(
  <>
    <path d="M14 2l-5.6 6.6-1.4-1.4L13.6 1.6z" />
    <path d="M6.5 8.3c-1.4 0-2.4 1-2.4 2.4 0 1-.7 1.8-1.6 2.1 1.6.9 4.6.8 5.4-.8.5-1.1.3-2.5-.6-3.1" />
  </>
)
export const IconStamp = I(<path d="M6.2 2.5h3.6v3.2L9 8H7l-.8-2.3zM2.5 8h11v2.5h-11zM4 13.5h8" />)
export const IconEraser = I(<path d="M9.5 2.3l4.2 4.2-6.8 6.8H4.1L2 11.2zM5.6 5.9l4.5 4.5M7.5 13.3h6.5" />)
export const IconGradient = I(
  <>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    <path d="M7 3.5v9M9.8 3.5v9M11.8 3.5v9" />
  </>
)
export const IconBucket = I(<path d="M7.5 2.5l5.2 5.2-5 5-5.2-5.2zM2.5 7.5h10.2M13.5 9.5s1.2 1.6 1.2 2.5a1.2 1.2 0 01-2.4 0c0-.9 1.2-2.5 1.2-2.5zM5.3 4.7L3.5 2.9" />)
export const IconText = I(<path d="M3 4.5V3h10v1.5M8 3v10M6 13h4" />)
export const IconPen = I(
  <>
    <path d="M8 1.5l4 6.3L9.6 12H6.4L4 7.8z" />
    <path d="M8 1.5v5" />
    <circle cx="8" cy="7.9" r="1.1" />
    <path d="M6 14.5h4" />
  </>
)
export const IconShape = I(
  <>
    <rect x="2" y="2" width="7.5" height="7.5" rx="0.6" />
    <path d="M11.5 7.3A3.6 3.6 0 117.3 11.5" />
  </>
)
export const IconHand = I(<path d="M5 8V4a1 1 0 012 0v3V3a1 1 0 012 0v4V4a1 1 0 012 0v5c0 2.5-1.8 4.5-4.5 4.5C4.5 13.5 3 11 2.5 9.5 2.2 8.6 3.4 8 4 8.8L5 10" />)
export const IconZoom = I(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4L14 14M5 7h4M7 5v4" />
  </>
)
export const IconZoomOut = I(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4L14 14M5 7h4" />
  </>
)

// ---- Colour chips ----
export const IconSwap = I(<path d="M4.5 3.5h5a2 2 0 012 2v5M9.5 8.5l2 2 2-2M6.5 1.5l-2 2 2 2" />)
export const IconDefaultColors = I(
  <>
    <rect x="2.5" y="2.5" width="6.5" height="6.5" fill="currentColor" />
    <rect x="7" y="7" width="6.5" height="6.5" />
  </>
)

// ---- Layers & documents ----
export const IconLayers = I(<path d="M8 2l6 3.2-6 3.2-6-3.2zM2 8l6 3.2L14 8M2 10.8L8 14l6-3.2" />)
export const IconNewLayer = I(
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M8 5.5v5M5.5 8h5" />
  </>
)
export const IconDuplicate = I(
  <>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1" />
    <path d="M11 5V3.5a1 1 0 00-1-1H3.5a1 1 0 00-1 1V10a1 1 0 001 1H5" />
  </>
)
/** Adjustment layer: a half-filled circle. */
export const IconFx = I(
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor" />
  </>
)
/** Free Transform: a box with corner handles. */
export const IconTransform = I(
  <>
    <rect x="3.5" y="3.5" width="9" height="9" strokeDasharray="2 1.5" />
    <rect x="1.5" y="1.5" width="3" height="3" fill="currentColor" />
    <rect x="11.5" y="1.5" width="3" height="3" fill="currentColor" />
    <rect x="1.5" y="11.5" width="3" height="3" fill="currentColor" />
    <rect x="11.5" y="11.5" width="3" height="3" fill="currentColor" />
  </>
)
/** Layer mask: a frame with a circle cut-out. */
export const IconMask = I(
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <circle cx="8" cy="8" r="2.6" />
  </>
)
/** Fill layer: a frame with a solid lower half. */
export const IconFillLayer = I(
  <>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M2.5 8.5h11v4a1 1 0 01-1 1h-9a1 1 0 01-1-1z" fill="currentColor" />
  </>
)
export const IconArrowUp = I(<path d="M8 13V3M4.5 6.5L8 3l3.5 3.5" />)
export const IconArrowDown = I(<path d="M8 3v10M4.5 9.5L8 13l3.5-3.5" />)
export const IconNewDoc = I(<path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M8 7.5v4M6 9.5h4" />)
export const IconFit = I(<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />)
export const IconFill = I(<path d="M2.5 2.5h11v11h-11zM5 5.5V5h.5M10.5 5h.5v.5M11 10.5v.5h-.5M5.5 11H5v-.5" />)
export const IconActual = I(
  <>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    <path d="M5.5 6.5L6.5 6v4M9.8 6.5l1-.5v4M8.2 7.3v.1M8.2 9.1v.1" />
  </>
)

// ---- Shared with Cadence ----
export const IconPlus = I(<path d="M8 3v10M3 8h10" />)
export const IconFolder = I(<path d="M2 4.5A1 1 0 013 3.5h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z" />)
export const IconTrash = I(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M7 7v4.5M9 7v4.5" />)
export const IconImage = I(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <circle cx="5.5" cy="6.5" r="1.2" />
    <path d="M2.5 12l4-4 3 3 2-2 2.5 2.5" />
  </>
)
export const IconLock = I(
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </>
)
export const IconUnlock = I(
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 014.9-.6" />
  </>
)
export const IconEye = I(
  <>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </>
)
export const IconEyeOff = I(<path d="M2 2l12 12M6.5 4C7 3.7 7.5 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5M9.5 12.2c-.5.2-1 .3-1.5.3C4 12.5 1.5 8 1.5 8s.9-1.6 2.5-3" />)
export const IconCheck = I(<path d="M3 8.5l3 3 7-7" />)
export const IconClose = I(<path d="M4 4l8 8M12 4l-8 8" />)
export const IconHistory = I(<path d="M2.5 8a5.5 5.5 0 101.6-3.9M2.5 2.5v3h3M8 5v3.5l2.5 1.5" />)
export const IconChevronRight = I(<path d="M6 3.5L10.5 8 6 12.5" />)
export const IconChevronDown = I(<path d="M3.5 6L8 10.5 12.5 6" />)

/**
 * The Cadence+ mark: Cadence's rounded-square frame with three stacked layers
 * in place of Cadence's three track bars (same 1 / 0.7 / 0.45 accent ramp).
 * Each layer is drawn over an opaque occluder so the translucency never mixes.
 */
export function Logo({ size = 18 }: { size?: number }) {
  const slab = (cy: number) => `M16 ${cy - 4.6}L25.2 ${cy}L16 ${cy + 4.6}L6.8 ${cy}Z`
  const layers: [number, number][] = [
    [21.4, 0.45],
    [16.2, 0.7],
    [11, 1]
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Cadence+">
      <rect x="1" y="1" width="30" height="30" rx="6" fill="var(--c-raised)" stroke="var(--c-border-strong)" strokeWidth="1" />
      {layers.map(([cy, o]) => (
        <g key={cy} strokeLinejoin="round">
          <path d={slab(cy)} fill="var(--c-raised)" stroke="var(--c-raised)" strokeWidth="2.6" />
          <path d={slab(cy)} fill="var(--c-accent)" opacity={o} />
        </g>
      ))}
    </svg>
  )
}

export function Wordmark() {
  return (
    <span>
      Cadence<span className="plus">+</span>
    </span>
  )
}
