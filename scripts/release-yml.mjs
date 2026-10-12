/**
 * Rewrites the SHA-512 (and size, when listed) of an installer in an
 * electron-builder latest.yml after the installer has been changed — code
 * signing alters the file — so the updater's integrity check matches the
 * file that is actually published.
 *
 *   node scripts/release-yml.mjs <latest.yml> <installer.exe>
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const [ymlPath, installer] = process.argv.slice(2)
if (!ymlPath || !installer) throw new Error('usage: node scripts/release-yml.mjs <latest.yml> <installer.exe>')
const sha512 = createHash('sha512').update(readFileSync(installer)).digest('base64')
const size = statSync(installer).size
const name = basename(installer)
const lines = readFileSync(ymlPath, 'utf8').split('\n')
const at = lines.findIndex((l) => l.trim() === `- url: ${name}`)
if (at < 0) throw new Error(`${name} is not listed in ${ymlPath}`)
// The entry's own lines follow until the next "- url:" or a top-level key.
let old = null
for (let i = at + 1; i < lines.length && /^\s{3,}\S/.test(lines[i]); i++) {
  const m = /^(\s+)(sha512|size): (.*)$/.exec(lines[i])
  if (m?.[2] === 'sha512') {
    old = m[3]
    lines[i] = `${m[1]}sha512: ${sha512}`
  } else if (m?.[2] === 'size') lines[i] = `${m[1]}size: ${size}`
}
if (!old) throw new Error(`no sha512 for ${name} in ${ymlPath}`)
// The top-level sha512 repeats the main installer's.
const out = lines.map((l) => (l === `sha512: ${old}` ? `sha512: ${sha512}` : l)).join('\n')
writeFileSync(ymlPath, out)
console.log(`${ymlPath}: ${name} → ${size} bytes, sha512 ${sha512.slice(0, 16)}…`)
