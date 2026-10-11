/**
 * Demo: paints a Mona Lisa homage in Cadence+ using its own tools (gradients,
 * shape layers, soft brush strokes, blur, adjustment layers), driven with real
 * mouse input. Saves test-output/mona-lisa.png and .cadenceimg.
 *
 *   npm run build && node scripts/demo-mona-lisa.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'test-output')
mkdirSync(out, { recursive: true })
const app = await electron.launch({ args: [root], env: { ...process.env, CADENCE_PLUS_USER_DATA: mkdtempSync(join(tmpdir(), 'cp-mona-')), CADENCE_PLUS_TEST: '1', CADENCE_PLUS_NO_MAXIMIZE: '1' } })
const win = await app.firstWindow()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
await win.waitForFunction(() => !!window.__cadencePlus)

const ev = (fn, arg) => win.evaluate(fn, arg)
const A = (name, ...args) => ev(([n, a]) => window.__cadencePlus.A[n](...a), [name, args])
const set = (patch) => ev((p) => window.__cadencePlus.set(p), patch)
const opt = (tool, patch) => ev(([t, p]) => window.__cadencePlus.set((s) => ({ options: { ...s.options, [t]: { ...s.options[t], ...p } } })), [tool, patch])
const doc = () => ev(() => window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.present)
const rename = async (name) => A('renameLayer', (await doc()).activeLayerId, name)

async function client(x, y) {
  const r = await win.locator('.viewport').boundingBox()
  const v = await ev(() => {
    const s = window.__cadencePlus.get()
    return { view: s.docs.find((d) => d.id === s.activeId).view, vp: s.viewport }
  })
  return { x: r.x + (x - v.view.cx) * v.view.zoom + v.vp.w / 2, y: r.y + (y - v.view.cy) * v.view.zoom + v.vp.h / 2 }
}

/** One brush stroke through doc points. */
async function stroke(points, { color, size, hardness = 0, opacity = 100, flow = 30, tool = 'b' } = {}) {
  if (color) await set({ fg: color })
  await opt(tool === 'e' ? 'eraser' : 'brush', { size, hardness, opacity, flow, spacing: 8, pressureSize: false })
  await win.keyboard.press(tool)
  const p0 = await client(...points[0])
  await win.mouse.move(p0.x, p0.y)
  await win.mouse.down()
  for (const p of points.slice(1)) {
    const c = await client(...p)
    await win.mouse.move(c.x, c.y, { steps: 3 })
  }
  await win.mouse.up()
}

/** Shape layer by dragging with the Shape tool. */
async function shape(kind, x0, y0, x1, y1, fill, name) {
  await set({ fg: fill })
  await opt('shape', { kind, fill: true, stroke: false })
  await win.keyboard.press('u')
  const a = await client(x0, y0)
  const b = await client(x1, y1)
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move(b.x, b.y, { steps: 4 })
  await win.mouse.up()
  if (name) await rename(name)
}

async function gradient(x0, y0, x1, y1, from, to, kind = 'linear', extra = {}) {
  await set({ fg: from, bg: to })
  await opt('gradient', { kind, opacity: 100, reverse: false, toTransparent: false, ...extra })
  await A('gradientFill', x0, y0, x1, y1)
}

const W = 600
const H = 900
await ev(([w, h]) => window.__cadencePlus.D.newDocument({ name: 'Mona Lisa (homage)', width: w, height: h, resolution: 72, background: 'white' }), [W, H])
await win.waitForTimeout(500)

// 1 · Sky and hazy distance
await gradient(0, 0, 0, 520, '#56685a', '#c8c296')
await rename('Sky')

