import { describe, expect, it } from 'vitest'
import { adjustmentFilter, blurFilter, defaultAdjustment, scaleFilter } from '../src/core/adjustments'
import { hexToRgb, hsvToRgb, parseHex, rgbToHex, rgbToHsv } from '../src/core/color'
import * as E from '../src/core/edit'
import { colorMask, maskBounds } from '../src/core/flood'
import { FormatError, packProject, unpackProject } from '../src/core/format'
import { apply, createHistory, jumpTo, redo, replace, undo } from '../src/core/history'
import { collectTileIds, createDocument, rasterBounds, TILE, type ImageDocument } from '../src/core/model'
import { combine, dragRect, invert, selectAll, translate } from '../src/core/selection'
import { clampZoom, docToScreen, fitView, formatZoom, nextZoomStep, screenToDoc, zoomAt } from '../src/core/view'

const doc = () => createDocument({ name: 'Test', width: 800, height: 600 })

describe('history', () => {
  it('records, undoes and redoes edits', () => {
    let h = createHistory(doc())
    h = apply(h, 'New Layer', (d) => void E.addLayer(d))
    expect(h.present.layers).toHaveLength(2)
    h = undo(h)
    expect(h.present.layers).toHaveLength(1)
    h = redo(h)
    expect(h.present.layers).toHaveLength(2)
    expect(h.presentLabel).toBe('New Layer')
  })

  it('coalesces repeated edits with the same key', () => {
    let h = createHistory(doc())
    const id = h.present.layers[0].id
    for (const o of [0.9, 0.8, 0.7]) h = apply(h, 'Opacity', (d) => E.setLayerOpacity(d, id, o), 'opacity')
    expect(h.past).toHaveLength(1)
    expect(h.present.layers[0].opacity).toBe(0.7)
  })

  it('respects the step limit', () => {
    let h = createHistory(doc(), 'Open', 3)
    for (let i = 0; i < 6; i++) h = apply(h, `Step ${i}`, (d) => void E.addLayer(d))
    expect(h.past).toHaveLength(3)
  })

  it('replace changes state without a step; jumpTo walks history', () => {
    let h = createHistory(doc())
    h = apply(h, 'A', (d) => void E.addLayer(d))
    h = apply(h, 'B', (d) => void E.addLayer(d))
    h = replace(h, (d) => void (d.activeLayerId = d.layers[0].id))
    expect(h.past).toHaveLength(2)
    h = jumpTo(h, 0)
    expect(h.present.layers).toHaveLength(1)
    h = jumpTo(h, 2)
    expect(h.present.layers).toHaveLength(3)
  })

  it('a failing edit throws and leaves history unchanged', () => {
    const h = createHistory(doc())
    expect(() => apply(h, 'Delete', (d) => E.deleteLayer(d, d.layers[0].id))).toThrow(E.EditError)
    expect(h.present.layers).toHaveLength(1)
  })
})

describe('layer edits', () => {
  it('adds above the active layer and names sequentially', () => {
    const d = doc()
    E.addLayer(d)
    E.addLayer(d)
    expect(d.layers.map((l) => l.name)).toEqual(['Layer 1', 'Layer 2', 'Layer 3'])
    expect(d.activeLayerId).toBe(d.layers[2].id)
  })

  it('refuses edits on locked layers', () => {
    const d = doc()
    E.addLayer(d)
    const id = d.layers[1].id
    E.setLayerLocked(d, id, true)
    expect(() => E.setLayerOpacity(d, id, 0.5)).toThrow(/locked/)
    expect(() => E.deleteLayer(d, id)).toThrow(/locked/)
  })

  it('reorders and moves layers', () => {
    const d = doc()
    E.addLayer(d)
    E.addLayer(d)
    const top = d.layers[2].id
    E.reorderLayer(d, top, -1)
    expect(d.layers[1].id).toBe(top)
    E.moveLayerTo(d, top, 0)
    expect(d.layers[0].id).toBe(top)
    expect(() => E.reorderLayer(d, top, -1)).toThrow(/bottom/)
  })

  it('rasterTarget explains why a layer cannot be painted', () => {
    const d = doc()
    E.addLayer(d, { type: 'fill', color: '#ff0000' }, 'Fill')
    expect(() => E.rasterTarget(d, 'paint on it')).toThrow(/fill layer/)
  })

  it('merges layers into one', () => {
    const d = doc()
    E.addLayer(d)
    const ids = d.layers.map((l) => l.id)
    E.replaceWithMerged(d, ids, { name: 'Merged', tiles: { '0,0': 't1' }, x: 0, y: 0 })
    expect(d.layers).toHaveLength(1)
    expect(d.layers[0].name).toBe('Merged')
    expect(d.activeLayerId).toBe(d.layers[0].id)
  })

  it('crop shifts raster layers and resizes the canvas', () => {
    const d = doc()
    E.cropDocument(d, { x: 100, y: 50, w: 300, h: 200 })
    expect([d.width, d.height]).toEqual([300, 200])
    const c = d.layers[0].content
    expect(c.type === 'raster' && [c.x, c.y]).toEqual([-100, -50])
  })

  it('canvas size anchors content', () => {
    const d = doc()
    E.resizeCanvas(d, 1000, 600, 0.5, 0.5)
    const c = d.layers[0].content
    expect(c.type === 'raster' && c.x).toBe(100)
    expect(() => E.resizeCanvas(d, 0, 10, 0, 0)).toThrow(E.EditError)
  })

  it('raster bounds follow tile keys and offset', () => {
    expect(rasterBounds({ x: 10, y: 0, tiles: { '0,0': 'a', '2,1': 'b' } })).toEqual({ x: 10, y: 0, w: 3 * TILE, h: 2 * TILE })
    expect(rasterBounds({ x: 0, y: 0, tiles: {} })).toBeNull()
  })
})

