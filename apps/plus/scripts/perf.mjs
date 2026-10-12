/** Compositor timing at viewport size: node scripts/perf.mjs (after npm run build). */
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = resolve(import.meta.dirname, '..')
const app = await electron.launch({ args: [root], env: { ...process.env, CADENCE_PLUS_USER_DATA: mkdtempSync(join(tmpdir(), 'cp-')), CADENCE_PLUS_TEST: '1', CADENCE_PLUS_NO_MAXIMIZE: '1' } })
const win = await app.firstWindow()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 960))
await win.waitForFunction(() => !!window.__cadencePlus)
for (const [w, h] of [[1920, 1200], [6000, 4000], [12000, 8000]]) {
  await win.evaluate(([w, h]) => window.__cadencePlus.D.newDocument({ name: 'perf', width: w, height: h, resolution: 72, background: 'white' }), [w, h])
  await win.waitForTimeout(300)
  await win.evaluate(() => {
    const A = window.__cadencePlus.A
    for (let i = 0; i < 3; i++) {
      A.newLayer()
      A.fillWith('#ff0000')
    }
    A.newAdjustmentLayer('hueSaturation')
    A.newLayer()
  })
  await win.waitForTimeout(300)
  const first = await win.evaluate(() => window.__cadencePlus.bench(1, false))
  const fitNoStroke = await win.evaluate(() => window.__cadencePlus.bench(20, false))
  const fit = await win.evaluate(() => window.__cadencePlus.bench(20, true))
  await win.evaluate(() => window.__cadencePlus.D.actualPixels())
  const at100 = await win.evaluate(() => window.__cadencePlus.bench(20, true))
  console.log(`${w}×${h}, 5 layers: first fit frame ${first.toFixed(0)} ms (builds mips) · fit ${fitNoStroke.toFixed(1)} ms · fit while painting ${fit.toFixed(1)} ms · 100% while painting ${at100.toFixed(1)} ms`)
}
await app.close()
