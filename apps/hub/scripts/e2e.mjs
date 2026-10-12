/**
 * Cadence Hub end to end (npm run build first). A local server stands in
 * for GitHub, and CADENCE_HUB_FAKE_SYSTEM replaces the registry and
 * installers, so nothing is installed on this PC: the hub's downloads,
 * checksum checks, state and window are real.
 *
 *   node scripts/e2e.mjs
 */
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'cadence-hub-e2e-'))
const system = join(work, 'system')
const userData = join(work, 'user')
mkdirSync(system)
mkdirSync(userData)

// --- Stand-in for GitHub ---------------------------------------------------
const releases = new Map() // tag → { file, payload, sha512 }
function publish(tag, { corrupt = false } = {}) {
  const version = tag.replace(/^\w+-v/, '')
  const payload = randomBytes(64 * 1024)
  const sha512 = createHash('sha512').update(corrupt ? randomBytes(8) : payload).digest('base64')
  releases.set(tag, { file: `Cadence-Plus-Setup-${version}.exe`, payload, sha512, version })
}
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/api/releases') {
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify([...releases.keys()].map((tag_name) => ({ tag_name, draft: false, prerelease: false }))))
  }
  const m = /^\/download\/([^/]+)\/(.+)$/.exec(path)
  const rel = m && releases.get(m[1])
  if (rel && m[2] === 'latest.yml') return res.end(`version: ${rel.version}\nfiles:\n  - url: ${rel.file}\n    sha512: ${rel.sha512}\npath: ${rel.file}\nsha512: ${rel.sha512}\n`)
  if (rel && decodeURIComponent(m[2]) === rel.file) {
    res.setHeader('Content-Length', String(rel.payload.length))
    return res.end(rel.payload)
  }
  res.statusCode = 404
  res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
publish('plus-v0.1.0')

// --- Helpers -------------------------------------------------------------------
const results = []
async function check(name, fn) {
  try {
    results.push({ name, ok: true, detail: (await fn()) ?? '' })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m)
}
const installed = () => (existsSync(join(system, 'installed.json')) ? JSON.parse(readFileSync(join(system, 'installed.json'), 'utf8')) : {})

async function launchHub() {
  const app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      CADENCE_HUB_TEST: '1',
      CADENCE_HUB_USER_DATA: userData,
      CADENCE_HUB_FAKE_SYSTEM: system,
      CADENCE_UPDATE_API: `http://127.0.0.1:${port}/api`,
      CADENCE_UPDATE_FILES: `http://127.0.0.1:${port}/download`
    }
  })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1060, 700))
  await win.waitForSelector('.app-row[data-app="plus"]')
  return { app, win }
}
const row = (win, id) => win.locator(`.app-row[data-app="${id}"]`)
const statusOf = async (win, id) => (await row(win, id).locator('.app-status').textContent()) ?? ''
async function waitStatus(win, id, re, timeout = 15000) {
  let last = ''
  for (const t = Date.now(); Date.now() - t < timeout; await new Promise((r) => setTimeout(r, 150))) {
    last = await statusOf(win, id).catch(() => '')
    if (re.test(last)) return last
  }
  throw new Error(`${id}: waited for ${re} but the status says "${last}"`)
}

// --- Checks ----------------------------------------------------------------------
let { app, win } = await launchHub()

await check('lists Cadence+ (released) and Cadence Video (no release yet)', async () => {
  await waitStatus(win, 'plus', /version 0\.1\.0 available/)
  expect((await row(win, 'plus').locator('.app-actions .btn').first().textContent()) === 'Install', 'no Install button')
  const v = await statusOf(win, 'video')
  expect(/Not released yet/.test(v), `video: ${v}`)
  await win.screenshot({ path: join(root, 'test-output', 'hub-apps.png') })
  return `Cadence+: ${await statusOf(win, 'plus')} · Video: ${v}`
})

await check('Install downloads, verifies and installs; Open launches it', async () => {
  await row(win, 'plus').locator('.app-actions .btn').first().click()
  await waitStatus(win, 'plus', /Installed · version 0\.1\.0/)
  expect(installed().plus?.version === '0.1.0', `installed.json ${JSON.stringify(installed())}`)
  await row(win, 'plus').locator('.app-actions .btn').first().click()
  await win.waitForTimeout(300)
  expect(installed().plus?.launched, 'Open did not launch')
  return await statusOf(win, 'plus')
})

await check('a new release shows as an update (sidebar count) and Update installs it', async () => {
  publish('plus-v0.2.0')
  await win.click('button:has-text("Check again")')
  await waitStatus(win, 'plus', /update 0\.2\.0 available/)
  expect((await win.locator('.side .count').textContent()) === '1', 'no update count')
  await win.click('.side button:has-text("Updates")')
  await row(win, 'plus').locator('.app-actions .btn').first().click()
  // Once updated it leaves the Updates list; follow it on the Apps page.
  await win.click('.side button:has-text("Apps")')
  await waitStatus(win, 'plus', /Installed · version 0\.2\.0/)
  expect(installed().plus?.version === '0.2.0', 'not updated')
  expect((await win.locator('.side .count').count()) === 0, 'update count still shown')
  return '0.1.0 → 0.2.0'
})

await check('a download that fails its checksum is refused and nothing changes', async () => {
  publish('plus-v0.3.0', { corrupt: true })
  await win.click('button:has-text("Check again")')
  await waitStatus(win, 'plus', /update 0\.3\.0 available/)
  await row(win, 'plus').locator('.app-actions .btn').first().click()
  await waitStatus(win, 'plus', /checksum/)
  expect(installed().plus?.version === '0.2.0', `version changed to ${installed().plus?.version}`)
  releases.delete('plus-v0.3.0')
  await win.click('button:has-text("Check again")')
  return await statusOf(win, 'plus')
})

await check('Uninstall from the ⋯ menu removes it', async () => {
  await row(win, 'plus').locator('.btn.more').click()
  await win.click('.menu-pop .menu-item:has-text("Uninstall")')
  await waitStatus(win, 'plus', /Not installed/)
  expect(!installed().plus, 'still installed')
  return await statusOf(win, 'plus')
})

await check('apps ticked in the installer install on first start; unreleased ones wait', async () => {
  await app.close()
  writeFileSync(join(userData, 'install-on-first-run.txt'), 'plus\r\nvideo\r\n')
  ;({ app, win } = await launchHub())
  await waitStatus(win, 'plus', /Installed · version 0\.2\.0/, 30000)
  await waitStatus(win, 'video', /install automatically/)
  expect(!existsSync(join(userData, 'install-on-first-run.txt')), 'first-run file not consumed')
  await win.screenshot({ path: join(root, 'test-output', 'hub-first-run.png') })
  // Cadence Video's first release appears: the hub installs it on the next start.
  releases.set('video-v0.1.0', { ...releases.get('plus-v0.2.0'), file: 'Cadence-Video-Setup-0.1.0.exe', version: '0.1.0' })
  await app.close()
  ;({ app, win } = await launchHub())
  await waitStatus(win, 'video', /Installed · version 0\.1\.0/, 30000)
  return `Cadence+ ${installed().plus?.version}, Cadence Video ${installed().video?.version}`
})

await app.close()
server.close()

const w = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
