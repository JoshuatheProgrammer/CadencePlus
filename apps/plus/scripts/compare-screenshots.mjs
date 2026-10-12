/**
 * Pixel-compares test-output/N-*.png with the same files in another folder
 * (e.g. screenshots taken before a refactor): node scripts/compare-screenshots.mjs <folder>
 */
import { _electron as electron } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const base = process.argv[2]
const root = resolve(import.meta.dirname, '..')
const app = await electron.launch({ args: [root], env: { ...process.env, CADENCE_PLUS_TEST: '1' } })
const win = await app.firstWindow()
for (const f of readdirSync(base).filter((f) => /^\d+-.*\.png$/.test(f))) {
  const a = readFileSync(join(base, f)).toString('base64')
  const b = readFileSync(join(root, 'test-output', f)).toString('base64')
  const r = await win.evaluate(async ([a, b]) => {
    const load = async (s) => createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    const [x, y] = [await load(a), await load(b)]
    if (x.width !== y.width || x.height !== y.height) return 'size differs'
    const get = (bm) => { const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data }
    const [p, q] = [get(x), get(y)]
    let n = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1
    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 6) { n++; const px = (i / 4) % x.width, py = Math.floor(i / 4 / x.width); minx = Math.min(minx, px); maxx = Math.max(maxx, px); miny = Math.min(miny, py); maxy = Math.max(maxy, py) }
    return n ? `${n} px differ in ${minx},${miny}–${maxx},${maxy}` : 'identical'
  }, [a, b])
  console.log(f.padEnd(18), r)
}
await app.close()
