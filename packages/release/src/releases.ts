/**
 * Finding Cadence releases on GitHub (main process).
 *
 * Every app releases from one repository with its own tag prefix
 * ("plus-v1.2.3", "hub-v1.2.3", "video-v1.2.3"). Test feeds can replace
 * GitHub through CADENCE_UPDATE_API (the releases API) and
 * CADENCE_UPDATE_FILES (release downloads).
 */
import { net } from 'electron'

export interface ReleaseRepo {
  owner: string
  repo: string
}

export interface FoundRelease {
  /** e.g. "1.2.3" */
  version: string
  tag: string
  /** Folder URL holding the release's files (latest.yml, installer). */
  base: string
}

const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0)

/** True when version a is newer than b (major.minor.patch). */
export function isNewer(a: string, b: string): boolean {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** False until release.config.json names a real GitHub owner. */
export const repoConfigured = (r: ReleaseRepo): boolean => !!process.env.CADENCE_UPDATE_API || (!!r.owner && r.owner !== 'YOUR_GITHUB')

/** The newest published (non-draft, non-pre-release) release with `prefix`, or null. */
export async function latestRelease(r: ReleaseRepo, prefix: string): Promise<FoundRelease | null> {
  const api = process.env.CADENCE_UPDATE_API ?? `https://api.github.com/repos/${r.owner}/${r.repo}`
  const res = await net.fetch(`${api}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cadence' } })
  if (!res.ok) throw new Error(res.status === 404 ? 'The release repository was not found.' : `GitHub answered ${res.status} ${res.statusText}.`)
  const list = (await res.json()) as { tag_name: string; draft: boolean; prerelease: boolean }[]
  let best: string | null = null
  for (const rel of list) {
    if (rel.draft || rel.prerelease || !rel.tag_name.startsWith(prefix)) continue
    const v = rel.tag_name.slice(prefix.length)
    if (!best || isNewer(v, best)) best = v
  }
  if (!best) return null
  const files = process.env.CADENCE_UPDATE_FILES ?? `https://github.com/${r.owner}/${r.repo}/releases/download`
  return { version: best, tag: `${prefix}${best}`, base: `${files}/${prefix}${best}` }
}

/** The installer named in a release's latest.yml, with its SHA-512. */
export async function releaseInstaller(rel: FoundRelease): Promise<{ url: string; file: string; sha512: string }> {
  const res = await net.fetch(`${rel.base}/latest.yml`)
  if (!res.ok) throw new Error(`The release ${rel.tag} has no latest.yml (${res.status}).`)
  const yml = await res.text()
  const file = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const sha512 = /^sha512:\s*(.+)$/m.exec(yml)?.[1]?.trim()
  if (!file || !sha512) throw new Error(`The release ${rel.tag} has an unreadable latest.yml.`)
  return { url: `${rel.base}/${encodeURIComponent(file)}`, file, sha512 }
}