// 2 · Landscape: rocky peaks, haze, a winding road
for (const [x0, y0, x1, y1, c] of [
  [-40, 230, 170, 430, '#7a9290'],
  [90, 280, 230, 430, '#869a8f'],
  [430, 210, 640, 420, '#7a9290'],
  [380, 290, 520, 430, '#869a8f']
]) {
  await shape('polygon', x0, y0, x1, y1, c)
  await opt('shape', { sides: 3 })
}
await opt('shape', { sides: 6 })
await A('newLayer')
await rename('Landscape')
for (const [pts, c, s, f] of [
  [[[0, 440], [90, 420], [190, 450]], '#6f7f5e', 80, 25],
  [[[410, 450], [520, 420], [600, 440]], '#6f7f5e', 80, 25],
  [[[0, 540], [100, 515], [190, 540]], '#5d5330', 100, 30],
  [[[410, 540], [500, 510], [600, 530]], '#5d5330', 100, 30],
  [[[20, 500], [70, 478], [120, 492], [160, 470], [190, 480]], '#c09a5c', 9, 45],
  [[[440, 470], [480, 452], [530, 470], [590, 455]], '#c09a5c', 8, 45],
  [[[470, 405], [520, 398], [575, 410]], '#a9bcb5', 14, 30],
  [[[0, 380], [600, 370]], '#b9c2a4', 40, 10]
]) await stroke(pts, { color: c, size: s, flow: f })
// Merge the peaks into the landscape and soften everything into haze.
for (let i = 0; i < 4; i++) await A('mergeDown')
await rename('Landscape')
await A('applyFilter', 'blur(3px)', 'Gaussian Blur')

// 3 · Hair behind the head
await shape('ellipse', 178, 112, 422, 600, '#22160b', 'Hair')
await A('newLayer')
await rename('Hair strands')
await stroke([[205, 300], [188, 420], [172, 540], [160, 610]], { color: '#2b1d0e', size: 56, flow: 45 })
await stroke([[395, 300], [412, 420], [428, 540], [440, 610]], { color: '#2b1d0e', size: 56, flow: 45 })
for (const dx of [0, 12, 24]) {
  await stroke([[232 - dx, 190], [214 - dx, 300], [200 - dx, 430], [186 - dx, 560]], { color: '#4a3218', size: 3, flow: 35, hardness: 40 })
  await stroke([[368 + dx, 190], [386 + dx, 300], [400 + dx, 430], [414 + dx, 560]], { color: '#4a3218', size: 3, flow: 35, hardness: 40 })
}
await A('applyFilter', 'blur(1.5px)', 'Gaussian Blur')

// 4 · Dress with shoulders, then the neck and chest painted over it
await shape('ellipse', 40, 515, 560, 1320, '#29251a', 'Dress')
await A('newLayer')
await rename('Skin')
await stroke([[300, 380], [300, 470], [300, 530]], { color: '#be8f55', size: 72, flow: 55, hardness: 55 })
await stroke([[232, 575], [300, 560], [368, 575]], { color: '#c4955b', size: 84, flow: 60, hardness: 55 })
await stroke([[250, 535], [300, 522], [350, 535]], { color: '#c4955b', size: 76, flow: 60, hardness: 50 })
await stroke([[300, 410], [300, 500]], { color: '#9a6d3c', size: 64, flow: 6 })
await stroke([[255, 560], [300, 548], [345, 560]], { color: '#e0b67c', size: 44, flow: 16 })
await A('newLayer')
await rename('Neckline & folds')
await stroke([[176, 610], [240, 628], [300, 634], [360, 628], [424, 610]], { color: '#29251a', size: 26, flow: 90, hardness: 70 })
await stroke([[188, 600], [250, 618], [300, 624], [350, 618], [412, 600]], { color: '#6b5428', size: 5, flow: 70, hardness: 60 })
await stroke([[110, 760], [180, 700], [240, 680]], { color: '#3b3420', size: 40, flow: 30 })
await stroke([[490, 760], [420, 700], [360, 680]], { color: '#3b3420', size: 40, flow: 30 })
for (const [pts, c] of [
  [[[230, 790], [300, 770], [380, 760], [460, 770], [520, 810]], '#6e5226'],
  [[[250, 805], [330, 790], [420, 788], [500, 815]], '#8a6a32'],
  [[[100, 820], [150, 800], [200, 805]], '#6e5226']
]) await stroke(pts, { color: c, size: 34, flow: 35 })
await A('applyFilter', 'blur(1.5px)', 'Gaussian Blur')

