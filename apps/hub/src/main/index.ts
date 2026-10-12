/**
 * Cadence Hub: installs, updates, launches and removes the Cadence apps
 * (like a free Creative Cloud), and keeps itself up to date.
 */
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { createSelfUpdater } from '@cadence/release/updater'
import { appStates, initApps, install, installWanted, open, refresh, remove } from './apps'
import type { AppId } from './catalog'

declare const __RELEASE__: { owner: string; repo: string }

// Its own settings folder (Cadence Video's is "Cadence").
app.setPath('userData', process.env.CADENCE_HUB_USER_DATA ?? join(app.getPath('appData'), 'Cadence Hub'))

const APP_BG = '#101114'
const updater = createSelfUpdater(__RELEASE__, 'hub-v')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1060,
    height: 700,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: APP_BG,
    title: 'Cadence Hub',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: APP_BG, symbolColor: '#929baa', height: 33 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, spellcheck: false, additionalArguments: [`--cadence-version=${app.getVersion()}`] }
  })
  win.once('ready-to-show', () => win.show())
  // Links (release notes, the repository) open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function registerIpc(): void {
  ipcMain.handle('hub:list', () => appStates())
  ipcMain.handle('hub:refresh', () => refresh())
  ipcMain.handle('hub:install', (_e, id: AppId) => install(id))
  ipcMain.handle('hub:uninstall', (_e, id: AppId) => remove(id))
  ipcMain.handle('hub:open', (_e, id: AppId) => open(id))
  ipcMain.handle('hub:repoUrl', () => (__RELEASE__.owner === 'YOUR_GITHUB' ? null : `https://github.com/${__RELEASE__.owner}/${__RELEASE__.repo}`))
  ipcMain.handle('update:check', (_e, manual: boolean) => updater.check(manual))
  ipcMain.handle('update:status', () => updater.status())
  ipcMain.on('update:install', () => updater.install())
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (!w) return void createWindow()
    if (w.isMinimized()) w.restore()
    w.focus()
  })
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    initApps(__RELEASE__)
    registerIpc()
    createWindow()
    updater.start()
    await refresh()
    await installWanted()
  })
}

app.on('window-all-closed', () => app.quit())
