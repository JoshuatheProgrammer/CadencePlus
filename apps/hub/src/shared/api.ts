/** The bridge between the hub window and its main process. */
import type { UpdateStatus } from '@cadence/release/updater'
import type { AppState } from '../main/apps'
import type { AppId } from '../main/catalog'

export type { AppId, AppState, UpdateStatus }

export interface HubApi {
  version: string
  isTest: boolean
  list(): Promise<AppState[]>
  refresh(): Promise<AppState[]>
  install(id: AppId): Promise<void>
  uninstall(id: AppId): Promise<void>
  open(id: AppId): Promise<void>
  /** The project's GitHub page, or null before releases are set up. */
  repoUrl(): Promise<string | null>
  onApps(cb: (apps: AppState[]) => void): () => void
  checkForUpdates(manual?: boolean): Promise<UpdateStatus>
  getUpdateStatus(): Promise<UpdateStatus>
  installUpdate(): void
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
}

declare global {
  interface Window {
    hub: HubApi
  }
}
