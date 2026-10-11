/**
 * End-to-end verification: drives the built app (npm run build first) with
 * real mouse/keyboard input and test hooks, and checks the actual pixels.
 *
 *   node scripts/e2e.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { initializeCanvas, readPsd } from 'ag-psd'
import { makeDng, makePsd, makeTiff16, makeTiff8 } from './fixtures.mjs'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'cplus-e2e-'))
mkdirSync(join(root, 'test-output'), { recursive: true })

const app = await electron.launch({
  args: [root],
  env: { ...process.env, CADENCE_PLUS_USER_DATA: join(work, 'user'), CADENCE_PLUS_TEST: '1', CADENCE_PLUS_NO_MAXIMIZE: '1' }
})
const win = await app.firstWindow()
const pageErrors = []
win.on('pageerror', (e) => pageErrors.push(String(e.stack ?? e)))
win.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()))
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 960))
await win.waitForFunction(() => !!window.__cadencePlus)

// ---------------------------------------------------------------------------
const ev = (fn, arg) => win.evaluate(fn, arg)
const px = (x, y) => ev(([x, y]) => window.__cadencePlus.pixel(x, y), [x, y])
const doc = () => ev(() => {
  const s = window.__cadencePlus.get()
  return s.docs.find((d) => d.id === s.activeId)?.history.present
})
const near = (a, b, tol = 2) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)
const settle = (ms = 120) => win.waitForTimeout(ms)
async function client(x, y) {
  const r = await win.locator('.viewport').boundingBox()
  const v = await ev(() => {
    const s = window.__cadencePlus.get()
    return { view: s.docs.find((d) => d.id === s.activeId).view, vp: s.viewport }
  })
  return { x: r.x + (x - v.view.cx) * v.view.zoom + v.vp.w / 2, y: r.y + (y - v.view.cy) * v.view.zoom + v.vp.h / 2 }
}
async function drag(points, steps = 6) {
  const p0 = await client(...points[0])
  await win.mouse.move(p0.x, p0.y)
  await win.mouse.down()
  for (const p of points.slice(1)) {
    const c = await client(...p)
    await win.mouse.move(c.x, c.y, { steps })
  }
  await win.mouse.up()
  await settle()
}
async function newDoc(w, h, background = 'white', name = 'Test') {
  await ev(([w, h, background, name]) => window.__cadencePlus.D.newDocument({ name, width: w, height: h, resolution: 72, background }), [w, h, background, name])
  await win.waitForFunction(() => {
    const s = window.__cadencePlus.get()
    return !!s.docs.find((d) => d.id === s.activeId)?.view
  })
  await settle()
}
const selectRect = (x, y, w, h, mode = 'replace') => ev(([x, y, w, h, mode]) => window.__cadencePlus.A.addSelectionShape({ kind: 'rect', x, y, w, h }, mode, 'Select'), [x, y, w, h, mode])
const setFg = (c) => ev((c) => window.__cadencePlus.set({ fg: c }), c)
const A = (name, ...args) => ev(([name, args]) => window.__cadencePlus.A[name](...args), [name, args])
const D = (name, ...args) => ev(([name, args]) => window.__cadencePlus.D[name](...args), [name, args])
const markClean = () => ev(() => window.__cadencePlus.set((s) => ({ docs: s.docs.map((d) => ({ ...d, savedRevision: d.history.revision })) })))
async function closeAllClean() {
  await markClean()
  await D('closeAll')
  await settle()
}

const results = []
// ag-psd only needs ImageData-shaped objects when reading with useImageData (no canvas in Node).
initializeCanvas(() => { throw new Error('no canvas in Node') }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }))
// E2E_ONLY=regex runs just the matching checks (plus the final error check).
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null
async function check(name, fn) {
  if (only && !only.test(name) && !/uncaught errors/.test(name)) return
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ---------------------------------------------------------------------------

await check('new document is white, one layer', async () => {
  await newDoc(400, 300)
  const p = await px(5, 5)
  const d = await doc()
  expect(near(p, [255, 255, 255, 255], 0), `pixel ${p}`)
  expect(d.layers.length === 1 && d.layers[0].name === 'Background', 'layers')
})

await check('brush stroke paints the foreground colour (mouse)', async () => {
  await setFg('#ff0000')
  await win.keyboard.press('b')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, brush: { ...s.options.brush, size: 20, hardness: 100, opacity: 100, flow: 100 } } })))
  await drag([[50, 150], [350, 150]])
  const on = await px(200, 150)
  const off = await px(200, 100)
  expect(near(on, [255, 0, 0, 255]), `on stroke ${on}`)
  expect(near(off, [255, 255, 255, 255]), `off stroke ${off}`)
  return `on ${on}`
})

await check('undo and redo (Ctrl+Z / Ctrl+Shift+Z)', async () => {
  await win.keyboard.press('Control+z')
  await settle()
  const u = await px(200, 150)
  await win.keyboard.press('Control+Shift+z')
  await settle()
  const r = await px(200, 150)
  expect(near(u, [255, 255, 255, 255]), `after undo ${u}`)
  expect(near(r, [255, 0, 0, 255]), `after redo ${r}`)
})

await check('eraser removes alpha', async () => {
  await win.keyboard.press('e')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, eraser: { ...s.options.eraser, size: 20, hardness: 100, opacity: 100 } } })))
  await drag([[50, 220], [350, 220]])
  const p = await px(200, 220)
  expect(p[3] === 0, `alpha ${p}`)
})

await check('stroke opacity caps overlapping dabs (50% brush)', async () => {
  await win.keyboard.press('b')
  await setFg('#000000')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, brush: { ...s.options.brush, opacity: 50, flow: 100 } } })))
  // Zig-zag over the same spot within one stroke
  await drag([[200, 60], [260, 60], [200, 60], [260, 60]])
  const p = await px(230, 60)
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, brush: { ...s.options.brush, opacity: 100 } } })))
  expect(near(p, [128, 128, 128, 255], 3), `pixel ${p}`)
  return `${p}`
})

await check('selection limits fill; layer opacity mixes', async () => {
  await A('newLayer')
  await selectRect(100, 30, 60, 20)
  await A('fillWith', '#0000ff')
  const inside = await px(130, 40)
  const outside = await px(90, 40)
  expect(near(inside, [0, 0, 255, 255]), `inside ${inside}`)
  expect(near(outside, [255, 255, 255, 255]), `outside ${outside}`)
  const id = (await doc()).activeLayerId
  await A('setLayerOpacity', id, 0.5)
  const mixed = await px(130, 40)
  expect(near(mixed, [128, 128, 255, 255], 2), `50% ${mixed}`)
  await A('setLayerOpacity', id, 1)
})

await check('blend mode: multiply green over red = black', async () => {
  await A('newLayer')
  await selectRect(150, 140, 40, 20)
  await A('fillWith', '#00ff00')
  const id = (await doc()).activeLayerId
  await A('setLayerBlend', id, 'multiply')
  const p = await px(170, 150)
  const white = await px(170, 145 - 10)
  expect(near(p, [0, 0, 0, 255]), `multiply over red ${p}`)
  expect(near(white, [255, 255, 255, 255]), `untouched ${white}`)
  await win.keyboard.press('Control+d')
})

await check('merge down (normal layer) and merge visible keep the composite identical', async () => {
  const pts = [[170, 150], [130, 40], [200, 150], [10, 10], [200, 220]]
  const before = await Promise.all(pts.map(([x, y]) => px(x, y)))
  const d0 = await doc()
  // Merge the normal-blend blue layer (index 1) into the background.
  await A('selectLayer', d0.layers[1].id)
  await win.keyboard.press('Control+e')
  await settle()
  const mid = await Promise.all(pts.map(([x, y]) => px(x, y)))
  expect((await doc()).layers.length === d0.layers.length - 1, 'merge down count')
  before.forEach((b, i) => expect(near(b, mid[i], 1), `merge down ${pts[i]}: ${b} → ${mid[i]}`))
  // Merge Visible composites the whole stack, so the multiply layer is baked correctly.
  await win.keyboard.press('Control+Shift+e')
  await settle()
  const after = await Promise.all(pts.map(([x, y]) => px(x, y)))
  expect((await doc()).layers.length === 1, 'merge visible count')
  before.forEach((b, i) => expect(near(b, after[i], 1), `merge visible ${pts[i]}: ${b} → ${after[i]}`))
})

await check('magic wand selects contiguous colour; fill respects it', async () => {
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, wand: { ...s.options.wand, sampleAll: true, tolerance: 10, contiguous: true } } })))
  await win.keyboard.press('w')
  const c = await client(10, 10)
  await win.mouse.click(c.x, c.y)
  await settle()
  expect(!!(await doc()).selection, 'no selection')
  await A('newLayer')
  await A('fillWith', '#ffff00')
  const bg = await px(10, 10)
  const red = await px(100, 150)
  expect(near(bg, [255, 255, 0, 255]), `background ${bg}`)
  expect(near(red, [255, 0, 0, 255]), `stroke untouched ${red}`)
  await win.keyboard.press('Control+d')
})

await check('linear gradient from foreground to background', async () => {
  await newDoc(256, 10)
  await ev(() => window.__cadencePlus.set({ fg: '#000000', bg: '#ffffff' }))
  await A('gradientFill', 0, 5, 256, 5)
  const a = await px(0, 5)
  const m = await px(128, 5)
  const b = await px(255, 5)
  expect(a[0] < 3 && b[0] > 252 && Math.abs(m[0] - 128) <= 3, `${a[0]} ${m[0]} ${b[0]}`)
  return `${a[0]} / ${m[0]} / ${b[0]}`
})

await check('paint bucket fills the contiguous area only', async () => {
  await newDoc(100, 100)
  await selectRect(40, 40, 20, 20)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await setFg('#0000ff')
  await A('bucketFill', 5, 5)
  expect(near(await px(5, 5), [0, 0, 255, 255]), 'outside not blue')
  expect(near(await px(50, 50), [255, 0, 0, 255]), 'inside changed')
})

await check('Image → Invert (Ctrl+I) is destructive and undoable', async () => {
  await win.keyboard.press('Control+i')
  await settle()
  expect(near(await px(5, 5), [255, 255, 0, 255]), 'not inverted')
  await win.keyboard.press('Control+z')
  await settle()
  expect(near(await px(5, 5), [0, 0, 255, 255]), 'undo failed')
})

await check('adjustment layer is non-destructive', async () => {
  await A('newAdjustmentLayer', 'invert')
  expect(near(await px(5, 5), [255, 255, 0, 255]), 'adjustment not applied')
  const id = (await doc()).activeLayerId
  await A('setLayerVisible', id, false)
  expect(near(await px(5, 5), [0, 0, 255, 255]), 'hidden adjustment still applied')
  await A('setLayerVisible', id, true)
  await A('newAdjustmentLayer', 'blackWhite')
  const g = await px(5, 5)
  expect(g[0] === g[1] && g[1] === g[2], `not grey ${g}`)
})

await check('Hue/Saturation dialog previews live and applies', async () => {
  await newDoc(50, 50)
  await A('fillWith', '#ff0000')
  await win.keyboard.press('Control+u')
  await win.waitForSelector('.modal')
  // Saturation slider → -100 (fully desaturated)
  await ev(() => {
    const inputs = [...document.querySelectorAll('.modal input[type=range]')]
    const sat = inputs[1]
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(sat, '-100')
    sat.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle(200)
  const preview = await ev(() => window.__cadencePlus.get().filterPreview?.op)
  expect(preview && preview.includes('saturate(0)'), `preview ${preview}`)
  expect(near(await px(5, 5), [255, 0, 0, 255]), 'preview must not change pixels')
  await win.click('.modal .btn.primary')
  await settle()
  const p = await px(5, 5)
  expect(p[0] === p[1] && p[1] === p[2], `not desaturated ${p}`)
})

await check('Gaussian blur softens an edge', async () => {
  await newDoc(60, 60)
  await selectRect(0, 0, 30, 60)
  await A('fillWith', '#000000')
  await A('deselect')
  await A('applyFilter', 'blur(3px)', 'Gaussian Blur')
  const edge = await px(30, 30)
  const far = await px(5, 30)
  expect(edge[0] > 60 && edge[0] < 200, `edge ${edge}`)
  expect(far[0] < 5, `far ${far}`)
})

await check('crop moves content and resizes the canvas', async () => {
  await newDoc(100, 100)
  await selectRect(20, 20, 10, 10)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await A('crop', { x: 20, y: 20, w: 50, h: 40 })
  const d = await doc()
  expect(d.width === 50 && d.height === 40, `${d.width}×${d.height}`)
  expect(near(await px(0, 0), [255, 0, 0, 255]), 'content not shifted')
  expect(near(await px(15, 15), [255, 255, 255, 255]), 'wrong content')
})

await check('crop tool via mouse + Enter', async () => {
  await newDoc(200, 100)
  await win.keyboard.press('c')
  await drag([[50, 20], [150, 80]])
  expect(!!(await ev(() => window.__cadencePlus.get().crop)), 'no crop rect')
  await win.keyboard.press('Enter')
  await settle()
  const d = await doc()
  expect(Math.abs(d.width - 100) <= 1 && Math.abs(d.height - 60) <= 1, `${d.width}×${d.height}`)
})

await check('rotate 90° and flip map pixels correctly', async () => {
  await newDoc(40, 20)
  await selectRect(0, 0, 20, 20)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await A('transformImage', { kind: 'rotate', turns: 1 }, 'Rotate')
  let d = await doc()
  expect(d.width === 20 && d.height === 40, `${d.width}×${d.height}`)
  expect(near(await px(10, 5), [255, 0, 0, 255]) && near(await px(10, 35), [255, 255, 255, 255]), 'rotate cw: left should become top')
  await A('transformImage', { kind: 'flip', axis: 'v' }, 'Flip')
  expect(near(await px(10, 35), [255, 0, 0, 255]), 'flip v')
  await A('transformImage', { kind: 'resize', width: 10, height: 20 }, 'Image Size')
  d = await doc()
  expect(d.width === 10 && d.height === 20, `resize ${d.width}×${d.height}`)
  expect(near(await px(5, 18), [255, 0, 0, 255], 3), 'resized content')
})

await check('canvas size anchors content', async () => {
  await newDoc(10, 10)
  await A('resizeCanvas', 30, 10, 0.5, 0.5)
  const d = await doc()
  expect(d.width === 30, 'width')
  expect((await px(2, 5))[3] === 0 && near(await px(15, 5), [255, 255, 255, 255]), 'anchor')
})

await check('flatten fills transparency with white', async () => {
  await newDoc(20, 20, 'transparent')
  await selectRect(0, 0, 10, 20)
  await A('fillWith', '#00ff00')
  await A('deselect')
  expect((await px(15, 5))[3] === 0, 'expected transparent')
  await A('flattenImage')
  expect(near(await px(15, 5), [255, 255, 255, 255]) && near(await px(5, 5), [0, 255, 0, 255]), 'flatten')
  expect((await doc()).layers.length === 1, 'layers')
})

await check('copy & paste in place (Ctrl+C / Ctrl+V)', async () => {
  await newDoc(100, 100, 'transparent')
  await selectRect(10, 10, 20, 20)
  await A('fillWith', '#ff00ff')
  await win.keyboard.press('Control+c')
  await settle(300)
  await win.keyboard.press('Control+v')
  await win.waitForFunction(() => {
    const s = window.__cadencePlus.get()
    return s.docs.find((d) => d.id === s.activeId).history.present.layers.length === 2
  })
  const d = await doc()
  const top = d.layers[1]
  expect(top.content.type === 'raster', 'pasted layer')
  await A('setLayerVisible', d.layers[0].id, false)
  expect(near(await px(15, 15), [255, 0, 255, 255]) && (await px(40, 40))[3] === 0, 'pasted pixels not in place')
})

await check('move tool drag offsets the layer', async () => {
  await newDoc(200, 200, 'transparent')
  await selectRect(0, 0, 20, 20)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await win.keyboard.press('v')
  await drag([[10, 10], [60, 40]])
  const c = (await doc()).layers[0].content
  expect(Math.abs(c.x - 50) <= 1 && Math.abs(c.y - 30) <= 1, `offset ${c.x},${c.y}`)
  expect(near(await px(55, 35), [255, 0, 0, 255]), 'pixels did not move')
  await win.keyboard.press('ArrowRight')
  await settle()
  expect((await doc()).layers[0].content.x === c.x + 1, 'nudge')
})

await check('eyedropper picks the clicked colour (Alt picks background)', async () => {
  await win.keyboard.press('i')
  const c = await client(60, 40)
  await win.mouse.click(c.x, c.y)
  await settle()
  const fg = await ev(() => window.__cadencePlus.get().fg)
  expect(fg === '#ff0000', `fg ${fg}`)
})

await check('lasso selection via mouse (Shift adds)', async () => {
  await newDoc(200, 200)
  await win.keyboard.press('l')
  await drag([[20, 20], [80, 20], [80, 80], [20, 80]], 4)
  let d = await doc()
  expect(d.selection?.steps.length === 1 && d.selection.steps[0].shape.kind === 'polygon', 'polygon')
  await win.keyboard.down('Shift')
  await drag([[120, 120], [180, 120], [180, 180]], 4)
  await win.keyboard.up('Shift')
  d = await doc()
  expect(d.selection.steps.length === 2 && d.selection.steps[1].op === 'add', 'add mode')
})

await check('marquee via mouse, inverse, delete clears', async () => {
  await newDoc(100, 100)
  await win.keyboard.press('m')
  await drag([[10, 10], [50, 50]])
  await win.keyboard.press('Control+Shift+i')
  await win.keyboard.press('Delete')
  await settle()
  expect((await px(80, 80))[3] === 0, 'outside not cleared')
  expect(near(await px(30, 30), [255, 255, 255, 255]), 'inside cleared')
})

await check('Layers panel: eye toggles visibility, drag reorders', async () => {
  await newDoc(50, 50)
  await A('newLayer')
  await A('newLayer')
  const before = (await doc()).layers.map((l) => l.name)
  await win.locator('.layer-row', { hasText: 'Layer 1' }).locator('.eye').click()
  await settle()
  expect((await doc()).layers.find((l) => l.name === 'Layer 1').visible === false, 'eye')
  const src = await win.locator('.layer-row', { hasText: 'Background' }).boundingBox()
  const dst = await win.locator('.layer-row', { hasText: 'Layer 2' }).boundingBox()
  await win.mouse.move(src.x + 120, src.y + src.height / 2)
  await win.mouse.down()
  await win.mouse.move(dst.x + 120, dst.y + 4, { steps: 8 })
  await win.mouse.up()
  await settle()
  const after = (await doc()).layers.map((l) => l.name)
  expect(after[after.length - 1] === 'Background', `order ${before} → ${after}`)
})

await check('keyboard: X swaps, D resets colours; [ ] size', async () => {
  await ev(() => window.__cadencePlus.set({ fg: '#123456', bg: '#abcdef', tool: 'brush' }))
  await win.keyboard.press('x')
  const s1 = await ev(() => ({ fg: window.__cadencePlus.get().fg, bg: window.__cadencePlus.get().bg }))
  await win.keyboard.press('d')
  const s2 = await ev(() => ({ fg: window.__cadencePlus.get().fg, bg: window.__cadencePlus.get().bg }))
  const size0 = await ev(() => window.__cadencePlus.get().options.brush.size)
  await win.keyboard.press(']')
  const size1 = await ev(() => window.__cadencePlus.get().options.brush.size)
  expect(s1.fg === '#abcdef' && s2.fg === '#000000' && s2.bg === '#ffffff' && size1 > size0, JSON.stringify({ s1, s2, size0, size1 }))
})

// ---------------------------------------------------------------- masks
await check('layer mask: black hides, grey half-hides, white brush reveals', async () => {
  await newDoc(100, 100)
  await A('newLayer')
  await A('fillWith', '#ff0000')
  await A('addLayerMask', 'revealAll')
  expect((await doc()).target === 'mask', 'mask not targeted')
  expect(near(await px(25, 50), [255, 0, 0, 255]), 'reveal all should show the layer')
  await selectRect(0, 0, 50, 100)
  await A('fillWith', '#000000')
  await A('deselect')
  expect(near(await px(25, 50), [255, 255, 255, 255]) && near(await px(75, 50), [255, 0, 0, 255]), `black did not hide ${await px(25, 50)}`)
  await selectRect(0, 0, 50, 50)
  await A('fillWith', '#808080')
  await A('deselect')
  const half = await px(25, 25)
  expect(near(half, [255, 128, 128, 255], 3), `grey ${half}`)
  // White brush via the mouse reveals
  await setFg('#ffffff')
  await win.keyboard.press('b')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, brush: { ...s.options.brush, size: 16, hardness: 100, opacity: 100, flow: 100 } } })))
  await drag([[10, 75], [40, 75]])
  expect(near(await px(25, 75), [255, 0, 0, 255]), `white brush did not reveal ${await px(25, 75)}`)
  expect(near(await px(25, 90), [255, 255, 255, 255]), 'brush leaked')
  // Pixels of the layer are untouched by mask painting
  const l = (await doc()).layers[1]
  expect(Object.keys(l.content.tiles).length > 0 && l.mask && Object.keys(l.mask.tiles).length > 0, 'pixels or mask tiles missing')
  return `grey → ${half}`
})

await check('mask disable, invert (Ctrl+I on mask) and Ctrl+\\ target toggle', async () => {
  const id = (await doc()).activeLayerId
  await A('setMaskEnabled', id, false)
  expect(near(await px(25, 90), [255, 0, 0, 255]), 'disabled mask still hides')
  await A('setMaskEnabled', id, true)
  await win.keyboard.press('Control+i')
  await settle()
  expect(near(await px(25, 90), [255, 0, 0, 255]) && near(await px(75, 50), [255, 255, 255, 255]), 'invert mask')
  await win.keyboard.press('Control+Backslash')
  expect((await doc()).target === 'pixels', 'target toggle')
  await win.keyboard.press('Control+i')
  await settle()
  expect(near(await px(25, 90), [0, 255, 255, 255]), `Ctrl+I on pixels ${await px(25, 90)}`)
})

await check('apply mask bakes it into pixels without changing the image', async () => {
  const pts = [[25, 25], [25, 90], [75, 50], [25, 75]]
  const before = await Promise.all(pts.map(([x, y]) => px(x, y)))
  await A('applyLayerMask')
  const d = await doc()
  expect(!d.layers[1].mask, 'mask still there')
  const after = await Promise.all(pts.map(([x, y]) => px(x, y)))
  before.forEach((b, i) => expect(near(b, after[i], 1), `${pts[i]}: ${b} → ${after[i]}`))
})

await check('mask from selection; moving the layer moves its mask', async () => {
  await newDoc(100, 100)
  await A('newLayer')
  await A('fillWith', '#0000ff')
  await selectRect(10, 10, 20, 20)
  await A('addLayerMask', 'revealSelection')
  expect(!(await doc()).selection, 'selection should be consumed')
  expect(near(await px(20, 20), [0, 0, 255, 255]) && near(await px(50, 50), [255, 255, 255, 255]), 'reveal selection')
  await win.keyboard.press('v')
  await settle()
  await drag([[20, 20], [60, 60]])
  expect(near(await px(60, 60), [0, 0, 255, 255]) && near(await px(20, 20), [255, 255, 255, 255]), `mask did not move: ${await px(60, 60)} ${await px(20, 20)}`)
})

await check('adjustment layer mask limits the adjustment', async () => {
  await newDoc(100, 100)
  await A('fillWith', '#ff0000')
  await A('newAdjustmentLayer', 'invert')
  await selectRect(0, 0, 50, 100)
  await A('addLayerMask', 'hideSelection')
  expect(near(await px(25, 50), [255, 0, 0, 255]) && near(await px(75, 50), [0, 255, 255, 255]), `${await px(25, 50)} ${await px(75, 50)}`)
  // Merge Visible keeps the masked adjustment's result
  await A('mergeVisible')
  expect(near(await px(25, 50), [255, 0, 0, 255]) && near(await px(75, 50), [0, 255, 255, 255]), 'merge visible lost the mask')
})

// ---------------------------------------------------------------- transform
const TF = (name, ...args) => ev(([name, args]) => window.__cadencePlus.TF[name](...args), [name, args])
const tparams = () => ev(() => window.__cadencePlus.get().transform?.params ?? null)

await check('Free Transform (Ctrl+T) scales about the centre; Enter commits; undo restores', async () => {
  await newDoc(100, 100, 'transparent')
  await selectRect(10, 10, 20, 20)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await win.keyboard.press('Control+t')
  const p = await tparams()
  expect(p && p.cx === 20 && p.cy === 20, `params ${JSON.stringify(p)}`)
  await TF('updateTransform', { ...p, sx: 2, sy: 2 })
  await win.keyboard.press('Enter')
  await settle()
  expect(!(await ev(() => window.__cadencePlus.get().transform)), 'still transforming')
  expect(near(await px(35, 35), [255, 0, 0, 255]) && near(await px(1, 1), [255, 0, 0, 255]), `scaled ${await px(35, 35)}`)
  expect((await px(45, 45))[3] === 0, 'too big')
  await win.keyboard.press('Control+z')
  await settle()
  expect((await px(35, 35))[3] === 0 && near(await px(15, 15), [255, 0, 0, 255]), 'undo')
})

await check('drag a corner handle (proportional) with the mouse', async () => {
  await newDoc(100, 100, 'transparent')
  await selectRect(20, 20, 20, 20)
  await A('fillWith', '#00ff00')
  await A('deselect')
  await win.keyboard.press('Control+t')
  await settle()
  await drag([[40, 40], [60, 60]])
  await win.keyboard.press('Enter')
  await settle()
  expect(near(await px(55, 55), [0, 255, 0, 255]) && near(await px(22, 22), [0, 255, 0, 255]), `grown ${await px(55, 55)}`)
  expect((await px(65, 65))[3] === 0 && (await px(15, 15))[3] === 0, 'anchor moved or overshoot')
})

await check('Edit → Transform → Rotate 90° is pixel-exact', async () => {
  await newDoc(60, 40, 'transparent')
  await selectRect(10, 10, 20, 20)
  await A('fillWith', '#ff0000')
  await selectRect(30, 10, 20, 20)
  await A('fillWith', '#0000ff')
  await A('deselect')
  await ev(() => window.__cadencePlus.run('edit.transform.rot90'))
  await settle()
  const top = await px(30, 19)
  const bottom = await px(30, 20)
  expect(near(top, [255, 0, 0, 255], 0) && near(bottom, [0, 0, 255, 255], 0), `edge ${top} / ${bottom}`)
  expect((await px(15, 20))[3] === 0, 'old content left behind')
})

await check('Move tool with a selection moves only the selected pixels', async () => {
  await newDoc(100, 60, 'transparent')
  await selectRect(0, 0, 40, 40)
  await A('fillWith', '#ff0000')
  await selectRect(10, 10, 10, 10)
  await win.keyboard.press('v')
  await drag([[15, 15], [55, 15]])
  expect(!(await ev(() => window.__cadencePlus.get().transform)), 'float not committed')
  expect((await px(15, 15))[3] === 0, `hole missing ${await px(15, 15)}`)
  expect(near(await px(55, 15), [255, 0, 0, 255], 0) && near(await px(5, 5), [255, 0, 0, 255], 0), 'moved pixels')
  const d = await doc()
  expect(!!d.selection && d.layers.length === 1, 'selection should follow; no extra layer')
})

await check('Esc cancels a transform without touching history', async () => {
  const rev = await ev(() => window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.revision)
  await win.keyboard.press('Control+t')
  const p = await tparams()
  await TF('updateTransform', { ...p, rot: 1 })
  await win.keyboard.press('Escape')
  await settle()
  const rev2 = await ev(() => window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.revision)
  expect(rev === rev2 && !(await ev(() => window.__cadencePlus.get().transform)), 'changed')
})

await check('the layer mask moves with a whole-layer transform', async () => {
  await newDoc(120, 40)
  await A('newLayer')
  await selectRect(0, 0, 40, 40)
  await A('fillWith', '#ff0000')
  await selectRect(0, 0, 20, 40)
  await A('addLayerMask', 'hideSelection')
  await A('selectLayer', (await doc()).activeLayerId, 'pixels')
  await win.keyboard.press('Control+t')
  const p = await tparams()
  await TF('updateTransform', { ...p, cx: p.cx + 60 })
  await win.keyboard.press('Enter')
  await settle()
  expect(near(await px(90, 20), [255, 0, 0, 255]) && near(await px(70, 20), [255, 255, 255, 255]) && near(await px(30, 20), [255, 255, 255, 255]), `${await px(90, 20)} ${await px(70, 20)} ${await px(30, 20)}`)
})

// ---------------------------------------------------------------- levels & curves
await check('Levels and Curves adjustment layers (GPU lookup tables)', async () => {
  await newDoc(40, 40)
  await A('fillWith', '#808080')
  await A('newAdjustmentLayer', 'levels')
  const id = (await doc()).activeLayerId
  await A('setAdjustmentParams', id, { kind: 'levels', params: { inBlack: 0, inWhite: 128, gamma: 1, outBlack: 0, outWhite: 255 } })
  const lv = await px(5, 5)
  expect(near(lv, [255, 255, 255, 255], 0), `levels ${lv}`)
  await A('setAdjustmentParams', id, { kind: 'levels', params: { inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 } })
  const g = await px(5, 5)
  const want = Math.round(Math.sqrt(128 / 255) * 255)
  expect(Math.abs(g[0] - want) <= 1, `gamma ${g[0]} vs ${want}`)
  await A('deleteLayer', id)
  await A('newAdjustmentLayer', 'curves')
  const cid = (await doc()).activeLayerId
  await A('setAdjustmentParams', cid, { kind: 'curves', params: {}, curves: { rgb: [0, 255, 255, 0] } })
  const inv = await px(5, 5)
  expect(near(inv, [127, 127, 127, 255], 0), `curve invert ${inv}`)
  await A('setAdjustmentParams', cid, { kind: 'curves', params: {}, curves: { rgb: [0, 0, 255, 255], r: [0, 0, 255, 0] } })
  const red = await px(5, 5)
  expect(red[0] === 0 && red[1] === 128 && red[2] === 128, `red channel curve ${red}`)
  return `levels ${lv[0]}, gamma ${g[0]}, curve ${inv[0]}`
})

await check('Curves dialog (Ctrl+M): drag a point, preview, OK applies', async () => {
  await newDoc(40, 40)
  await A('fillWith', '#808080')
  await win.keyboard.press('Control+m')
  await win.waitForSelector('.curve-graph')
  const r = await win.locator('.curve-graph').boundingBox()
  // Add a point at input 128 and drag it up to output ~192.
  const x = r.x + (128 / 255) * r.width
  await win.mouse.move(x, r.y + r.height * (1 - 128 / 255))
  await win.mouse.down()
  await win.mouse.move(x, r.y + r.height * (1 - 192 / 255), { steps: 6 })
  await win.mouse.up()
  await settle(200)
  const preview = await ev(() => window.__cadencePlus.get().filterPreview?.op instanceof Uint8Array)
  expect(preview, 'no LUT preview')
  expect(near(await px(5, 5), [128, 128, 128, 255]), 'preview changed pixels')
  await win.click('.modal .btn.primary')
  await settle()
  const p = await px(5, 5)
  expect(Math.abs(p[0] - 192) <= 2 && p[0] === p[1], `curves applied ${p}`)
  const label = await ev(() => window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.presentLabel)
  expect(label === 'Curves', `history label ${label}`)
  return `${p[0]}`
})

// ---------------------------------------------------------------- type & shapes
const dark = (x, y, w, h) => ev(([x, y, w, h]) => window.__cadencePlus.darkCount(x, y, w, h), [x, y, w, h])
const histLabel = () => ev(() => window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.presentLabel)
const pastLen = () => ev(() => window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.past.length)

await check('Type tool: click, type, Ctrl+Enter makes one "Type Layer" step', async () => {
  await newDoc(400, 200)
  await setFg('#000000')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, text: { ...s.options.text, size: 60, font: 'Arial' } } })))
  const steps = await pastLen()
  await win.keyboard.press('t')
  const c = await client(20, 100)
  await win.mouse.click(c.x, c.y)
  await win.waitForSelector('.text-edit')
  await win.keyboard.type('Hello', { delay: 20 })
  await win.keyboard.press('Control+Enter')
  await settle()
  const d = await doc()
  const l = d.layers[d.layers.length - 1]
  expect(l.content.type === 'text' && l.content.text.text === 'Hello' && l.name === 'Hello', `layer ${l.name} ${l.content.type}`)
  expect((await pastLen()) === steps + 1 && (await histLabel()) === 'Type Layer', `history ${await histLabel()}`)
  const n = await dark(20, 40, 200, 70)
  expect(n > 300, `ink pixels ${n}`)
  expect((await dark(250, 40, 100, 70)) === 0, 'ink beyond the word')
  return `${n} ink pixels`
})

await check('Esc on new type leaves no layer and no history', async () => {
  const before = (await doc()).layers.length
  const steps = await pastLen()
  const c = await client(20, 180)
  await win.mouse.click(c.x, c.y)
  await win.waitForSelector('.text-edit')
  await win.keyboard.type('nope')
  await win.keyboard.press('Escape')
  await settle()
  expect((await doc()).layers.length === before && (await pastLen()) === steps, 'cancel left traces')
})

await check('clicking existing type edits it; the box grows from its left edge', async () => {
  const id0 = (await doc()).layers.find((l) => l.content.type === 'text').id
  const left0 = await ev((id) => {
    const l = window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId).history.present.layers.find((x) => x.id === id)
    return l.content.params.cx
  }, id0)
  const c = await client(40, 80)
  await win.mouse.click(c.x, c.y)
  await win.waitForSelector('.text-edit')
  await win.keyboard.press('End')
  await win.keyboard.type(' World')
  await win.keyboard.press('Control+Enter')
  await settle()
  const l = (await doc()).layers.find((x) => x.id === id0)
  expect(l.content.text.text === 'Hello World', `text ${l.content.text.text}`)
  expect(l.content.params.cx > left0, 'centre should move right as the box grows')
  expect((await dark(20, 40, 30, 70)) > 50, 'left edge moved')
  expect((await histLabel()) === 'Edit Type', `label ${await histLabel()}`)
})

await check('Shape tool: rectangle, ellipse and line', async () => {
  await newDoc(300, 200)
  await setFg('#ff0000')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, shape: { ...s.options.shape, kind: 'rect', fill: true, stroke: false } } })))
  await win.keyboard.press('u')
  await drag([[20, 20], [80, 60]])
  expect(near(await px(50, 40), [255, 0, 0, 255]) && near(await px(90, 40), [255, 255, 255, 255]), 'rect')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, shape: { ...s.options.shape, kind: 'ellipse' } } })))
  await drag([[100, 20], [180, 100]])
  expect(near(await px(140, 60), [255, 0, 0, 255]) && near(await px(102, 22), [255, 255, 255, 255]), 'ellipse corner should stay empty')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, shape: { ...s.options.shape, kind: 'line', strokeWidth: 6 } } })))
  await setFg('#0000ff')
  await drag([[20, 150], [280, 150]])
  expect(near(await px(150, 150), [0, 0, 255, 255]) && near(await px(150, 160), [255, 255, 255, 255]), 'line')
  const kinds = (await doc()).layers.filter((l) => l.content.type === 'shape').map((l) => l.content.shape.kind)
  expect(JSON.stringify(kinds) === '["rect","ellipse","line"]', `kinds ${kinds}`)
})

await check('Free Transform on a shape edits its placement (stays a vector)', async () => {
  const d = await doc()
  const rect = d.layers.find((l) => l.content.type === 'shape' && l.content.shape.kind === 'rect')
  await A('selectLayer', rect.id)
  await win.keyboard.press('Control+t')
  const p = await tparams()
  await TF('updateTransform', { ...p, sx: 2, sy: 2 })
  await win.keyboard.press('Enter')
  await settle()
  const l = (await doc()).layers.find((x) => x.id === rect.id)
  expect(l.content.type === 'shape' && l.content.params.sx === 2, 'not a vector any more')
  expect(near(await px(5, 5), [255, 0, 0, 255]) && near(await px(90, 70), [255, 0, 0, 255]), `scaled ${await px(5, 5)} ${await px(90, 70)}`)
})

await check('rasterize a type layer keeps its pixels', async () => {
  await newDoc(300, 120)
  await setFg('#000000')
  await win.keyboard.press('t')
  const c = await client(10, 80)
  await win.mouse.click(c.x, c.y)
  await win.waitForSelector('.text-edit')
  await win.keyboard.type('Raster')
  await win.keyboard.press('Control+Enter')
  await settle()
  const before = await dark(0, 0, 300, 120)
  await A('rasterizeActive')
  const d = await doc()
  expect(d.layers[d.layers.length - 1].content.type === 'raster', 'not rasterized')
  const after = await dark(0, 0, 300, 120)
  expect(Math.abs(before - after) <= 2, `ink ${before} → ${after}`)
})

await check('type survives save/reopen and canvas rotation as a vector', async () => {
  await newDoc(300, 120)
  await setFg('#000000')
  await win.keyboard.press('t')
  const c = await client(10, 80)
  await win.mouse.click(c.x, c.y)
  await win.waitForSelector('.text-edit')
  await win.keyboard.type('Saved')
  await win.keyboard.press('Control+Enter')
  await settle()
  const path = join(work, 'type.cadenceimg')
  await ev((p) => window.__cadencePlus.set((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? { ...d, path: p } : d)) })), path)
  expect(await D('save'), 'save')
  const ink = await dark(0, 0, 300, 120)
  await closeAllClean()
  await D('openPaths', [path])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
  await settle(300)
  const d = await doc()
  expect(d.layers[1].content.type === 'text' && d.layers[1].content.text.text === 'Saved', 'type lost')
  expect((await dark(0, 0, 300, 120)) === ink, 'pixels differ after reopen')
  await A('transformImage', { kind: 'rotate', turns: 1 }, 'Rotate')
  const r = await doc()
  expect(r.layers[1].content.type === 'text' && Math.abs(r.layers[1].content.params.rot - Math.PI / 2) < 1e-9, 'rotation')
  const ink2 = await dark(0, 0, 120, 300)
  expect(Math.abs(ink2 - ink) < ink * 0.05, `ink after rotation ${ink} → ${ink2}`)
})

// ---------------------------------------------------------------- groups
await check('groups: Pass Through vs isolated blending, group opacity', async () => {
  await newDoc(100, 100)
  await A('fillWith', '#ff0000')
  await A('newLayer')
  await selectRect(0, 0, 50, 100)
  await A('fillWith', '#00ff00')
  await A('deselect')
  const child = (await doc()).activeLayerId
  await A('setLayerBlend', child, 'multiply')
  await win.keyboard.press('Control+g')
  await settle()
  const g = (await doc()).activeLayerId
  expect((await doc()).layers.find((l) => l.id === g).content.type === 'group', 'no group')
  // Pass Through: the child multiplies with the red background → black
  expect(near(await px(25, 50), [0, 0, 0, 255]), `pass-through ${await px(25, 50)}`)
  // Normal (isolated): the child blends with nothing → stays green
  await A('setLayerBlend', g, 'normal')
  expect(near(await px(25, 50), [0, 255, 0, 255]), `isolated ${await px(25, 50)}`)
  await A('setLayerOpacity', g, 0.5)
  expect(near(await px(25, 50), [128, 128, 0, 255], 2), `group opacity ${await px(25, 50)}`)
  expect(near(await px(75, 50), [255, 0, 0, 255]), 'outside the child')
})

await check('hidden group hides its children and blocks painting into them', async () => {
  const d = await doc()
  const g = d.layers.find((l) => l.content.type === 'group').id
  const child = d.layers.find((l) => l.parent === g).id
  await A('setLayerVisible', g, false)
  expect(near(await px(25, 50), [255, 0, 0, 255]), 'still visible')
  await A('selectLayer', child)
  await A('fillWith', '#0000ff')
  expect(near(await px(25, 50), [255, 0, 0, 255]), 'painted into a hidden group')
  await A('setLayerVisible', g, true)
})

await check('Merge Group (Ctrl+E on a group) keeps the composite; Ungroup restores structure', async () => {
  const d = await doc()
  const g = d.layers.find((l) => l.content.type === 'group').id
  await A('selectLayer', g)
  const pts = [[25, 50], [75, 50]]
  const before = await Promise.all(pts.map(([x, y]) => px(x, y)))
  await win.keyboard.press('Control+e')
  await settle()
  const after = await Promise.all(pts.map(([x, y]) => px(x, y)))
  before.forEach((b, i) => expect(near(b, after[i], 1), `${pts[i]}: ${b} → ${after[i]}`))
  expect(!(await doc()).layers.some((l) => l.content.type === 'group'), 'group still there')
  await win.keyboard.press('Control+z')
  await settle()
  await A('selectLayer', g)
  await win.keyboard.press('Control+Shift+g')
  await settle()
  const d2 = await doc()
  expect(!d2.layers.some((l) => l.content.type === 'group') && d2.layers.every((l) => !l.parent), 'ungroup')
})

await check('drag a layer into a group in the Layers panel; move the group with the Move tool', async () => {
  await newDoc(100, 100, 'transparent')
  await selectRect(0, 0, 10, 10)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await A('newGroup')
  const g = (await doc()).activeLayerId
  await A('setCollapsed', g, false)
  await settle()
  const src = await win.locator('.layer-row', { hasText: 'Layer 1' }).boundingBox()
  const dst = await win.locator('.layer-row', { hasText: 'Group 1' }).boundingBox()
  await win.mouse.move(src.x + 150, src.y + src.height / 2)
  await win.mouse.down()
  await win.mouse.move(dst.x + 150, dst.y + dst.height / 2, { steps: 8 })
  await win.mouse.up()
  await settle()
  const d = await doc()
  expect(d.layers.find((l) => l.name === 'Layer 1').parent === g, 'not moved into the group')
  expect((await win.locator('.layer-row', { hasText: 'Layer 1' }).locator('.indent').count()) === 1, 'not indented')
  await A('selectLayer', g)
  await win.keyboard.press('v')
  await drag([[5, 5], [45, 25]])
  expect(near(await px(45, 25), [255, 0, 0, 255]) && (await px(5, 5))[3] === 0, `group move ${await px(45, 25)}`)
})

await check('groups survive save and reopen', async () => {
  const path = join(work, 'groups.cadenceimg')
  await ev((p) => window.__cadencePlus.set((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? { ...d, path: p } : d)) })), path)
  expect(await D('save'), 'save')
  const shape = (await doc()).layers.map((l) => [l.name, l.content.type, l.parent ? 1 : 0])
  await closeAllClean()
  await D('openPaths', [path])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
  await settle(300)
  const d = await doc()
  const g = d.layers.find((l) => l.content.type === 'group')
  expect(g && d.layers.find((l) => l.name === 'Layer 1').parent === g.id, 'group structure lost')
  expect(near(await px(45, 25), [255, 0, 0, 255]), 'pixels')
  return `${shape.length} layers`
})

// ---------------------------------------------------------------- clone & heal
await check('Clone Stamp: Alt+click source, aligned offset between strokes', async () => {
  await newDoc(200, 100)
  await selectRect(10, 10, 20, 20)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, clone: { ...s.options.clone, size: 10, hardness: 100, opacity: 100, flow: 100, aligned: true } } })))
  await win.keyboard.press('s')
  const src = await client(20, 20)
  await win.keyboard.down('Alt')
  await win.mouse.click(src.x, src.y)
  await win.keyboard.up('Alt')
  await drag([[120, 20], [124, 20]])
  expect(near(await px(122, 20), [255, 0, 0, 255]), `cloned ${await px(122, 20)}`)
  // Aligned: the next stroke keeps the +100 px offset, so it samples white.
  await drag([[150, 70], [154, 70]])
  expect(near(await px(152, 70), [255, 255, 255, 255]), 'aligned stroke should sample white')
  // Not aligned: every stroke starts again from the source point.
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, clone: { ...s.options.clone, aligned: false } } })))
  await drag([[170, 70], [172, 70]])
  expect(near(await px(170, 70), [255, 0, 0, 255]), `non-aligned ${await px(170, 70)}`)
})

await check('Healing Brush keeps the destination tone (clone would not)', async () => {
  await newDoc(200, 100)
  await selectRect(0, 0, 100, 100)
  await A('fillWith', '#c8c8c8')
  await selectRect(100, 0, 100, 100)
  await A('fillWith', '#3c3c3c')
  await A('deselect')
  await ev(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, heal: { ...s.options.heal, size: 30, hardness: 100, opacity: 100, flow: 100 } } })))
  await win.keyboard.press('j')
  const src = await client(150, 50)
  await win.keyboard.down('Alt')
  await win.mouse.click(src.x, src.y)
  await win.keyboard.up('Alt')
  await drag([[45, 50], [55, 50]])
  const p = await px(50, 50)
  expect(Math.abs(p[0] - 200) <= 12, `healed ${p} (clone would give 60)`)
  expect((await histLabel()) === 'Healing Brush', 'label')
  return `${p[0]}`
})

await check('rebind shortcuts: record, conflicts move, saved to settings, reset', async () => {
  await ev(() => window.__cadencePlus.set({ tool: 'hand' }))
  await win.keyboard.press('Control+/')
  await win.waitForSelector('.shortcut-row[data-command="tool.brush"]')
  await win.fill('.shortcut-tools input', 'brush')
  await win.click('.shortcut-row[data-command="tool.brush"] button[title="Add a shortcut"]')
  await win.keyboard.press('Alt+b')
  await settle()
  // Now steal M from the Marquee tool.
  await win.click('.shortcut-row[data-command="tool.brush"] button[title="Add a shortcut"]')
  await win.keyboard.press('m')
  await settle()
  const note = await win.locator('.shortcut-tools .note').innerText()
  expect(/moved from/.test(note), `note: ${note}`)
  await win.click('.modal .btn.primary')
  await settle()
  await win.keyboard.press('Alt+b')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'brush', 'Alt+B did not select the brush')
  await ev(() => window.__cadencePlus.set({ tool: 'hand' }))
  await win.keyboard.press('m')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'brush', 'M should now select the brush')
  const saved = await ev(() => window.cadencePlus.getSettings().then((s) => s.keymap))
  expect(saved['tool.brush'].includes('Alt+B') && !saved['tool.marquee'].includes('M'), JSON.stringify(saved))
  await win.keyboard.press('Control+/')
  await win.waitForSelector('.shortcut-tools')
  await win.click('.modal .btn:has-text("Reset All")')
  await win.click('.modal .btn.primary')
  await win.keyboard.press('m')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'marquee', 'reset')
})

// ---------------------------------------------------------------- colour management
const pixF = (x, y, space = 'srgb') => ev(([x, y, s]) => window.__cadencePlus.pixelF(x, y, s), [x, y, space])
const distinct = (y, x0, x1) => ev(([y, a, b]) => window.__cadencePlus.distinctRed(y, a, b), [y, x0, x1])
const newDocColor = async (w, h, color, background = 'white') => {
  await ev(([w, h, c, bg]) => window.__cadencePlus.D.newDocument({ name: 'Colour', width: w, height: h, resolution: 72, background: bg, color: c }), [w, h, color, background])
  await win.waitForFunction(() => !!window.__cadencePlus.get().docs.find((d) => d.id === window.__cadencePlus.get().activeId)?.view)
  await settle()
}

await check('16-bit document keeps smooth gradients (more than 256 levels)', async () => {
  await newDocColor(1024, 8, { depth: 16, space: 'srgb' })
  await ev(() => window.__cadencePlus.set({ fg: '#000000', bg: '#ffffff' }))
  await A('gradientFill', 0, 4, 1024, 4)
  const n = await distinct(4, 0, 1024)
  expect(n > 300, `distinct levels ${n}`)
  return `${n} levels`
})

await check('16-bit: Levels keeps precision; save/reopen and 16-bit PNG export are exact; Mode → 8 bits quantizes', async () => {
  const id = (await doc()).activeLayerId
  await A('newAdjustmentLayer', 'levels')
  await A('setAdjustmentParams', (await doc()).activeLayerId, { kind: 'levels', params: { inBlack: 0, inWhite: 255, gamma: 1.6, outBlack: 0, outWhite: 255 } })
  const nl = await distinct(4, 0, 1024)
  expect(nl > 300, `levels banded: ${nl}`)
  await A('mergeVisible')
  const before = await distinct(4, 0, 1024)
  const proj = join(work, 'deep.cadenceimg')
  await ev((p) => window.__cadencePlus.set((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? { ...d, path: p } : d)) })), proj)
  expect(await D('save'), 'save')
  const png16 = join(work, 'deep.png')
  expect(await D('exportTo', png16, 'png', 1, { sixteenBit: true }), 'export')
  const bytes = Array.from(readFileSync(png16).subarray(24, 26))
  expect(bytes[0] === 16, `PNG bit depth ${bytes[0]}`)
  await closeAllClean()
  await D('openPaths', [proj])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
  await settle(300)
  expect((await doc()).color?.depth === 16, 'reopened depth')
  expect((await distinct(4, 0, 1024)) === before, 'project lost precision')
  await D('openPaths', [png16])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 2)
  await settle(300)
  expect((await doc()).color?.depth === 16, 'PNG reopened as 8-bit')
  expect((await distinct(4, 0, 1024)) === before, `16-bit PNG round trip ${await distinct(4, 0, 1024)} vs ${before}`)
  await ev(() => window.__cadencePlus.run('image.mode8'))
  const n8 = await distinct(4, 0, 1024)
  expect(n8 <= 256 && (await doc()).color === undefined, `8-bit ${n8}`)
  await win.keyboard.press('Control+z')
  await settle()
  expect((await distinct(4, 0, 1024)) === before, 'undo of mode change')
  void id
  return `${before} levels`
})

await check('Display P3: sRGB colours convert; P3-only colours survive; profile embedded; Convert to sRGB clips', async () => {
  await closeAllClean()
  await newDocColor(64, 64, { depth: 8, space: 'display-p3' })
  await A('fillWith', '#ff0000')
  const p3 = await pixF(5, 5, 'display-p3')
  const s = await pixF(5, 5, 'srgb')
  expect(Math.abs(p3[0] - 0.917) < 0.01 && Math.abs(p3[1] - 0.2) < 0.02 && Math.abs(s[0] - 1) < 0.01 && s[1] < 0.01, `p3 ${p3} srgb ${s}`)
  // A P3 image with pure P3 green, written by Chromium, then opened.
  const green = join(work, 'p3-green.png')
  const bytes = await ev(async () => {
    const c = new OffscreenCanvas(16, 16)
    const g = c.getContext('2d', { colorSpace: 'display-p3' })
    g.fillStyle = 'color(display-p3 0 1 0)'
    g.fillRect(0, 0, 16, 16)
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()))
  })
  writeFileSync(green, Buffer.from(bytes))
  await D('openPaths', [green])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 2)
  await settle(300)
  expect((await doc()).color?.space === 'display-p3', 'opened as sRGB')
  const g = await pixF(5, 5, 'display-p3')
  expect(g[0] < 0.01 && g[1] > 0.99 && g[2] < 0.01, `P3 green lost: ${g}`)
  const out = join(work, 'p3-out.png')
  expect(await D('exportTo', out, 'png', 1), 'export')
  const hasIcc = readFileSync(out).includes('iCCP')
  expect(hasIcc, 'no embedded profile in the P3 export')
  await ev(() => window.__cadencePlus.run('image.toSrgb'))
  const c = await pixF(5, 5, 'display-p3')
  expect(c[0] > 0.2 && (await doc()).color === undefined, `not clipped to sRGB: ${c}`)
  return `P3 green ${g.slice(0, 3).map((v) => v.toFixed(3))} → sRGB-clipped ${c.slice(0, 3).map((v) => v.toFixed(3))}`
})

await check('soft proofing and gamut warning change the display only', async () => {
  await closeAllClean()
  await D('openPaths', [join(work, 'p3-green.png')])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
  await settle(400)
  const screen = () => ev(() => window.__cadencePlus.screenPixel(8, 8))
  const base = await screen()
  await win.keyboard.press('Control+Shift+y')
  await settle(300)
  const warned = await screen()
  expect(near(warned, [128, 128, 128, 255], 3), `gamut warning ${warned}`)
  await win.keyboard.press('Control+Shift+y')
  await win.keyboard.press('Control+y')
  await settle(300)
  const proofed = await screen()
  expect(proofed[0] > 90 && proofed[2] > 50 && proofed[1] > 240, `sRGB proof ${proofed} (base ${base})`)
  await ev(() => window.__cadencePlus.run('view.proof.gray'))
  await settle(300)
  const grey = await screen()
  expect(Math.abs(grey[0] - grey[1]) <= 1 && Math.abs(grey[1] - grey[2]) <= 1, `grey ${grey}`)
  await ev(() => window.__cadencePlus.run('view.proof.deuteranopia'))
  await settle(300)
  const deut = await screen()
  expect(Math.abs(deut[0] - deut[1]) < 60, `deuteranopia should pull red and green together: ${deut}`)
  const title = await win.locator('.titlebar .center').innerText()
  expect(/deuteranopia/.test(title), `title ${title}`)
  await win.keyboard.press('Control+y')
  await settle(300)
  expect(near(await screen(), base, 2), 'proof off should restore the display')
  expect(near(await pixF(8, 8, 'display-p3'), [0, 1, 0, 1], 0.01), 'proofing changed the document')
  return `warn ${warned.slice(0, 3)} · sRGB ${proofed.slice(0, 3)} · grey ${grey.slice(0, 3)} · deut ${deut.slice(0, 3)}`
})

const openOne = async (path) => {
  const n = await ev(() => window.__cadencePlus.get().docs.length)
  await D('openPaths', [path])
  await win.waitForFunction((n) => window.__cadencePlus.get().docs.length === n + 1, n, { timeout: 30000 })
  await settle(300)
}

await check('PSD import: layers, pass-through group, mask, blend, opacity, adjustment layers', async () => {
  await closeAllClean()
  const path = join(work, 'sample.psd')
  writeFileSync(path, makePsd())
  await openOne(path)
  const d = await doc()
  const names = d.layers.map((l) => `${l.name}:${l.content.type}`).join(', ')
  const byName = Object.fromEntries(d.layers.map((l) => [l.name, l]))
  expect(byName.Group?.content.type === 'group' && byName.Group.blend === 'pass-through', `group: ${names}`)
  expect(byName.Blue?.parent === byName.Group.id && byName.Blue.blend === 'multiply' && Math.abs(byName.Blue.opacity - 0.5) < 0.01 && !!byName.Blue.mask, `blue layer: ${JSON.stringify({ ...byName.Blue, content: undefined })}`)
  expect(byName.Invert?.content.type === 'adjustment' && !byName.Invert.visible && byName.Levels?.content.type === 'adjustment', `adjustments: ${names}`)
  expect(d.layers.indexOf(byName.Background) < d.layers.indexOf(byName.Levels), `order: ${names}`)
  const masked = await px(20, 30)
  const shown = await px(40, 30)
  expect(near(masked, [255, 0, 0, 255]), `masked half ${masked}`)
  expect(near(shown, [128, 0, 0, 255], 2), `multiply 50% ${shown}`)
  return names
})

await check('PSD export keeps layers, groups and masks (read back by ag-psd and by Cadence+)', async () => {
  const want = [await px(20, 30), await px(40, 30), await px(5, 5)]
  const out = join(work, 'roundtrip.psd')
  expect(await D('exportTo', out, 'psd', 1), 'export')
  const psd = readPsd(readFileSync(out), { useImageData: true, skipThumbnail: true })
  const top = psd.children.map((c) => c.name)
  const group = psd.children.find((c) => c.name === 'Group')
  const blue = group?.children?.[0]
  expect(top.join() === 'Background,Group,Invert,Levels', `top level ${top}`)
  expect(blue?.name === 'Blue' && blue.blendMode === 'multiply' && Math.abs(blue.opacity - 0.5) < 0.01 && !!blue.mask?.imageData, `blue ${JSON.stringify({ ...blue, imageData: undefined, mask: !!blue?.mask })}`)
  expect(group.blendMode === 'pass through', `group blend ${group.blendMode}`)
  await openOne(out)
  const got = [await px(20, 30), await px(40, 30), await px(5, 5)]
  got.forEach((g, i) => expect(near(g, want[i], 1), `pixel ${i}: ${want[i]} → ${g}`))
  return `layers ${top.join(', ')}`
})

await check('TIFF: 16-bit import keeps 16 bits; 16-bit TIFF export round-trips; 8-bit alpha TIFF', async () => {
  await closeAllClean()
  const t16 = join(work, 'ramp16.tif')
  writeFileSync(t16, makeTiff16())
  await openOne(t16)
  expect((await doc()).color?.depth === 16, 'not 16-bit')
  const levels = await distinct(4, 0, 1024)
  expect(levels > 900, `levels ${levels}`)
  const g = await pixF(512, 4)
  expect(Math.abs(g[1] - 0.25) < 0.002, `green ${g}`)
  const out = join(work, 'ramp16-out.tif')
  expect(await D('exportTo', out, 'tiff', 1, { sixteenBit: true }), 'export')
  await openOne(out)
  const back = await distinct(4, 0, 1024)
  expect(back === levels && (await doc()).color?.depth === 16, `round trip ${back} vs ${levels}`)
  const t8 = join(work, 'alpha8.tif')
  writeFileSync(t8, makeTiff8())
  await openOne(t8)
  const on = await px(5, 5)
  const off = await px(25, 5)
  expect(near(on, [0, 200, 0, 255]) && off[3] === 0, `8-bit ${on} / ${off}`)
  return `${levels} levels in, ${back} after export`
})

await check('camera RAW (DNG) develops with LibRaw into 16-bit Display P3', async () => {
  await closeAllClean()
  const dng = join(work, 'synthetic.dng')
  writeFileSync(dng, makeDng())
  await openOne(dng)
  const d = await doc()
  expect(d.color?.depth === 16 && d.color?.space === 'display-p3' && d.width === 64 && d.height === 64, `color ${JSON.stringify(d.color)} ${d.width}×${d.height}`)
  const grey = await pixF(10, 10)
  const red = await pixF(50, 10)
  const spread = Math.max(...grey.slice(0, 3)) - Math.min(...grey.slice(0, 3))
  expect(spread < 0.02 && grey[0] > 0.35 && grey[0] < 0.6, `grey ${grey}`)
  expect(red[0] > 0.6 && red[1] < 0.05 && red[2] < 0.05, `red ${red}`)
  return `18% grey → ${grey[0].toFixed(3)}, linear red 0.5 → ${red.slice(0, 3).map((v) => v.toFixed(3))}`
})

// ---------------------------------------------------------------------------
// Phase 6: retouching tools and filters
// ---------------------------------------------------------------------------

const grey = async (w, h, v) => {
  await closeAllClean()
  await newDoc(w, h)
  const hex = '#' + v.toString(16).padStart(2, '0').repeat(3)
  await A('fillWith', hex)
}
const setOpt = (tool, patch) => ev(([tool, patch]) => window.__cadencePlus.set((s) => ({ options: { ...s.options, [tool]: { ...s.options[tool], ...patch } } })), [tool, patch])
const lastLabel = async () => ev(() => {
  const s = window.__cadencePlus.get()
  return s.docs.find((d) => d.id === s.activeId).history.presentLabel
})

await check('Unsharp Mask (Filter → Sharpen) adds edge contrast; flat areas unchanged', async () => {
  await grey(64, 64, 100)
  await selectRect(32, 0, 32, 64)
  await A('fillWith', '#969696')
  await A('deselect')
  await ev(() => window.__cadencePlus.run('filter.unsharp'))
  await win.waitForSelector('.modal >> text=Unsharp Mask')
  await settle(200)
  await win.keyboard.press('Enter')
  await settle(200)
  expect((await lastLabel()) === 'Unsharp Mask', `label ${await lastLabel()}`)
  const l = await px(31, 32)
  const r = await px(32, 32)
  const far = await px(8, 32)
  expect(l[0] < 100 && r[0] > 150 && near(far, [100, 100, 100, 255], 1), `edge ${l} | ${r}, far ${far}`)
  return `edge 100|150 → ${l[0]}|${r[0]}`
})

await check('High Pass, Add Noise and Motion Blur (GPU filters)', async () => {
  await grey(64, 64, 100)
  await A('applyFilter', { shader: 'highPass', params: { radius: 4 } }, 'High Pass')
  const hp = await px(32, 32)
  expect(near(hp, [128, 128, 128, 255], 1), `high pass on flat grey ${hp}`)
  await grey(64, 64, 128)
  await A('applyFilter', { shader: 'noise', params: { amount: 0.2, gaussian: 0, mono: 1, seed: 7 } }, 'Add Noise')
  const row = await Promise.all(Array.from({ length: 32 }, (_, i) => px(i, 10)))
  const vals = new Set(row.map((p) => p[0]))
  const mean = row.reduce((a, p) => a + p[0], 0) / row.length
  expect(vals.size > 12 && Math.abs(mean - 128) < 12 && row.every((p) => p[0] === p[1] && p[1] === p[2]), `noise ${vals.size} levels, mean ${mean}`)
  await closeAllClean()
  await newDoc(64, 64, 'black')
  await setFg('#ffffff')
  await selectRect(32, 0, 1, 64)
  await A('fillWith', '#ffffff')
  await A('deselect')
  await A('applyFilter', { shader: 'motionBlur', params: { angle: 0, dist: 10 } }, 'Motion Blur')
  const side = await px(36, 32)
  const line = await px(32, 32)
  const off = await px(45, 32)
  expect(side[0] > 10 && line[0] < 200 && off[0] < 3, `motion blur: line ${line} side ${side} off ${off}`)
  return `noise ${vals.size} levels (mean ${mean.toFixed(1)}); motion blur line ${line[0]} → side ${side[0]}`
})

await check('Dodge and Burn lighten/darken by mouse; Sponge desaturates', async () => {
  await grey(200, 100, 128)
  await win.keyboard.press('o')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'dodge', 'O did not pick Dodge')
  await setOpt('dodge', { size: 30, hardness: 100, strength: 50, range: 'midtones' })
  await drag([[20, 30], [180, 30]])
  const d = await px(100, 30)
  const untouched = await px(100, 80)
  expect(d[0] > 150 && d[0] < 255 && near(untouched, [128, 128, 128, 255], 0), `dodge ${d} / ${untouched}`)
  expect((await lastLabel()) === 'Dodge', `label ${await lastLabel()}`)
  await win.keyboard.press('Shift+O')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'burn', 'Shift+O did not cycle to Burn')
  await setOpt('burn', { size: 30, hardness: 100, strength: 50, range: 'midtones' })
  await drag([[20, 70], [180, 70]])
  const b = await px(100, 70)
  expect(b[0] < 110 && b[0] > 0, `burn ${b}`)
  // Sponge (desaturate) on a saturated red.
  await closeAllClean()
  await newDoc(200, 100)
  await A('fillWith', '#c83232')
  await win.keyboard.press('Shift+O')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'sponge', 'Shift+O did not cycle to Sponge')
  await setOpt('sponge', { size: 30, hardness: 100, strength: 80, desaturate: true })
  await drag([[20, 50], [180, 50]])
  const sp = await px(100, 50)
  expect(sp[0] - sp[1] < 100 && sp[0] - sp[1] > 0, `sponge ${sp} (was 200,50,50)`)
  return `dodge 128 → ${d[0]}, burn 128 → ${b[0]}, sponge 200,50,50 → ${sp.slice(0, 3)}`
})

await check('Blur and Sharpen tools soften / crisp an edge; Smudge drags colour', async () => {
  await grey(200, 100, 0)
  await selectRect(100, 0, 100, 100)
  await A('fillWith', '#ffffff')
  await A('deselect')
  await win.keyboard.press('r')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'blur', 'R did not pick Blur')
  await setOpt('blur', { size: 40, hardness: 100, strength: 100 })
  await drag([[100, 20], [100, 40]])
  const e1 = await px(98, 30)
  const e2 = await px(101, 30)
  const keep = await px(98, 80)
  expect(e1[0] > 20 && e2[0] < 235 && keep[0] === 0, `blur ${e1} ${e2} keep ${keep}`)
  // Sharpen on a soft ramp increases contrast across it.
  await closeAllClean()
  await newDoc(200, 100)
  await ev(() => {
    const A = window.__cadencePlus.A
    A.fillWith('#404040')
  })
  await selectRect(100, 0, 100, 100)
  await A('fillWith', '#c0c0c0')
  await A('deselect')
  await A('applyFilter', 'blur(3px)', 'Gaussian Blur')
  const before = [await px(97, 50), await px(103, 50)]
  await win.keyboard.press('Shift+R')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'sharpen', 'Shift+R did not cycle to Sharpen')
  await setOpt('sharpen', { size: 40, hardness: 100, strength: 100 })
  await drag([[100, 40], [100, 60]])
  const after = [await px(97, 50), await px(103, 50)]
  expect(after[0][0] < before[0][0] && after[1][0] > before[1][0], `sharpen ${before.map((p) => p[0])} → ${after.map((p) => p[0])}`)
  // Smudge: drag red into blue.
  await closeAllClean()
  await newDoc(200, 100)
  await A('fillWith', '#0000ff')
  await selectRect(0, 0, 100, 100)
  await A('fillWith', '#ff0000')
  await A('deselect')
  await win.keyboard.press('Shift+R')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'smudge', 'Shift+R did not cycle to Smudge')
  await setOpt('smudge', { size: 20, hardness: 100, strength: 80 })
  await drag([[80, 50], [130, 50]], 20)
  const sm = await px(115, 50)
  const blue = await px(115, 90)
  expect(sm[0] > 60 && near(blue, [0, 0, 255, 255], 0), `smudge ${sm} / ${blue}`)
  expect((await lastLabel()) === 'Smudge', `label ${await lastLabel()}`)
  return `blur edge ${e1[0]}|${e2[0]}; sharpen ${before.map((p) => p[0])} → ${after.map((p) => p[0])}; smudged ${sm.slice(0, 3)}`
})

await check('History Brush paints back the opening state (or a state chosen in the History panel)', async () => {
  await closeAllClean()
  await newDoc(200, 100)
  await setFg('#000000')
  await win.keyboard.press('b')
  await setOpt('brush', { size: 20, hardness: 100, opacity: 100, flow: 100 })
  await drag([[20, 50], [180, 50]])
  expect(near(await px(100, 50), [0, 0, 0, 255]), 'brush did not paint')
  await win.keyboard.press('y')
  await setOpt('historyBrush', { size: 30, hardness: 100, opacity: 100, flow: 100 })
  await drag([[90, 50], [110, 50]])
  const back = await px(100, 50)
  const still = await px(40, 50)
  expect(near(back, [255, 255, 255, 255], 1) && near(still, [0, 0, 0, 255], 1), `history brush ${back} / ${still}`)
  // Choose the "Brush" state as the source via the History panel: painting it back restores black.
  await ev(() => window.__cadencePlus.run('window.history')).catch(() => {})
  const rows = win.locator('.history-row')
  if ((await rows.count()) >= 2) {
    await rows.nth(1).hover()
    await rows.nth(1).locator('.history-src').click()
    await drag([[95, 50], [105, 50]])
    const black = await px(100, 50)
    expect(near(black, [0, 0, 0, 255], 1), `from chosen state ${black}`)
  }
  return `restored ${back.slice(0, 3)}`
})

await check('Polygonal Lasso: click corners, click the first to close; Backspace and Esc', async () => {
  await closeAllClean()
  await newDoc(200, 100)
  await win.keyboard.press('l')
  await win.keyboard.press('Shift+L')
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'polyLasso', 'Shift+L did not pick Polygonal Lasso')
  const click = async (x, y) => {
    const c = await client(x, y)
    await win.mouse.click(c.x, c.y)
    await settle(60)
  }
  await click(20, 20)
  await click(100, 20)
  await click(150, 70) // removed by Backspace
  await win.keyboard.press('Backspace')
  await click(100, 80)
  await click(20, 80)
  await click(20, 20)
  const sel = (await doc()).selection
  expect(!!sel, 'no selection')
  await A('fillWith', '#ff0000')
  const inside = await px(50, 50)
  const cut = await px(140, 60)
  expect(near(inside, [255, 0, 0, 255]) && near(cut, [255, 255, 255, 255]), `inside ${inside} / removed corner ${cut}`)
  await A('deselect')
  await click(10, 10)
  await click(60, 10)
  await win.keyboard.press('Escape')
  await settle()
  expect(!(await doc()).selection, 'Esc did not cancel')
  return 'square selection, Backspace dropped a corner, Esc cancelled'
})

await check('Quick Mask: Q turns the selection into a red film; painting edits it; Q again makes the selection', async () => {
  await closeAllClean()
  await newDoc(200, 100)
  await selectRect(0, 0, 100, 100)
  await win.keyboard.press('q')
  await settle(200)
  let d = await doc()
  expect(!!d.quickMask && !d.selection, 'not in quick mask')
  const red = await ev(([x, y]) => window.__cadencePlus.screenPixel(x, y), [150, 50])
  const clear = await ev(([x, y]) => window.__cadencePlus.screenPixel(x, y), [50, 50])
  expect(red[0] > 200 && red[1] < 160 && near(clear, [255, 255, 255, 255], 2), `overlay ${red} / ${clear}`)
  expect(near(await px(150, 50), [255, 255, 255, 255], 0), 'the film reached the pixels')
  // White paint unmasks a strip on the right; black paint masks a strip on the left.
  await win.keyboard.press('b')
  await setOpt('brush', { size: 10, hardness: 100, opacity: 100, flow: 100 })
  await setFg('#ffffff')
  await drag([[110, 20], [190, 20]])
  await setFg('#000000')
  await drag([[10, 80], [90, 80]])
  expect(near(await px(150, 20), [255, 255, 255, 255], 0), 'painting changed pixels')
  await win.keyboard.press('q')
  await settle(200)
  d = await doc()
  expect(!d.quickMask && !!d.selection, 'no selection after leaving')
  await A('fillWith', '#ff0000')
  const got = { left: await px(50, 50), strip: await px(150, 20), right: await px(150, 60), black: await px(50, 80) }
  expect(near(got.left, [255, 0, 0, 255]) && near(got.strip, [255, 0, 0, 255]) && near(got.right, [255, 255, 255, 255]) && near(got.black, [255, 255, 255, 255]), JSON.stringify(got))
  return 'selection = original area + white strip − black strip'
})

await check('Color Range: sampled colour and hue families select by colour', async () => {
  await closeAllClean()
  await newDoc(120, 60)
  await selectRect(0, 0, 40, 60)
  await A('fillWith', '#d02020')
  await selectRect(40, 0, 40, 60)
  await A('fillWith', '#2040d0')
  await A('deselect')
  await setFg('#d02020')
  await ev(() => window.__cadencePlus.run('select.colorRange'))
  await win.waitForSelector('.modal >> text=Color Range')
  await settle(200)
  await win.keyboard.press('Enter')
  await settle(200)
  await A('fillWith', '#00ff00')
  const r = { red: await px(20, 30), blue: await px(60, 30), white: await px(100, 30) }
  expect(near(r.red, [0, 255, 0, 255]) && near(r.blue, [32, 64, 208, 255], 2) && near(r.white, [255, 255, 255, 255]), `sampled ${JSON.stringify(r)}`)
  await ev(() => window.__cadencePlus.run('edit.undo'))
  await ev(() => window.__cadencePlus.run('select.colorRange'))
  await win.waitForSelector('.modal >> text=Color Range')
  await win.locator('.modal select').first().selectOption('blues')
  await settle(200)
  await win.keyboard.press('Enter')
  await settle(200)
  await A('fillWith', '#00ff00')
  const b = { red: await px(20, 30), blue: await px(60, 30) }
  expect(near(b.blue, [0, 255, 0, 255]) && near(b.red, [208, 32, 32, 255], 2), `blues ${JSON.stringify(b)}`)
  return 'red picked by sample, blue by the Blues family'
})

await check('tool groups: rail shows one slot per group; right-click lists the group', async () => {
  await win.keyboard.press('o')
  const slot = win.locator('.tool-btn.active')
  await slot.click({ button: 'right' })
  await win.waitForSelector('.menu-pop')
  const items = await win.locator('.menu-pop .menu-item .label').allTextContents()
  expect(items.join() === 'Dodge,Burn,Sponge', `flyout ${items}`)
  await win.locator('.menu-pop .menu-item', { hasText: 'Burn' }).click()
  expect((await ev(() => window.__cadencePlus.get().tool)) === 'burn', 'flyout did not pick Burn')
  const slots = await win.locator('.toolrail .tool-btn').count()
  return `${slots} rail slots for ${await ev(() => window.__cadencePlus.COMMANDS.filter((c) => c.id.startsWith('tool.') && !/size|softer|harder|opacity/.test(c.id)).length)} tools`
})

await check('Ctrl+R toggles rulers without reloading the window', async () => {
  const n = await ev(() => window.__cadencePlus.get().docs.length)
  await win.keyboard.press('Control+r')
  await settle(300)
  const s = await ev(() => ({ rulers: window.__cadencePlus?.get().showRulers, docs: window.__cadencePlus?.get().docs.length }))
  await win.keyboard.press('Control+r')
  expect(s.rulers === false && s.docs === n, JSON.stringify(s))
})

const projectPath = join(work, 'roundtrip.cadenceimg')
let saved = null
await check('save .cadenceimg and reopen identically', async () => {
  await newDoc(300, 200)
  await setFg('#336699')
  await selectRect(10, 10, 280, 60)
  await A('fillWith', '#336699')
  await A('newLayer')
  await selectRect(50, 50, 100, 100)
  await A('fillWith', '#ff8800')
  await A('setLayerBlend', (await doc()).activeLayerId, 'screen')
  await selectRect(100, 100, 30, 30)
  await A('addLayerMask', 'hideSelection')
  await A('selectLayer', (await doc()).activeLayerId, 'pixels')
  await selectRect(5, 5, 40, 40)
  await A('newFillLayer', '#00ff00')
  await A('setLayerOpacity', (await doc()).activeLayerId, 0.25)
  await A('newAdjustmentLayer', 'hueSaturation')
  await ev(() => {
    const s = window.__cadencePlus.get()
    const d = s.docs.find((x) => x.id === s.activeId).history.present
    window.__cadencePlus.A.setAdjustmentParams(d.activeLayerId, { kind: 'hueSaturation', params: { hue: 40, saturation: -30 } })
  })
  await ev((p) => window.__cadencePlus.set((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? { ...d, path: p } : d)) })), projectPath)
  const ok = await D('save')
  expect(ok, 'save failed')
  expect(existsSync(projectPath), 'file missing')
  const pts = [[5, 5], [20, 20], [60, 60], [120, 90], [200, 180], [149, 149], [110, 110]]
  saved = { layers: (await doc()).layers.map((l) => [l.name, l.content.type, l.blend, l.opacity, !!l.mask]), pixels: await Promise.all(pts.map(([x, y]) => px(x, y))), pts }
  await closeAllClean()
  await D('openPaths', [projectPath])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
  await settle(300)
  const d = await doc()
  const layers = d.layers.map((l) => [l.name, l.content.type, l.blend, l.opacity, !!l.mask])
  expect(JSON.stringify(layers) === JSON.stringify(saved.layers), `layers ${JSON.stringify(layers)}`)
  expect(!!d.selection, 'selection lost')
  const pixels = await Promise.all(pts.map(([x, y]) => px(x, y)))
  pixels.forEach((p, i) => expect(near(p, saved.pixels[i], 0), `pixel ${pts[i]}: ${saved.pixels[i]} → ${p}`))
  return `${(statSync(projectPath).size / 1024).toFixed(1)} KB`
})

await check('export PNG matches the composite exactly; JPEG gets a white matte', async () => {
  const png = join(work, 'export.png')
  const jpg = join(work, 'export.jpg')
  const pts = [[5, 5], [60, 60], [120, 90], [200, 180]]
  const want = await Promise.all(pts.map(([x, y]) => px(x, y)))
  expect(await D('exportTo', png, 'png', 1), 'png export')
  expect(await D('exportTo', jpg, 'jpeg', 0.95), 'jpg export')
  await D('openPaths', [png])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 2)
  await settle(300)
  const got = await Promise.all(pts.map(([x, y]) => px(x, y)))
  got.forEach((g, i) => expect(near(g, want[i], 0), `png ${pts[i]}: ${want[i]} → ${g}`))
  // Transparent export check
  await newDoc(20, 20, 'transparent')
  await selectRect(0, 0, 10, 20)
  await A('fillWith', '#000000')
  const tj = join(work, 'transparent.jpg')
  await D('exportTo', tj, 'jpeg', 0.95)
  await D('openPaths', [tj])
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 4)
  await settle(300)
  const w = await px(15, 10)
  expect(near(w, [255, 255, 255, 255], 3), `jpeg matte ${w}`)
})

await check('closing documents frees their tiles', async () => {
  await closeAllClean()
  const freed = await ev(() => window.__cadencePlus.D.runGc())
  const stats = await ev(() => window.__cadencePlus.storeStats())
  expect(stats.tiles <= 4, `tiles left ${stats.tiles}`)
  return `${stats.tiles} solid tiles kept, ${freed} freed on last pass`
})

await check('no uncaught errors in the renderer', async () => {
  expect(pageErrors.length === 0, pageErrors.join('\n'))
})

// Crash recovery runs last: it kills the app and relaunches it.
await check('autosave + crash recovery restores unsaved work', async () => {
  await newDoc(64, 64)
  await selectRect(0, 0, 32, 64)
  await A('fillWith', '#ff0000')
  const n = await ev(() => window.__cadencePlus.R.autosaveNow())
  expect(n === 1, `autosaved ${n}`)
  // Simulate a crash: kill the whole process tree without letting the app close.
  execSync(`taskkill /PID ${app.process().pid} /T /F`, { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1000))
  const app2 = await electron.launch({
    args: [root],
    env: { ...process.env, CADENCE_PLUS_USER_DATA: join(work, 'user'), CADENCE_PLUS_TEST: '1', CADENCE_PLUS_NO_MAXIMIZE: '1' }
  })
  try {
    const w2 = await app2.firstWindow()
    await w2.waitForSelector('.modal:has-text("Recover unsaved work")', { timeout: 15000 })
    await w2.click('.modal .btn.primary')
    await w2.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
    await w2.waitForTimeout(300)
    const p = await w2.evaluate(() => window.__cadencePlus.pixel(10, 10))
    const q = await w2.evaluate(() => window.__cadencePlus.pixel(50, 10))
    const dirty = await w2.evaluate(() => {
      const d = window.__cadencePlus.get().docs[0]
      return d.history.revision !== d.savedRevision
    })
    expect(near(p, [255, 0, 0, 255]) && near(q, [255, 255, 255, 255]), `pixels ${p} ${q}`)
    expect(dirty, 'recovered document should be unsaved')
    // The old recovery copy is replaced by a fresh autosave of the recovered document.
    await w2.waitForTimeout(500)
    await w2.screenshot({ path: join(root, 'test-output', 'e2e-final.png') })
    await w2.evaluate(() => window.__cadencePlus.set((s) => ({ docs: s.docs.map((d) => ({ ...d, savedRevision: d.history.revision })) })))
  } finally {
    await app2.close()
  }
})

const w = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
