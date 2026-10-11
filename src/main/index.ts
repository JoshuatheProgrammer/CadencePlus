import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, shell } from 'electron'
import { IMAGE_EXTENSIONS, RAW_FILE_EXTENSIONS, type RecoveryMeta } from '@shared/ipc'
import { discardRecovery, listRecovery, writeRecovery } from './recovery'
import { addRecent, getSettings, setSetting } from './settings'

if (process.env.CADENCE_PLUS_USER_DATA) app.setPath('userData', process.env.CADENCE_PLUS_USER_DATA)

const APP_BG = '#101114'
const DOC_EXT = 'cadenceimg'

const windowState = new Map<number, { dirty: boolean; allowClose: boolean }>()

function loadRenderer(win: BrowserWindow): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function filesFromArgv(argv: string[]): string[] {
  const exts = [DOC_EXT, ...IMAGE_EXTENSIONS, ...RAW_FILE_EXTENSIONS]
  return argv.slice(1).filter((a) => !a.startsWith('-') && exts.some((e) => a.toLowerCase().endsWith(`.${e}`)) && existsSync(a))
}

function createWindow(openPaths: string[] = []): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    backgroundColor: APP_BG,
    title: 'Cadence+',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: APP_BG, symbolColor: '#929baa', height: 33 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, spellcheck: false }
  })
  const id = win.webContents.id
  windowState.set(id, { dirty: false, allowClose: false })
  win.once('ready-to-show', () => {
    if (process.env.CADENCE_PLUS_NO_MAXIMIZE !== '1') win.maximize()
    win.show()
  })
  win.webContents.once('did-finish-load', () => {
    if (openPaths.length) win.webContents.send('app:open-paths', openPaths)
  })
  win.on('close', (e) => {
    const st = windowState.get(id)
    if (st && st.dirty && !st.allowClose) {
      e.preventDefault()
      win.webContents.send('app:close-requested')
    }
  })
  win.on('closed', () => windowState.delete(id))
  // Electron's default menu is hidden by the custom title bar but its
  // accelerators stay live (Ctrl+R reloads, Ctrl+Shift+I opens DevTools), so
  // it is removed; F12 still opens DevTools in development builds.
  win.webContents.on('before-input-event', (e, input) => {
    if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
      e.preventDefault()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(win)
  return win
}

async function writeAtomic(path: string, data: Uint8Array, backup: boolean): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  await fsp.writeFile(tmp, data)
  if (backup && existsSync(path)) await fsp.copyFile(path, `${path}.bak`).catch(() => undefined)
  await fsp.rename(tmp, path)
}

function registerIpc(): void {
  const win = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender)!
  ipcMain.handle('dialog:open', async (e) => {
    const r = await dialog.showOpenDialog(win(e), {
      title: 'Open',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All supported files', extensions: [DOC_EXT, ...IMAGE_EXTENSIONS, ...RAW_FILE_EXTENSIONS] },
        { name: 'Cadence+ document', extensions: [DOC_EXT] },
        { name: 'Images', extensions: IMAGE_EXTENSIONS },
        { name: 'Camera RAW', extensions: RAW_FILE_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('dialog:saveDocument', async (e, name: string) => {
    const r = await dialog.showSaveDialog(win(e), { title: 'Save As', defaultPath: `${name}.${DOC_EXT}`, filters: [{ name: 'Cadence+ document', extensions: [DOC_EXT] }] })
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle('dialog:export', async (e, name: string, ext: string) => {
    const r = await dialog.showSaveDialog(win(e), { title: 'Export As', defaultPath: `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle('dialog:folder', async (e, title: string) => {
    const r = await dialog.showOpenDialog(win(e), { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('fs:readFile', async (_e, path: string) => new Uint8Array(await fsp.readFile(path)))
  ipcMain.handle('fs:writeFile', (_e, path: string, data: Uint8Array, backup: boolean) => writeAtomic(path, data, backup))
  ipcMain.handle('shell:showInFolder', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('clipboard:writeImage', (_e, png: Uint8Array) =>
    clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }) })])
  )
  ipcMain.handle('clipboard:readImage', async () => {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue
      const blob = (await item.getType('image/png')) as Blob
      return new Uint8Array(await blob.arrayBuffer())
    }
    return null
  })
  ipcMain.handle('recovery:write', (_e, id: string, meta: RecoveryMeta, data: Uint8Array) => writeRecovery(id, meta, data))
  ipcMain.handle('recovery:discard', (_e, id: string) => discardRecovery(id))
  ipcMain.handle('recovery:list', () => listRecovery())
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => setSetting(key, value))
  ipcMain.handle('settings:addRecent', (_e, path: string) => addRecent(path))
  ipcMain.on('window:setTitle', (e, title: string) => BrowserWindow.fromWebContents(e.sender)?.setTitle(title))
  ipcMain.on('window:setDirty', (e, dirty: boolean) => {
    const st = windowState.get(e.sender.id)
    if (st) st.dirty = dirty
  })
  ipcMain.on('window:confirmClose', (e) => {
    const st = windowState.get(e.sender.id)
    if (st) st.allowClose = true
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    const w = BrowserWindow.getAllWindows()[0]
    const paths = filesFromArgv(argv)
    if (!w) return void createWindow(paths)
    if (w.isMinimized()) w.restore()
    w.focus()
    if (paths.length) w.webContents.send('app:open-paths', paths)
  })
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    registerIpc()
    createWindow(filesFromArgv(process.argv))
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
