/**
 * Export presets: named format + size combinations exported together into a
 * folder (File → Export with Presets). Kept in settings.
 */

export type PresetFormat = 'png' | 'jpeg' | 'webp' | 'tiff'

export interface ExportPreset {
  id: string
  name: string
  format: PresetFormat
  /** JPEG / WebP quality, 1..100. */
  quality: number
  /** Percent of the document size (100 = actual pixels). */
  scale: number
  /** Optional cap on the longer side in pixels (0 = none), applied after `scale`. */
  maxSide: number
  /** Appended to the document name, e.g. "@2x". */
  suffix: string
  /** 16-bit documents: write 16 bits/channel (PNG, TIFF). */
  sixteenBit: boolean
  /** Ticked in the dialog. */
  enabled: boolean
}

export const DEFAULT_PRESETS: ExportPreset[] = [
  { id: 'png1x', name: 'PNG', format: 'png', quality: 100, scale: 100, maxSide: 0, suffix: '', sixteenBit: true, enabled: true },
  { id: 'png2x', name: 'PNG @2x', format: 'png', quality: 100, scale: 200, maxSide: 0, suffix: '@2x', sixteenBit: false, enabled: false },
  { id: 'jpegWeb', name: 'JPEG for the web', format: 'jpeg', quality: 80, scale: 100, maxSide: 2048, suffix: '-web', sixteenBit: false, enabled: true },
  { id: 'webp', name: 'WebP', format: 'webp', quality: 85, scale: 100, maxSide: 0, suffix: '', sixteenBit: false, enabled: false },
  { id: 'thumb', name: 'Thumbnail', format: 'jpeg', quality: 75, scale: 100, maxSide: 400, suffix: '-thumb', sixteenBit: false, enabled: false }
]

export const PRESET_EXT: Record<PresetFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', tiff: 'tif' }

/** Output scale factor for a document of w × h. */
export function presetScale(p: ExportPreset, w: number, h: number): number {
  let s = Math.max(0.01, p.scale / 100)
  if (p.maxSide > 0) s = Math.min(s, p.maxSide / Math.max(w, h))
  return s
}

/** Output size in pixels (at least 1 × 1). */
export function presetSize(p: ExportPreset, w: number, h: number): { w: number; h: number } {
  const s = presetScale(p, w, h)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** File name for a preset: characters Windows forbids become "_". */
export function presetFileName(docName: string, p: ExportPreset): string {
  const base = `${docName}${p.suffix}`.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Untitled'
  return `${base}.${PRESET_EXT[p.format]}`
}

/** Two enabled presets writing the same file would overwrite each other. */
export function duplicateNames(docName: string, presets: ExportPreset[]): string[] {
  const seen = new Map<string, number>()
  for (const p of presets.filter((x) => x.enabled)) {
    const n = presetFileName(docName, p).toLowerCase()
    seen.set(n, (seen.get(n) ?? 0) + 1)
  }
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n)
}
