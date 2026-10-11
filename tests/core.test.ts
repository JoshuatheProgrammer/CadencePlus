import { describe, expect, it } from 'vitest'
import * as A from '../src/core/affine'
import { adjustmentFilter, adjustmentOp, blurFilter, defaultAdjustment, scaleFilter } from '../src/core/adjustments'
import * as L from '../src/core/lut'
import * as V from '../src/core/vector'
import { hexToRgb, hsvToRgb, parseHex, rgbToHex, rgbToHsv } from '../src/core/color'
import * as E from '../src/core/edit'
import { colorMask, maskBounds } from '../src/core/flood'
import { FormatError, packProject, unpackProject } from '../src/core/format'
import { apply, createHistory, dropLast, jumpTo, redo, replace, undo } from '../src/core/history'
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

describe('affine maths', () => {
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9)

  it('params map the content box onto its rect at identity', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 }
    const m = A.paramsToMatrix(A.paramsForRect(r), r.w, r.h)
    close(A.apply(m, 0, 0), { x: 10, y: 20 })
    close(A.apply(m, 100, 50), { x: 110, y: 70 })
    expect(A.isIntegerTranslation(m)).toBe(true)
    expect(A.transformedBounds(m, 100, 50)).toEqual(r)
  })

  it('rotation by 90° swaps the bounds about the centre', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 }
    const m = A.paramsToMatrix({ ...A.paramsForRect(r), rot: Math.PI / 2 }, 100, 50)
    expect(A.transformedBounds(m, 100, 50)).toEqual({ x: 25, y: -25, w: 50, h: 100 })
  })

  it('invert and multiply round-trip', () => {
    const m = A.paramsToMatrix({ cx: 5, cy: 7, sx: 2, sy: -0.5, rot: 0.3 }, 40, 30)
    const p = A.apply(A.multiply(A.invert(m), m), 12, 34)
    close(p, { x: 12, y: 34 })
  })

  it('dragging the right edge keeps the left edge fixed', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 }
    const p0 = A.paramsForRect(r)
    // Pointer 150 px right of the centre → right edge at 200
    const p = A.scaleFromHandle(p0, 100, 50, 1, 0, { x: 150, y: 0 }, false, false)
    const m = A.paramsToMatrix(p, 100, 50)
    close(A.apply(m, 0, 0), { x: 0, y: 0 })
    close(A.apply(m, 100, 0), { x: 200, y: 0 })
  })

  it('corner drag with aspect lock scales uniformly; from-centre keeps the centre', () => {
    const p0 = A.paramsForRect({ x: 0, y: 0, w: 100, h: 50 })
    const p = A.scaleFromHandle(p0, 100, 50, 1, 1, { x: 100, y: 10 }, true, false)
    expect(p.sx).toBeCloseTo(p.sy * 1)
    const c = A.scaleFromHandle(p0, 100, 50, -1, 0, { x: -100, y: 0 }, false, true)
    expect([c.cx, c.cy, c.sx]).toEqual([50, 25, 2])
  })
})

