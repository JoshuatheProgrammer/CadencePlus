/** The typed `window.cadencePlus` API exposed by the preload script. */

/** Image formats Chromium decodes natively (8-bit). PSD/TIFF/RAW need libraries later. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'psd']
/** Camera RAW formats (developed with LibRaw). Keep in sync with engine/io RAW_EXTENSIONS. */
export const RAW_FILE_EXTENSIONS = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw']

export interface RecoveryMeta {
  name: string
  /** .cadenceimg path the document was saved to, if any. */
  path: string | null
  sourcePath: string | null
}

export interface RecoveryEntry extends RecoveryMeta {
  id: string
  /** Autosaved copy on disk. */
  file: string
  savedAt: number
}

export interface CadencePlusApi {
  platform: string
  versions: { app: string; electron: string; chrome: string }
  isTest: boolean

  /** Shows the Open dialog (documents and images); returns chosen paths. */
  openDialog(): Promise<string[]>
  /** Save dialog for a .cadenceimg document. */
  saveDocumentDialog(defaultName: string): Promise<string | null>
  /** Save dialog for an exported image. */
  exportDialog(defaultName: string, ext: string): Promise<string | null>
  /** Folder picker (Export with Presets). */
  folderDialog(title: string): Promise<string | null>
  readFile(path: string): Promise<Uint8Array>
  /** Writes via a temp file + rename; `backup` keeps the previous version as .bak. */
  writeFile(path: string, data: Uint8Array, backup?: boolean): Promise<void>
  /** Absolute path for a File dropped from Explorer. */
  pathForFile(file: File): string
  showInFolder(path: string): void

  clipboardWriteImage(png: Uint8Array): Promise<void>
  /** PNG bytes of the clipboard image, or null if it holds none. */
  clipboardReadImage(): Promise<Uint8Array | null>

  writeRecovery(id: string, meta: RecoveryMeta, data: Uint8Array): Promise<void>
  discardRecovery(id: string): Promise<void>
  listRecovery(): Promise<RecoveryEntry[]>

  /** Size and modification time (ms), or null when the file is gone. */
  statFile(path: string): Promise<{ size: number; mtime: number } | null>
  /** Cached home-screen preview of a file. */
  getThumbnail(path: string): Promise<{ png: Uint8Array; meta: Record<string, unknown> & { mtime: number } } | null>
  putThumbnail(path: string, png: Uint8Array, meta: Record<string, unknown>): Promise<void>

  /** The app's licence and third-party notices (generated at build time; null in development). */
  legalTexts(): Promise<{ license: string; notices: string } | null>

  getSettings(): Promise<Record<string, unknown>>
  setSetting(key: string, value: unknown): Promise<void>
  /** Moves `path` to the top of the recent-files list and returns the list. */
  addRecent(path: string): Promise<string[]>

  /** Updates the native window title (taskbar). */
  setTitle(title: string): void
  /** Tells main whether there are unsaved changes (close confirmation). */
  setDirty(dirty: boolean): void
  /** Main asks the renderer to confirm closing a window with unsaved changes. */
  onCloseRequested(cb: () => void): () => void
  confirmClose(): void
  /** Paths passed on the command line / file association. */
  onOpenPaths(cb: (paths: string[]) => void): () => void
}