describe('selection data', () => {
  it('combines with modes', () => {
    const r = { kind: 'rect' as const, x: 0, y: 0, w: 10, h: 10 }
    expect(combine(null, 'subtract', r)).toBeNull()
    const a = combine(null, 'add', r)!
    expect(a.steps).toHaveLength(1)
    expect(combine(a, 'subtract', r)!.steps).toHaveLength(2)
    expect(combine(a, 'replace', r)!.steps).toHaveLength(1)
  })

  it('double invert cancels', () => {
    const s = selectAll(10, 10)
    expect(invert(invert(s))).toEqual(s)
  })

  it('translates shapes', () => {
    const s = combine(null, 'add', { kind: 'polygon', points: [0, 0, 10, 0, 10, 10] })
    expect(translate(s, 5, 1)!.steps[0]).toEqual({ op: 'add', shape: { kind: 'polygon', points: [5, 1, 15, 1, 15, 11] } })
  })

  it('drag rect handles square and centre', () => {
    expect(dragRect(10, 10, 0, 4, false, false)).toEqual({ x: 0, y: 4, w: 10, h: 6 })
    expect(dragRect(0, 0, 10, 4, true, false)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
    expect(dragRect(10, 10, 15, 12, false, true)).toEqual({ x: 5, y: 8, w: 10, h: 4 })
  })
})

describe('view maths', () => {
  it('fits and never exceeds 100%', () => {
    expect(fitView(100, 100, 1000, 1000).zoom).toBe(1)
    expect(fitView(4000, 2000, 1048, 548).zoom).toBeCloseTo(0.25)
  })

  it('round-trips doc ↔ screen and zooms about a point', () => {
    const v = { zoom: 2, cx: 50, cy: 40 }
    const s = docToScreen(v, 800, 600, 10, 20)
    expect(screenToDoc(v, 800, 600, s.x, s.y)).toEqual({ x: 10, y: 20 })
    const z = zoomAt(v, 800, 600, 4, 100, 100)
    const before = screenToDoc(v, 800, 600, 100, 100)
    const after = screenToDoc(z, 800, 600, 100, 100)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('steps through zoom stops', () => {
    expect(nextZoomStep(1, 1)).toBe(2)
    expect(nextZoomStep(1, -1)).toBe(0.6667)
    expect(nextZoomStep(0.7, -1)).toBe(0.6667)
    expect(clampZoom(1000)).toBe(64)
    expect(formatZoom(0.6667)).toBe('66.7%')
    expect(formatZoom(16)).toBe('1600%')
  })
})

describe('colour', () => {
  it('converts hex, rgb and hsv', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
    expect(parseHex('zz')).toBeNull()
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000')
    for (const hex of ['#ff0000', '#00ff00', '#123456', '#ffffff', '#000000', '#69b7ff']) {
      expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex))))).toBe(hex)
    }
  })
})