describe('levels and curves tables', () => {
  it('levels: identity, input clipping, gamma, output range', () => {
    expect(Array.from(L.levelsTable(L.DEFAULT_LEVELS))).toEqual(Array.from({ length: 256 }, (_, i) => i))
    const t = L.levelsTable({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 })
    expect([t[0], t[50], t[125], t[200], t[255]]).toEqual([0, 0, 128, 255, 255])
    const g = L.levelsTable({ ...L.DEFAULT_LEVELS, gamma: 2 })
    expect(g[64]).toBe(Math.round(Math.sqrt(64 / 255) * 255))
    const o = L.levelsTable({ ...L.DEFAULT_LEVELS, outBlack: 20, outWhite: 220 })
    expect([o[0], o[255]]).toEqual([20, 220])
  })

  it('curves pass through their points and never overshoot', () => {
    const t = L.curveTable([0, 0, 64, 32, 192, 224, 255, 255])
    expect([t[0], t[64], t[192], t[255]]).toEqual([0, 32, 224, 255])
    for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1])
    expect(Array.from(L.curveTable(L.IDENTITY_CURVE))).toEqual(Array.from({ length: 256 }, (_, i) => i))
    const inv = L.curveTable([0, 255, 255, 0])
    expect([inv[0], inv[128], inv[255]]).toEqual([255, 127, 0])
  })

  it('combines channel then master and applies on the CPU', () => {
    const id = Uint8Array.from({ length: 256 }, (_, i) => i)
    const half = Uint8Array.from({ length: 256 }, (_, i) => i >> 1)
    const lut = L.combine(half, id, id, id)
    const px = new Uint8ClampedArray([200, 100, 50, 255])
    L.applyLutToPixels(px, lut)
    expect(Array.from(px)).toEqual([100, 50, 25, 255])
    expect(L.isIdentityLut(L.combine(id, id, id, id))).toBe(true)
  })

  it('adjustment ops: identity is null; levels/curves give LUTs; others give filters', () => {
    expect(adjustmentOp(defaultAdjustment('levels'))).toBeNull()
    expect(adjustmentOp(defaultAdjustment('curves'))).toBeNull()
    expect(adjustmentOp({ kind: 'levels', params: { inWhite: 128 } })).toBeInstanceOf(Uint8Array)
    expect(adjustmentOp(defaultAdjustment('invert'))).toBe('invert(1)')
  })

  it('histogram counts non-transparent pixels', () => {
    const h = L.histogram(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]))
    expect(h.r[255]).toBe(1)
    expect(h.r[0]).toBe(0)
    expect(h.rgb[76]).toBe(1)
  })
})

describe('vector layers', () => {
  it('keepTopLeft holds the corner when the box grows (also when rotated)', () => {
    for (const rot of [0, 0.7]) {
      const p0 = { cx: 50, cy: 20, sx: 1, sy: 1, rot }
      const before = A.apply(A.paramsToMatrix(p0, 100, 40), 0, 0)
      const p1 = V.keepTopLeft(p0, 100, 40, 160, 60)
      const after = A.apply(A.paramsToMatrix(p1, 160, 60), 0, 0)
      expect(after.x).toBeCloseTo(before.x)
      expect(after.y).toBeCloseTo(before.y)
    }
  })

  it('mapParams moves the centre and adjusts scale/rotation', () => {
    const p = { cx: 10, cy: 20, sx: 1, sy: 1, rot: 0.1 }
    expect(V.mapParams(p, (x, y) => ({ x: 100 - x, y }), { flipX: true })).toEqual({ cx: 90, cy: 20, sx: -1, sy: 1, rot: -0.1 })
    const r = V.mapParams(p, (x, y) => ({ x: 50 - y, y: x }), { rotate: Math.PI / 2 })
    expect([r.cx, r.cy, r.rot]).toEqual([30, 10, 0.1 + Math.PI / 2])
  })

  it('type and shape layers move, crop and refuse painting', () => {
    const d = doc()
    const text = { ...V.DEFAULT_TEXT_STYLE, text: 'Hi' }
    E.addLayer(d, { type: 'text', text, params: { cx: 50, cy: 50, sx: 1, sy: 1, rot: 0 } }, 'Hi')
    const id = d.activeLayerId!
    expect(() => E.rasterTarget(d, 'paint on it')).toThrow(/type layer/)
    E.setVectorParams(d, id, { cx: 60, cy: 55, sx: 1, sy: 1, rot: 0 })
    E.cropDocument(d, { x: 10, y: 5, w: 100, h: 100 })
    const c = d.layers[1].content
    expect(c.type === 'text' && [c.params.cx, c.params.cy]).toEqual([50, 50])
    E.setText(d, id, { ...text, text: 'Hello' }, { w: 40, h: 50 }, { w: 100, h: 50 })
    const c2 = d.layers[1].content
    expect(c2.type === 'text' && c2.params.cx).toBe(80)
    E.rasterizeLayer(d, id, {})
    expect(d.layers[1].content.type).toBe('raster')
  })

  it('dropLast removes a step without leaving a redo', () => {
    let h = createHistory(doc())
    h = apply(h, 'Type Layer', (x) => void E.addLayer(x), 'k')
    h = dropLast(h)
    expect(h.present.layers).toHaveLength(1)
    expect(h.future).toHaveLength(0)
  })
})