// 6 · Face, with shading confined to it by a layer mask
await shape('ellipse', 230, 165, 370, 410, '#d1a46a', 'Face')
await A('rasterizeActive')
await A('applyFilter', 'blur(1.5px)', 'Gaussian Blur')
await A('newLayer')
await rename('Face shading')
for (const [pts, c, s, f] of [
  [[[246, 230], [244, 300], [256, 370], [292, 402]], '#93683a', 34, 22],
  [[[354, 230], [356, 300], [346, 370], [310, 402]], '#93683a', 30, 18],
  [[[300, 180], [272, 208], [328, 208]], '#efcd95', 50, 16],
  [[[264, 312], [272, 326]], '#e8c088', 30, 14],
  [[[336, 312], [328, 326]], '#e8c088', 30, 14],
  [[[300, 272], [302, 300], [306, 322]], '#a87947', 10, 25],
  [[[316, 300], [312, 324]], '#8a5f33', 8, 25],
  [[[300, 385], [300, 400]], '#a8794a', 30, 12]
]) await stroke(pts, { color: c, size: s, flow: f })
await A('applyFilter', 'blur(4px)', 'Gaussian Blur')
await A('addSelectionShape', { kind: 'ellipse', x: 230, y: 165, w: 140, h: 245 }, 'replace', 'Ellipse')
await A('addLayerMask', 'revealSelection')
await A('selectLayer', (await doc()).activeLayerId, 'pixels')

// 7 · Eyes, nose and the famous smile
await A('newLayer')
await rename('Features')
for (const [pts, c, s, f, h] of [
  [[[256, 268], [270, 263], [285, 268]], '#7a5231', 9, 55, 30],
  [[[315, 268], [330, 263], [344, 268]], '#7a5231', 9, 55, 30],
  [[[268, 268], [273, 268]], '#24140a', 7, 90, 50],
  [[[328, 268], [333, 268]], '#24140a', 7, 90, 50],
  [[[256, 278], [272, 282], [286, 278]], '#a77c4c', 4, 25, 20],
  [[[314, 278], [328, 282], [344, 278]], '#a77c4c', 4, 25, 20],
  [[[292, 326], [300, 331], [310, 327]], '#7d532c', 6, 45, 40],
  [[[279, 351], [290, 353], [300, 354], [311, 353], [322, 350], [327, 346]], '#6b3f22', 4, 50, 40],
  [[[275, 348], [279, 351]], '#6b3f22', 3, 40, 40],
  [[[289, 362], [300, 364], [311, 362]], '#b07a4a', 6, 25, 20]
]) await stroke(pts, { color: c, size: s, flow: f, hardness: h })
await A('applyFilter', 'blur(1px)', 'Gaussian Blur')

// 8 · Hands, the right resting over the left
await A('newLayer')
await rename('Hands')
await stroke([[190, 838], [250, 846], [310, 842], [345, 832]], { color: '#b8874f', size: 50, flow: 70, hardness: 55 })
await stroke([[312, 800], [370, 795], [425, 803], [462, 816]], { color: '#cc9c60', size: 58, flow: 70, hardness: 55 })
for (const y of [792, 806, 820, 834]) await stroke([[430, y], [462, y + 6], [482, y + 12]], { color: '#c89759', size: 13, flow: 70, hardness: 40 })
for (const y of [799, 813, 827]) await stroke([[432, y], [478, y + 8]], { color: '#8f6236', size: 2, flow: 50, hardness: 30 })
await stroke([[330, 790], [380, 785], [420, 792]], { color: '#e3b77d', size: 18, flow: 20 })
await A('applyFilter', 'blur(1.5px)', 'Gaussian Blur')

// 9 · Sfumato and old varnish
await A('newAdjustmentLayer', 'curves')
await A('setAdjustmentParams', (await doc()).activeLayerId, { kind: 'curves', params: {}, curves: { rgb: [0, 8, 70, 62, 190, 196, 255, 238], b: [0, 0, 128, 104, 255, 214] } })
await A('newAdjustmentLayer', 'sepia')
await A('setAdjustmentParams', (await doc()).activeLayerId, { kind: 'sepia', params: { amount: 28 } })
await A('newLayer')
await rename('Vignette')
await set({ fg: '#000000' })
await opt('gradient', { kind: 'radial', opacity: 70, reverse: true, toTransparent: true })
await A('gradientFill', 300, 430, 300, 900)

await win.waitForTimeout(500)
await win.screenshot({ path: join(out, 'mona-lisa-app.png') })
await ev((p) => window.__cadencePlus.D.exportTo(p, 'png', 1), join(out, 'mona-lisa.png'))
await ev((p) => {
  const s = window.__cadencePlus.get()
  window.__cadencePlus.set({ docs: s.docs.map((d) => (d.id === s.activeId ? { ...d, path: p } : d)) })
  return window.__cadencePlus.D.save()
}, join(out, 'mona-lisa.cadenceimg'))
const d = await doc()
console.log(`${d.layers.length} layers: ${d.layers.map((l) => l.name).join(', ')}`)
await app.close()
