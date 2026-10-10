/**
 * Global editor state (Zustand). Documents hold their own undo history and
 * view; pixel tiles live in the engine's tile store.
 */
import { create } from 'zustand'
import type { AdjustmentKind } from '@core/adjustments'
import type { History } from '@core/history'
import type { ImageDocument, Rect } from '@core/model'
import type { SelMode } from '@core/selection'
import type { View } from '@core/view'
import { DEFAULT_BRUSH, type BrushOptions } from '../engine/brush'
import type { FilterPreview, StrokePreview } from '../engine/render'

export type ToolId = 'move' | 'marquee' | 'lasso' | 'wand' | 'crop' | 'eyedropper' | 'brush' | 'eraser' | 'bucket' | 'gradient' | 'text' | 'shape' | 'hand' | 'zoom'

export interface ToolOptions {
  marquee: { shape: 'rect' | 'ellipse'; mode: SelMode }
  lasso: { mode: SelMode }
  wand: { mode: SelMode; tolerance: number; contiguous: boolean; sampleAll: boolean }
  brush: BrushOptions
  eraser: BrushOptions
  bucket: { tolerance: number; contiguous: boolean; sampleAll: boolean; opacity: number }
  gradient: { kind: 'linear' | 'radial'; opacity: number; reverse: boolean; toTransparent: boolean }
  eyedropper: { size: number; sampleAll: boolean }
  zoom: { out: boolean }
  move: { autoSelect: boolean }
}

export const DEFAULT_OPTIONS: ToolOptions = {
  marquee: { shape: 'rect', mode: 'replace' },
  lasso: { mode: 'replace' },
  wand: { mode: 'replace', tolerance: 32, contiguous: true, sampleAll: false },
  brush: { ...DEFAULT_BRUSH },
  eraser: { ...DEFAULT_BRUSH, hardness: 100, pressureSize: false },
  bucket: { tolerance: 32, contiguous: true, sampleAll: false, opacity: 100 },
  gradient: { kind: 'linear', opacity: 100, reverse: false, toTransparent: false },
  eyedropper: { size: 1, sampleAll: true },
  zoom: { out: false },
  move: { autoSelect: false }
}

export interface DocState {
  id: string
  history: History<ImageDocument>
  /** null until the viewport fits it on first show. */
  view: View | null
  /** .cadenceimg path once saved. */
  path: string | null
  /** Image the document was opened from (export default name/folder). */
  sourcePath: string | null
  savedRevision: number
}

export type ConfirmButton = { label: string; value: string; primary?: boolean; danger?: boolean }

export type Dialog =
  | { kind: 'newDocument' }
  | { kind: 'about' }
  | { kind: 'shortcuts' }
  | { kind: 'confirm'; title: string; message: string; buttons: ConfirmButton[]; resolve: (v: string) => void }
  | { kind: 'prompt'; title: string; label: string; value: string; resolve: (v: string | null) => void }
  | { kind: 'adjust'; adjustment: AdjustmentKind }
  | { kind: 'blur' }
  | { kind: 'imageSize' }
  | { kind: 'canvasSize' }
  | { kind: 'feather' }
  | { kind: 'export' }

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'warn' | 'success'
  text: string
}

export type PanelId = 'canvas' | 'layers' | 'properties' | 'history' | 'color' | 'swatches' | 'navigator'

export interface EditorState {
  docs: DocState[]
  activeId: string | null
  tool: ToolId
  options: ToolOptions
  fg: string
  bg: string
  colorTarget: 'fg' | 'bg'
  showRulers: boolean
  showPixelGrid: boolean
  dialog: Dialog | null
  toasts: Toast[]
  recent: string[]
  swatches: string[]
  /** Document coordinates under the pointer. */
  cursor: { x: number; y: number } | null
  /** Viewport size in CSS pixels (for fit/zoom commands). */
  viewport: { w: number; h: number }
  stroke: StrokePreview | null
  filterPreview: FilterPreview | null
  /** Pending crop rectangle (document pixels). */
  crop: Rect | null
  busy: string | null
  /** Layer whose mask is shown in place of the image (Alt+click a mask thumbnail). */
  maskView: string | null
}

export const DEFAULT_SWATCHES = [
  '#000000', '#404040', '#808080', '#bfbfbf', '#ffffff',
  '#e02424', '#f26d6d', '#f08c2e', '#e6b450', '#f7e15c',
  '#5cc48d', '#2f9e5e', '#3fb8b0', '#69b7ff', '#2f6fd6',
  '#5145cd', '#a98ee8', '#c94fb3', '#f28cb8', '#8b5a2b'
]

export const useEditor = create<EditorState>(() => ({
  docs: [],
  activeId: null,
  tool: 'brush',
  options: structuredClone(DEFAULT_OPTIONS),
  fg: '#000000',
  bg: '#ffffff',
  colorTarget: 'fg',
  showRulers: true,
  showPixelGrid: true,
  dialog: null,
  toasts: [],
  recent: [],
  swatches: DEFAULT_SWATCHES,
  cursor: null,
  viewport: { w: 800, h: 600 },
  stroke: null,
  filterPreview: null,
  crop: null,
  busy: null,
  maskView: null
}))

export const get = useEditor.getState
export const set = useEditor.setState

export function activeDocState(s: EditorState = get()): DocState | null {
  return s.docs.find((d) => d.id === s.activeId) ?? null
}

export function activeDoc(s: EditorState = get()): ImageDocument | null {
  return activeDocState(s)?.history.present ?? null
}

export const isDirty = (d: DocState): boolean => d.history.revision !== d.savedRevision

export function updateDocState(id: string, fn: (d: DocState) => DocState): void {
  set((s) => ({ docs: s.docs.map((d) => (d.id === id ? fn(d) : d)) }))
}

let toastSeq = 0
export function toast(text: string, kind: Toast['kind'] = 'info', ms = kind === 'error' ? 6500 : 3500): void {
  const id = ++toastSeq
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}

export function setToolOption<K extends keyof ToolOptions>(tool: K, patch: Partial<ToolOptions[K]>): void {
  set((s) => ({ options: { ...s.options, [tool]: { ...s.options[tool], ...patch } } }))
}

/** Shows a confirm dialog and resolves with the chosen button value. */
export function confirm(title: string, message: string, buttons: ConfirmButton[]): Promise<string> {
  return new Promise((resolve) =>
    set({
      dialog: {
        kind: 'confirm',
        title,
        message,
        buttons,
        resolve: (v) => {
          set({ dialog: null })
          resolve(v)
        }
      }
    })
  )
}

export function prompt(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) =>
    set({
      dialog: {
        kind: 'prompt',
        title,
        label,
        value,
        resolve: (v) => {
          set({ dialog: null })
          resolve(v)
        }
      }
    })
  )
}
