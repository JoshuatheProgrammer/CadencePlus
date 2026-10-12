/**
 * Writes <app>/out/THIRD_PARTY_NOTICES.txt for a built app: the licence of
 * every package that ends up inside it — the ones Vite bundled into the
 * renderer (listed by the build in out/renderer/bundled-packages.json) and
 * the runtime dependencies packed beside the main process — plus LibRaw's
 * LGPL notice when camera RAW support is included.
 *
 *   node scripts/notices.mjs apps/plus
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const app = resolve(process.argv[2] ?? '.')
const appPkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))

/** Folder of an installed package (resolved like the app resolves it). */
function pkgDir(name, from = join(app, 'package.json')) {
  const r = createRequire(from)
  try {
    return dirname(r.resolve(`${name}/package.json`))
  } catch {
    // Packages without an exported package.json: walk node_modules upwards.
    for (let d = dirname(from); ; d = dirname(d)) {
      const p = join(d, 'node_modules', name)
      if (existsSync(join(p, 'package.json'))) return p
      if (dirname(d) === d) return null
    }
  }
}

const found = new Map()
function add(name, from) {
  if (found.has(name) || name.startsWith('@cadence/')) return
  const dir = pkgDir(name, from)
  if (!dir) throw new Error(`Cannot find ${name} (needed for the notices).`)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  found.set(name, { dir, pkg })
  return { dir, pkg }
}

// Bundled into the renderer.
const listFile = join(app, 'out', 'renderer', 'bundled-packages.json')
if (!existsSync(listFile)) throw new Error(`${listFile} is missing: build the app first.`)
for (const name of JSON.parse(readFileSync(listFile, 'utf8'))) add(name)

// Runtime dependencies of the main process, with their dependencies.
const queue = Object.keys(appPkg.dependencies ?? {}).map((n) => [n, join(app, 'package.json')])
while (queue.length) {
  const [name, from] = queue.shift()
  if (found.has(name)) continue
  const got = add(name, from)
  if (got) for (const dep of Object.keys(got.pkg.dependencies ?? {})) queue.push([dep, join(got.dir, 'package.json')])
}

const licenceText = ({ dir, pkg }) => {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n))
  if (f) return readFileSync(join(dir, f), 'utf8').trim()
  // libraw-wasm declares ISC but ships no licence file: the standard ISC text.
  if (pkg.license === 'ISC') {
    const who = typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? pkg.name)
    return `ISC License\n\nCopyright (c) ${who} and contributors\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`
  }
  throw new Error(`${pkg.name} has no licence file; add its text to scripts/notices.mjs.`)
}

const line = '='.repeat(78)
const parts = [
  `${appPkg.productName ?? appPkg.name} ${appPkg.version} — third-party notices`,
  '',
  `${appPkg.productName ?? appPkg.name} is free, open-source software under the MIT licence (see LICENSE).`,
  'It includes the components below, each under its own licence. Electron and',
  'Chromium notices are in LICENSE.electron.txt and LICENSES.chromium.html in',
  'the installation folder.',
  ''
]

if (found.has('libraw-wasm')) {
  const lw = found.get('libraw-wasm').pkg
  parts.push(
    line,
    'LibRaw (camera RAW decoding) — GNU Lesser General Public License 2.1',
    line,
    '',
    'Camera RAW files are developed with LibRaw, Copyright (C) 2008 onwards',
    'LibRaw LLC (https://www.libraw.org), compiled to WebAssembly by libraw-wasm',
    `${lw.version} (${String(lw.repository?.url ?? '').replace(/^git\+|\.git$/g, '')}).`,
    'LibRaw is dual-licensed under LGPL-2.1 and CDDL-1.0; Cadence uses it under',
    'the LGPL-2.1, whose full text follows.',
    '',
    'The library is shipped as separate files that are not packed into the',
    'application archive, so you can replace them with your own build:',
    '  resources/app.asar.unpacked/out/renderer/assets/libraw-*.wasm',
    '  resources/app.asar.unpacked/out/renderer/assets/libraw-*.js',
    '  resources/app.asar.unpacked/out/renderer/assets/worker-*.js',
    'Source code: https://github.com/LibRaw/LibRaw (library) and the libraw-wasm',
    'repository above (WebAssembly build). On request, the Cadence project will',
    'also provide the exact source used for a given release; open an issue in',
    'the Cadence repository.',
    '',
    readFileSync(join(root, 'licenses', 'LGPL-2.1.txt'), 'utf8').trim(),
    ''
  )
}

for (const [name, info] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const { pkg } = info
  const repo = String(pkg.repository?.url ?? pkg.repository ?? pkg.homepage ?? '').replace(/^git\+|\.git$/g, '')
  parts.push(line, `${name} ${pkg.version} — ${pkg.license ?? 'see below'}${repo ? `\n${repo}` : ''}`, line, '', licenceText(info), '')
}

const out = join(app, 'out', 'THIRD_PARTY_NOTICES.txt')
writeFileSync(out, parts.join('\n'))
// The project's own licence travels with the app too.
writeFileSync(join(app, 'out', 'LICENSE.txt'), readFileSync(join(root, 'LICENSE'), 'utf8'))
console.log(`notices: ${found.size} packages → ${out}`)
