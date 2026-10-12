/**
 * Self-update for a Cadence app (main process), from its tagged GitHub
 * releases. A check finds the newest release with the app's tag prefix and
 * points electron-updater at that release's files (latest.yml + installer),
 * which it downloads and verifies (SHA-512, and the publisher once releases
 * are signed). The update installs on restart, or on the next normal quit.
 */
import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { isNewer, latestRelease, repoConfigured, type ReleaseRepo } from './releases'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; version: string }
  | { state: 'downloading'; version?: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
  | { state: 'disabled'; message: string }

const { autoUpdater } = electronUpdater
const EVERY = 6 * 60 * 60 * 1000

export interface SelfUpdater {
  start(): void
  check(manual?: boolean): Promise<UpdateStatus>
  install(): void
  status(): UpdateStatus
}

/** `prefix`: this app's release tag prefix, e.g. "plus-v". Status changes go to every window as 'update:status'. */
export function createSelfUpdater(repo: ReleaseRepo, prefix: string): SelfUpdater {
  let status: UpdateStatus = { state: 'idle' }
  let checking = false
  // A test feed (CADENCE_UPDATE_API) serves dummy files that must never run.
  const testFeed = !!process.env.CADENCE_UPDATE_API

  const send = (s: UpdateStatus) => {
    status = s
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', s)
  }

  const disabledReason = (): string | null => {
    if (testFeed) return null
    if (!app.isPackaged) return 'Updates are checked in installed builds only.'
    if (!repoConfigured(repo)) return 'This build has no release repository set (release.config.json).'
    return null
  }

  const check = async (manual = false): Promise<UpdateStatus> => {
    const off = disabledReason()
    if (off) return manual ? (send({ state: 'disabled', message: off }), status) : status
    if (checking || status.state === 'downloading' || status.state === 'ready') return status
    checking = true
    try {
      send({ state: 'checking' })
      const rel = await latestRelease(repo, prefix)
      const current = app.getVersion()
      if (!rel || !isNewer(rel.version, current)) {
        send({ state: 'none', version: current })
        return status
      }
      autoUpdater.setFeedURL({ provider: 'generic', url: rel.base })
      send({ state: 'downloading', version: rel.version, percent: 0 })
      await autoUpdater.checkForUpdates()
      return status
    } catch (e) {
      send({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      return status
    } finally {
      checking = false
    }
  }

  return {
    status: () => status,
    check,
    install() {
      // Windows still ask about unsaved work before the app quits.
      if (status.state === 'ready' && !testFeed) autoUpdater.quitAndInstall(false, true)
    },
    start() {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = !testFeed
      autoUpdater.allowDowngrade = false
      // Releases are signed after building, so there are no block maps: always download the full installer.
      autoUpdater.disableDifferentialDownload = true
      autoUpdater.disableWebInstaller = true
      autoUpdater.logger = null
      // Progress events can arrive after the download finished; never step back from 'ready'.
      autoUpdater.on('download-progress', (p) => status.state !== 'ready' && send({ state: 'downloading', version: status.state === 'downloading' ? status.version : undefined, percent: Math.round(p.percent) }))
      autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }))
      autoUpdater.on('error', (e) => send({ state: 'error', message: e.message }))
      if (disabledReason()) return
      setTimeout(() => void check(), 15_000)
      setInterval(() => void check(), EVERY)
    }
  }
}
