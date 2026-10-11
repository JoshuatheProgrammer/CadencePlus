import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESETS, duplicateNames, presetFileName, presetScale, presetSize, type ExportPreset } from '../src/core/export-presets'

const base: ExportPreset = { ...DEFAULT_PRESETS[0] }

describe('export presets', () => {
  it('scales by percent, then caps the longest side', () => {
    expect(presetScale({ ...base, scale: 200 }, 1000, 500)).toBe(2)
    expect(presetSize({ ...base, scale: 100, maxSide: 400 }, 2000, 1000)).toEqual({ w: 400, h: 200 })
    // The cap never enlarges.
    expect(presetSize({ ...base, scale: 100, maxSide: 4000 }, 2000, 1000)).toEqual({ w: 2000, h: 1000 })
    expect(presetSize({ ...base, scale: 1 }, 50, 30)).toEqual({ w: 1, h: 1 })
  })
  it('builds safe file names with the right extension', () => {
    expect(presetFileName('Poster', { ...base, format: 'jpeg', suffix: '-web' })).toBe('Poster-web.jpg')
    expect(presetFileName('a/b:c', { ...base, suffix: '?' })).toBe('a_b_c_.png')
    expect(presetFileName('Shot', { ...base, format: 'tiff', suffix: '@2x' })).toBe('Shot@2x.tif')
  })
  it('flags enabled presets that would write the same file', () => {
    const a = { ...base, id: 'a', suffix: '', enabled: true }
    const b = { ...base, id: 'b', suffix: '', enabled: true }
    expect(duplicateNames('X', [a, b])).toEqual(['x.png'])
    expect(duplicateNames('X', [a, { ...b, enabled: false }])).toEqual([])
    expect(duplicateNames('X', [a, { ...b, format: 'webp' }])).toEqual([])
  })
})