describe('adjustments', () => {
  it('maps to filter strings', () => {
    expect(adjustmentFilter(defaultAdjustment('brightnessContrast'))).toBe('none')
    expect(adjustmentFilter({ kind: 'brightnessContrast', params: { brightness: 20, contrast: -50 } })).toBe('brightness(1.2) contrast(0.5)')
    expect(adjustmentFilter(defaultAdjustment('invert'))).toBe('invert(1)')
    expect(scaleFilter(blurFilter(4), 0.5)).toBe('blur(2px)')
  })
})

describe('colour mask (magic wand)', () => {
  // 4×2 image: left half red, right half blue, one red pixel isolated at (3,1)
  const W = 4
  const H = 2
  const px = (r: number, g: number, b: number) => [r, g, b, 255]
  const data = new Uint8ClampedArray([...px(255, 0, 0), ...px(255, 0, 0), ...px(0, 0, 255), ...px(0, 0, 255), ...px(250, 0, 0), ...px(255, 0, 0), ...px(0, 0, 255), ...px(255, 0, 0)])

  it('contiguous fill stops at colour edges', () => {
    const m = colorMask(data, W, H, 0, 0, 10, true)
    expect(Array.from(m)).toEqual([255, 255, 0, 0, 255, 255, 0, 0])
  })
  it('tolerance excludes near colours', () => {
    const m = colorMask(data, W, H, 0, 0, 2, true)
    expect(Array.from(m)).toEqual([255, 255, 0, 0, 0, 255, 0, 0])
  })
  it('non-contiguous selects every match', () => {
    const m = colorMask(data, W, H, 0, 0, 10, false)
    expect(Array.from(m)).toEqual([255, 255, 0, 0, 255, 255, 0, 255])
    expect(maskBounds(m, W, H)).toEqual({ x: 0, y: 0, w: 4, h: 2 })
  })
})

describe('file format', () => {
  it('round-trips header and blobs', () => {
    const d: ImageDocument = doc()
    const blobs = new Map([
      ['t1', new Uint8Array([1, 2, 3])],
      ['t2', new Uint8Array([4, 5])]
    ])
    const bytes = packProject(d, 'test', blobs)
    const u = unpackProject(bytes)
    expect(u.header.document).toEqual(d)
    expect(Array.from(u.blob('t2'))).toEqual([4, 5])
    expect(() => u.blob('nope')).toThrow(FormatError)
  })

  it('rejects other files and newer formats', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]))).toThrow(/not a Cadence\+/)
    const bytes = packProject(doc(), 'test', new Map())
    const json = new TextDecoder().decode(bytes.subarray(12)).replace('"format":1', '"format":9')
    const enc = new TextEncoder().encode(json)
    const b2 = new Uint8Array(12 + enc.length)
    b2.set(bytes.subarray(0, 8))
    new DataView(b2.buffer).setUint32(8, enc.length, true)
    b2.set(enc, 12)
    expect(() => unpackProject(b2)).toThrow(/newer version/)
  })
})

describe('layer masks', () => {
  it('adds, targets, moves with the layer and deletes', () => {
    const d = doc()
    const id = d.layers[0].id
    E.addMask(d, id, { '0,0': 'm1' })
    expect(d.target).toBe('mask')
    expect(E.paintSurface(d, 'paint').kind).toBe('mask')
    E.setLayerPosition(d, id, 10, 5)
    expect([d.layers[0].mask!.x, d.layers[0].mask!.y]).toEqual([10, 5])
    E.cropDocument(d, { x: 2, y: 1, w: 100, h: 100 })
    expect([d.layers[0].mask!.x, d.layers[0].mask!.y]).toEqual([8, 4])
    E.setTarget(d, 'pixels')
    expect(E.paintSurface(d, 'paint').kind).toBe('pixels')
    E.deleteMask(d, id)
    expect(d.layers[0].mask).toBeNull()
    expect(d.target).toBe('pixels')
  })

  it('refuses a second mask and applying on non-pixel layers', () => {
    const d = doc()
    E.addLayer(d, { type: 'fill', color: '#fff' }, 'Fill')
    const id = d.activeLayerId!
    E.addMask(d, id)
    expect(() => E.addMask(d, id)).toThrow(/already has a mask/)
    expect(() => E.applyMask(d, id, {})).toThrow(/Only pixel layers/)
  })

  it('mask tiles are collected for saving and GC', () => {
    const d = doc()
    E.addMask(d, d.layers[0].id, { '0,0': 'mask-tile' })
    const ids = new Set<string>()
    collectTileIds(d, ids)
    expect(ids.has('mask-tile')).toBe(true)
  })
})
