/**
 * Cadence Hub window: your apps (install, open, update, remove), updates,
 * and about.
 */
import { useEffect, useState } from 'react'
import { ContextMenuHost, showContextMenu } from '@cadence/ui/components'
import { TooltipHost } from '@cadence/ui/Tooltip'
import plusLogo from '@cadence/ui/assets/cadence-logo.svg'
import videoLogo from '@cadence/ui/assets/cadence-video-logo.svg'
import type { AppId, AppState, UpdateStatus } from '../../shared/api'

const LOGOS: Record<AppId, string> = { plus: plusLogo, video: videoLogo }

type View = 'apps' | 'updates' | 'about'

const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
function newer(a: string, b: string): boolean {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}
const hasUpdate = (s: AppState) => !!(s.installed && s.latest && newer(s.latest.version, s.installed.version))

function statusLine(s: AppState): string {
  if (s.busy) {
    const what = { install: 'Installing', update: 'Updating', uninstall: 'Removing' }[s.busy.action]
    return s.busy.stage === 'downloading' ? `${what} — downloading ${s.busy.percent}%` : `${what}…`
  }
  if (s.installed && hasUpdate(s)) return `Installed ${s.installed.version} · update ${s.latest!.version} available`
  if (s.installed) return `Installed · version ${s.installed.version}${s.latest ? ' · up to date' : ''}`
  if (s.latest) return `Not installed · version ${s.latest.version} available`
  if (s.releaseError) return 'Not installed'
  return s.wanted ? 'Not released yet — it will install automatically when it is' : 'Not released yet'
}

