import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { CadencePlusApi } from '@shared/ipc'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: CadencePlusApi = {
  platform: process.platform,
  versions: { app: process.env.npm_package_version ?? '0.1.0', electron: process.versions.electron, chrome: process.versions.chrome },
  isTest: process.env.CADENCE_PLUS_TEST === '1',

  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveDocumentDialog: (n) => ipcRenderer.invoke('dialog:saveDocument', n),
  exportDialog: (n, ext) => ipcRenderer.invoke('dialog:export', n, ext),
  folderDialog: (t) => ipcRenderer.invoke('dialog:folder', t),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p, d, b = false) => ipcRenderer.invoke('fs:writeFile', p, d, b),
  pathForFile: (f) => webUtils.getPathForFile(f),
  showInFolder: (p) => void ipcRenderer.invoke('shell:showInFolder', p),

  clipboardWriteImage: (png) => ipcRenderer.invoke('clipboard:writeImage', png),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard:readImage'),

  writeRecovery: (id, meta, data) => ipcRenderer.invoke('recovery:write', id, meta, data),
  discardRecovery: (id) => ipcRenderer.invoke('recovery:discard', id),
  listRecovery: () => ipcRenderer.invoke('recovery:list'),

  statFile: (p) => ipcRenderer.invoke('fs:stat', p),
  getThumbnail: (p) => ipcRenderer.invoke('thumbs:get', p),
  putThumbnail: (p, png, meta) => ipcRenderer.invoke('thumbs:put', p, png, meta),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (k, v) => ipcRenderer.invoke('settings:set', k, v),
  addRecent: (p) => ipcRenderer.invoke('settings:addRecent', p),

  setTitle: (t) => ipcRenderer.send('window:setTitle', t),
  setDirty: (d) => ipcRenderer.send('window:setDirty', d),
  onCloseRequested: (cb) => on('app:close-requested', cb),
  confirmClose: () => ipcRenderer.send('window:confirmClose'),
  onOpenPaths: (cb) => on('app:open-paths', cb)
}

contextBridge.exposeInMainWorld('cadencePlus', api)
