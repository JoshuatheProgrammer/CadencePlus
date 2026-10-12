/**
 * Checks the packaged app (npm run pack first): it starts, reports its
 * version, opens camera RAW (LibRaw loads from outside the archive), shows
 * its licences, and its updater finds, downloads and verifies a newer
 * release from a local stand-in for GitHub (the downloaded file is never run).
 *
 *   node scripts/e2e-packaged.mjs
 */
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { makeDng } from './fixtures.mjs'

const root = resolve(import.meta.dirname, '..')
const exe = join(root, 'dist', 'win-unpacked', 'CadencePlus.exe')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const work = mkdtempSync(join(tmpdir(), 'cplus-packaged-'))

// Stand-in for the GitHub API and release downloads: plus-v<next> holds latest.yml + a dummy installer.
const next = version.replace(/(\d+)$/, (n) => String(Number(n) + 1))
const payload = randomBytes(256 * 1024)
const sha512 = createHash('sha512').update(payload).digest('base64')
const file = `Cadence-Plus-Setup-${next}.exe`
const latestYml = `version: ${next}\nfiles:\n  - url: ${file}\n    sha512: ${sha512}\n    size: ${payload.length}\npath: ${file}\nsha512: ${sha512}\nreleaseDate: '2026-10-12T00:00:00.000Z'\n`
const requests = []
const server = createServer((req, res) => {
  requests.push(req.url)
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/api/releases') {
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify([
      { tag_name: `video-v9.9.9`, draft: false, prerelease: false },
      { tag_name: `plus-v${next}`, draft: false, prerelease: false },
      { tag_name: `plus-v${version}`, draft: false, prerelease: false },
      { tag_name: `plus-v99.0.0`, draft: false, prerelease: true }
    ]))
  }
  if (path === `/download/plus-v${next}/latest.yml`) return res.end(latestYml)
  if (path === `/download/plus-v${next}/${file}`) {
    res.setHeader('Content-Length', String(payload.length))
    return res.end(payload)
  }
  res.statusCode = 404
  res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// The installer writes resources/app-update.yml; an unpacked (--dir) build has none, so add the same file.
const updateYml = join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml')
if (!existsSync(updateYml)) writeFileSync(updateYml, ['provider: generic', 'url: https://example.invalid', 'updaterCacheDirName: cadence-plus-updater', ''].join('\n'))

const results = []
const check = async (name, fn) => {
  try {
    results.push({ name, ok: true, detail: (await fn()) ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m)
}

const app = await electron.launch({
  executablePath: exe,
  args: [],
  env: {
    ...process.env,
    CADENCE_PLUS_USER_DATA: join(work, 'user'),
    CADENCE_PLUS_TEST: '1',
    CADENCE_PLUS_NO_MAXIMIZE: '1',
    CADENCE_UPDATE_API: `http://127.0.0.1:${port}/api`,
    CADENCE_UPDATE_FILES: `http://127.0.0.1:${port}/download`
  }
})
const win = await app.firstWindow()
await win.waitForFunction(() => !!window.__cadencePlus, null, { timeout: 30000 })

await check('packaged app starts and reports its version', async () => {
  const v = await win.evaluate(() => window.cadencePlus.versions.app)
  expect(v === version, `version ${v}, expected ${version}`)
  expect(await app.evaluate(({ app }) => app.isPackaged), 'not running packaged')
  return `Cadence+ ${v}`
})

await check('camera RAW opens (LibRaw loads from app.asar.unpacked)', async () => {
  const dng = join(work, 'test.dng')
  writeFileSync(dng, makeDng())
  await win.evaluate((p) => window.__cadencePlus.D.openPaths([p]), dng)
  await win.waitForFunction(() => window.__cadencePlus.get().docs.length === 1, null, { timeout: 30000 })
  const c = await win.evaluate(() => window.__cadencePlus.get().docs[0].history.present.color)
  expect(c?.depth === 16 && c.space === 'display-p3', `colour ${JSON.stringify(c)}`)
  return '16-bit Display P3'
})

await check('licence and third-party notices are bundled', async () => {
  const t = await win.evaluate(() => window.cadencePlus.legalTexts())
  expect(t && t.license.includes('MIT License') && t.notices.includes('GNU LESSER GENERAL PUBLIC LICENSE') && t.notices.includes('electron-updater'), 'missing texts')
  return `${Math.round(t.notices.length / 1024)} KB of notices`
})

await check('updater finds this app’s newest release, downloads it and verifies its SHA-512', async () => {
  const states = []
  await win.exposeFunction('__updateSeen', (s) => states.push(s.state))
  await win.evaluate(() => window.cadencePlus.onUpdateStatus((s) => window.__updateSeen(s)))
  await win.evaluate(() => window.cadencePlus.checkForUpdates(true))
  let s
  for (let t = Date.now(); Date.now() - t < 120000; await new Promise((r) => setTimeout(r, 250))) {
    s = await win.evaluate(() => window.cadencePlus.getUpdateStatus())
    if (s.state === 'ready' || s.state === 'error') break
  }
  expect(s.state === 'ready' && s.version === next, `status ${JSON.stringify(s)}; seen ${states.join(' → ')}; requests ${requests.join(', ')}`)
  expect(!requests.some((u) => u.includes('99.0.0') || u.includes('video-v')), 'picked a pre-release or another app’s release')
  await win.waitForSelector('.update-ready', { timeout: 5000 })
  return `${version} → ${next} (${states.join(' → ')})`
})

// Test mode never installs; the cached download is removed.
await app.close()
server.close()
for (const d of ['cadence-plus-updater', 'Cadence+-updater', 'CadencePlus-updater']) rmSync(join(process.env.LOCALAPPDATA ?? '', d), { recursive: true, force: true })

const w = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
