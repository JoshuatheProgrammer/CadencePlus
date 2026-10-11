/**
 * Launches the built app (npm run build first) and captures screenshots of
 * the main states into test-output/. Uses an isolated settings folder.
 *
 *   node scripts/screenshot.mjs [image-to-open]
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'test-output')
mkdirSync(out, { recursive: true })
const image = process.argv[2] ?? ['C:/Windows/Web/4K/Wallpaper/Windows/img0_1920x1200.jpg', 'C:/Windows/Web/Wallpaper/Spotlight/img14.jpg'].find(existsSync)

const app = await electron.launch({
  args: [root],
  env: { ...process.env, CADENCE_PLUS_USER_DATA: mkdtempSync(join(tmpdir(), 'cplus-')), CADENCE_PLUS_TEST: '1', CADENCE_PLUS_NO_MAXIMIZE: '1' }
})
const win = await app.firstWindow()
const errors = []
win.on('console', (m) => m.type() === 'error' && errors.push(m.text() + ' @ ' + JSON.stringify(m.location())))
win.on('pageerror', (e) => errors.push(String(e.stack ?? e)))
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 960))
await win.waitForFunction(() => !!window.__cadencePlus)
await win.waitForTimeout(400)
await win.screenshot({ path: join(out, '1-home.png') })

if (image) {
  await win.evaluate((p) => window.__cadencePlus.D.openPaths([p]), image)
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1)
  await win.waitForTimeout(700)
  await win.screenshot({ path: join(out, '2-open.png') })
}

// New document, paint a stroke, add a layer
await win.evaluate(() => window.__cadencePlus.D.newDocument({ name: 'Paint test', width: 1200, height: 800, resolution: 72, background: 'white' }))
await win.waitForTimeout(500)
const vp = await win.locator('.viewport').boundingBox()
await win.evaluate(() => window.__cadencePlus.set({ fg: '#2f6fd6' }))
await win.keyboard.press('b')
await win.mouse.move(vp.x + vp.width * 0.3, vp.y + vp.height * 0.4)
await win.mouse.down()
for (let i = 0; i <= 30; i++) await win.mouse.move(vp.x + vp.width * (0.3 + i * 0.012), vp.y + vp.height * (0.4 + Math.sin(i / 5) * 0.12))
await win.mouse.up()
await win.keyboard.press('m')
await win.mouse.move(vp.x + vp.width * 0.55, vp.y + vp.height * 0.25)
await win.mouse.down()
await win.mouse.move(vp.x + vp.width * 0.75, vp.y + vp.height * 0.6, { steps: 8 })
await win.mouse.up()
await win.waitForTimeout(400)
await win.screenshot({ path: join(out, '3-paint.png') })

// Richer layer stack on the photo
await win.evaluate(() => window.__cadencePlus.set((s) => ({ activeId: s.docs[0].id })))
await win.waitForTimeout(300)
await win.evaluate(() => {
  const { A, set } = window.__cadencePlus
  A.newAdjustmentLayer('hueSaturation')
  A.newFillLayer('#ff8800')
  const s = window.__cadencePlus.get()
  const d = s.docs.find((x) => x.id === s.activeId).history.present
  A.setLayerBlend(d.activeLayerId, 'soft-light')
  A.setLayerOpacity(d.activeLayerId, 0.4)
  A.addSelectionShape({ kind: 'ellipse', x: 200, y: 150, w: 900, h: 800 }, 'replace', 'Ellipse')
  A.addLayerMask('revealSelection')
  A.newLayer()
  A.addSelectionShape({ kind: 'ellipse', x: 600, y: 300, w: 700, h: 500 }, 'replace', 'Ellipse')
  set({ tool: 'brush' })
})
const vp2 = await win.locator('.viewport').boundingBox()
await win.mouse.move(vp2.x + vp2.width * 0.62, vp2.y + vp2.height * 0.55)
await win.waitForTimeout(400)
await win.screenshot({ path: join(out, '4-layers.png') })

// Menu open
await win.click('.menu-btn:has-text("Layer")')
await win.waitForTimeout(150)
await win.hover('.menu-item:has-text("New Adjustment Layer")')
await win.waitForTimeout(200)
await win.screenshot({ path: join(out, '5-menu.png') })
await win.keyboard.press('Escape')

// New document dialog
await win.keyboard.press('Control+n')
await win.waitForTimeout(250)
await win.screenshot({ path: join(out, '6-new-dialog.png') })
await win.keyboard.press('Escape')

// Crop overlay
await win.keyboard.press('c')
const a = { x: vp2.x + vp2.width * 0.25, y: vp2.y + vp2.height * 0.2 }
await win.mouse.move(a.x, a.y)
await win.mouse.down()
await win.mouse.move(a.x + vp2.width * 0.45, a.y + vp2.height * 0.5, { steps: 6 })
await win.mouse.up()
await win.waitForTimeout(250)
await win.screenshot({ path: join(out, '7-crop.png') })
await win.keyboard.press('Escape')

// Adjustment dialog with live preview on the photo's Background layer
await win.evaluate(() => {
  const { A, get } = window.__cadencePlus
  const s = get()
  const d = s.docs.find((x) => x.id === s.activeId).history.present
  A.deselect()
  A.selectLayer(d.layers[0].id)
})
await win.keyboard.press('Control+u')
await win.waitForSelector('.modal')
await win.evaluate(() => {
  const r = document.querySelectorAll('.modal input[type=range]')[0]
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '120')
  r.dispatchEvent(new Event('input', { bubbles: true }))
})
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, '8-adjust.png') })
await win.keyboard.press('Escape')

// Levels and Curves dialogs on the photo
await win.keyboard.press('Control+l')
await win.waitForSelector('.levels')
await win.waitForTimeout(250)
await win.screenshot({ path: join(out, '10-levels.png') })
await win.keyboard.press('Escape')
await win.keyboard.press('Control+m')
await win.waitForSelector('.curve-graph')
{
  const r = await win.locator('.curve-graph').boundingBox()
  await win.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.7)
  await win.mouse.down()
  await win.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.78, { steps: 4 })
  await win.mouse.up()
  await win.mouse.move(r.x + r.width * 0.72, r.y + r.height * 0.28)
  await win.mouse.down()
  await win.mouse.move(r.x + r.width * 0.72, r.y + r.height * 0.2, { steps: 4 })
  await win.mouse.up()
}
await win.waitForTimeout(250)
await win.screenshot({ path: join(out, '11-curves.png') })
await win.keyboard.press('Escape')

// Free Transform on the painted document
await win.evaluate(() => window.__cadencePlus.set((s) => ({ activeId: s.docs[1].id })))
await win.waitForTimeout(300)
await win.keyboard.press('Control+t')
await win.evaluate(() => {
  const t = window.__cadencePlus.get().transform
  window.__cadencePlus.TF.updateTransform({ ...t.params, rot: 0.35, sx: 0.7, sy: 0.7 })
})
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, '9-transform.png') })
await win.keyboard.press('Escape')

// Type and shapes
await win.evaluate(() => window.__cadencePlus.D.newDocument({ name: 'Poster', width: 1200, height: 700, resolution: 72, background: 'white' }))
await win.waitForTimeout(400)
{
  const vp = await win.locator('.viewport').boundingBox()
  const at = async (x, y) => win.evaluate(([x, y]) => {
    const s = window.__cadencePlus.get()
    const v = s.docs.find((d) => d.id === s.activeId).view
    return { x: (x - v.cx) * v.zoom + s.viewport.w / 2, y: (y - v.cy) * v.zoom + s.viewport.h / 2 }
  }, [x, y])
  await win.evaluate(() => window.__cadencePlus.set({ fg: '#69b7ff', bg: '#101114' }))
  await win.evaluate(() => window.__cadencePlus.set((s) => ({ options: { ...s.options, shape: { ...s.options.shape, kind: 'rect', radius: 40, fill: true, stroke: true, strokeWidth: 10 } } })))
  await win.keyboard.press('u')
  let p0 = await at(80, 80), p1 = await at(560, 620)
  await win.mouse.move(vp.x + p0.x, vp.y + p0.y); await win.mouse.down(); await win.mouse.move(vp.x + p1.x, vp.y + p1.y, { steps: 5 }); await win.mouse.up()
  await win.evaluate(() => window.__cadencePlus.set((s) => ({ fg: '#f2d06b', options: { ...s.options, shape: { ...s.options.shape, kind: 'polygon', sides: 6, stroke: false } } })))
  p0 = await at(700, 120); p1 = await at(1000, 420)
  await win.mouse.move(vp.x + p0.x, vp.y + p0.y); await win.mouse.down(); await win.mouse.move(vp.x + p1.x, vp.y + p1.y, { steps: 5 }); await win.mouse.up()
  await win.evaluate(() => window.__cadencePlus.set((s) => ({ fg: '#101114', options: { ...s.options, text: { ...s.options.text, size: 110, weight: 700, font: 'Segoe UI' } } })))
  await win.keyboard.press('t')
  p0 = await at(620, 590)
  await win.mouse.click(vp.x + p0.x, vp.y + p0.y)
  await win.waitForSelector('.text-edit')
  await win.keyboard.type('Cadence+', { delay: 10 })
  await win.waitForTimeout(300)
  await win.screenshot({ path: join(out, '12-type.png') })
  await win.keyboard.press('Control+Enter')
}

console.log(JSON.stringify({ errors, stats: await win.evaluate(() => window.__cadencePlus.storeStats()) }, null, 2))
await app.close()