function AppRow({ s }: { s: AppState }) {
  const busy = !!s.busy
  const primary = () => {
    if (s.installed && !hasUpdate(s)) return void window.hub.open(s.id)
    void window.hub.install(s.id)
  }
  const label = !s.installed ? (s.latest ? 'Install' : s.wanted ? 'Waiting for release' : 'Notify me') : hasUpdate(s) ? 'Update' : 'Open'
  const canPrimary = !busy && (!!s.installed || !!s.latest || (!s.wanted && !s.releaseError))
  return (
    <div className={`app-row${busy ? ' busy' : ''}`} data-app={s.id}>
      <img className="app-icon" src={LOGOS[s.id]} alt="" />
      <div className="app-text">
        <div className="app-name">
          {s.name}
          <span className="app-tagline">{s.tagline}</span>
        </div>
        <div className="app-desc">{s.description}</div>
        <div className={`app-status${s.error ? ' error' : ''}`}>{s.error ?? statusLine(s)}</div>
        {s.busy && (
          <div className="progress" role="progressbar" aria-valuenow={s.busy.percent} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${s.busy.stage === 'downloading' ? s.busy.percent : 100}%` }} className={s.busy.stage === 'downloading' ? '' : 'indeterminate'} />
          </div>
        )}
      </div>
      <div className="app-actions">
        <button className={`btn${s.installed && !hasUpdate(s) ? '' : ' primary'}`} disabled={!canPrimary} onClick={primary} title={!s.installed && !s.latest ? 'Cadence Hub will install it as soon as the first version is released' : undefined}>
          {label}
        </button>
        <button
          className="btn more"
          aria-label={`More for ${s.name}`}
          disabled={busy}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            showContextMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
              { label: 'Open', action: () => void window.hub.open(s.id), disabled: !s.installed },
              { label: hasUpdate(s) ? `Update to ${s.latest!.version}` : 'Reinstall', action: () => void window.hub.install(s.id), disabled: !s.latest },
              { sep: true },
              { label: 'Release notes', action: () => s.latest && window.open(s.latest.url.replace('/releases/download/', '/releases/tag/')), disabled: !s.latest },
              { sep: true },
              { label: 'Uninstall', action: () => void window.hub.uninstall(s.id), disabled: !s.installed, danger: true }
            ])
          }}
        >
          ⋯
        </button>
      </div>
    </div>
  )
}

function AppsView({ apps, onRefresh, refreshing }: { apps: AppState[]; onRefresh: () => void; refreshing: boolean }) {
  const err = apps.find((a) => a.releaseError)?.releaseError
  return (
    <>
      <header className="view-head">
        <div>
          <h1>Apps</h1>
          <p className="sub">Every Cadence app is free and open source. Install what you need; updates arrive on their own.</p>
        </div>
        <button className="btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Checking…' : 'Check again'}
        </button>
      </header>
      {err && <div className="banner">{err}</div>}
      <div className="app-list">{apps.map((s) => <AppRow key={s.id} s={s} />)}</div>
    </>
  )
}

function UpdatesView({ apps, hubUpdate }: { apps: AppState[]; hubUpdate: UpdateStatus }) {
  const pending = apps.filter(hasUpdate)
  const hub =
    hubUpdate.state === 'ready'
      ? `Cadence Hub ${hubUpdate.version} is ready.`
      : hubUpdate.state === 'downloading'
        ? `Downloading Cadence Hub ${hubUpdate.version ?? ''} — ${hubUpdate.percent}%`
        : hubUpdate.state === 'none'
          ? `Cadence Hub ${hubUpdate.version} is up to date.`
          : hubUpdate.state === 'error'
            ? `Couldn't check for Cadence Hub updates: ${hubUpdate.message}`
            : hubUpdate.state === 'disabled'
              ? hubUpdate.message
              : hubUpdate.state === 'checking'
                ? 'Checking for Cadence Hub updates…'
                : `Cadence Hub ${window.hub.version}`
  return (
    <>
      <header className="view-head">
        <div>
          <h1>Updates</h1>
          <p className="sub">{pending.length ? `${pending.length} app update${pending.length > 1 ? 's' : ''} available.` : 'All your apps are up to date.'}</p>
        </div>
        {pending.length > 1 && (
          <button className="btn primary" onClick={() => pending.forEach((s) => void window.hub.install(s.id))}>
            Update all
          </button>
        )}
      </header>
      <div className="app-list">{pending.map((s) => <AppRow key={s.id} s={s} />)}</div>
      <div className="hub-update">
        <span>{hub}</span>
        {hubUpdate.state === 'ready' ? (
          <button className="btn primary" onClick={() => window.hub.installUpdate()}>
            Restart to update
          </button>
        ) : (
          <button className="btn" onClick={() => void window.hub.checkForUpdates(true)} disabled={hubUpdate.state === 'checking' || hubUpdate.state === 'downloading'}>
            Check for Hub updates
          </button>
        )}
      </div>
    </>
  )
}

function AboutView() {
  const [repo, setRepo] = useState<string | null>(null)
  useEffect(() => void window.hub.repoUrl().then(setRepo), [])
  return (
    <>
      <header className="view-head">
        <div>
          <h1>About</h1>
          <p className="sub">Cadence Hub {window.hub.version}</p>
        </div>
      </header>
      <div className="about">
        <img src={plusLogo} alt="" width={64} height={64} />
        <div>
          <p>Cadence is a free, open-source creative suite: Cadence+ for images and Cadence Video for video, installed and kept up to date by Cadence Hub. No accounts, no subscriptions, no payments.</p>
          <p className="note">Released under the MIT licence. Anyone can read, change and share the code.</p>
          {repo && (
            <p>
              <a href={repo} target="_blank" rel="noreferrer">
                Source code and releases on GitHub
              </a>
            </p>
          )}
        </div>
      </div>
    </>
  )
}

export function App() {
  const [apps, setApps] = useState<AppState[]>([])
  const [view, setView] = useState<View>('apps')
  const [hubUpdate, setHubUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    void window.hub.list().then(setApps)
    void window.hub.getUpdateStatus().then(setHubUpdate)
    const a = window.hub.onApps(setApps)
    const u = window.hub.onUpdateStatus(setHubUpdate)
    return () => {
      a()
      u()
    }
  }, [])
  const refresh = () => {
    setRefreshing(true)
    void window.hub.refresh().finally(() => setRefreshing(false))
  }
  const updates = apps.filter(hasUpdate).length + (hubUpdate.state === 'ready' ? 1 : 0)
  return (
    <div className="hub">
      <div className="titlebar">
        <img src={plusLogo} alt="" width={18} height={18} />
        <span>Cadence Hub</span>
      </div>
      <nav className="side" aria-label="Sections">
        {(
          [
            ['apps', 'Apps'],
            ['updates', 'Updates'],
            ['about', 'About']
          ] as [View, string][]
        ).map(([v, l]) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)} aria-current={view === v}>
            {l}
            {v === 'updates' && updates > 0 && <span className="count">{updates}</span>}
          </button>
        ))}
        <span className="grow" />
        <span className="foot">Free &amp; open source</span>
      </nav>
      <main className="content">
        {view === 'apps' && <AppsView apps={apps} onRefresh={refresh} refreshing={refreshing} />}
        {view === 'updates' && <UpdatesView apps={apps} hubUpdate={hubUpdate} />}
        {view === 'about' && <AboutView />}
      </main>
      <ContextMenuHost />
      <TooltipHost />
    </div>
  )
}
