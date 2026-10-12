import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HubApi } from '../shared/api'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: HubApi = {
  version: process.argv.find((a) => a.startsWith('--cadence-version='))?.split('=')[1] ?? '0.0.0',
  isTest: process.env.CADENCE_HUB_TEST === '1',
  list: () => ipcRenderer.invoke('hub:list'),
  refresh: () => ipcRenderer.invoke('hub:refresh'),
  install: (id) => ipcRenderer.invoke('hub:install', id),
  uninstall: (id) => ipcRenderer.invoke('hub:uninstall', id),
  open: (id) => ipcRenderer.invoke('hub:open', id),
  repoUrl: () => ipcRenderer.invoke('hub:repoUrl'),
  onApps: (cb) => on('hub:apps', cb),
  checkForUpdates: (manual = false) => ipcRenderer.invoke('update:check', manual),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (cb) => on('update:status', cb)
}

contextBridge.exposeInMainWorld('hub', api)
