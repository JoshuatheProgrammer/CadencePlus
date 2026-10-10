/**
 * End-to-end verification: drives the built app (npm run build first) with
 * real mouse/keyboard input and test hooks, and checks the actual pixels.
 *
 *   node scripts/e2e.mjs
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

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
async function check(name, fn) {
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
