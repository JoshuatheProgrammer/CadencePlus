/**
 * Global editor state (Zustand). Documents hold their own undo history and
 * view; pixel tiles live in the engine's tile store.
 */
import type { FilterKind, ToneRange } from '@core/filters'
import type { EffectKind, LayerEffects } from '@core/effects'
import type { UpdateStatus } from '@shared/ipc'
import { DEFAULT_PRESETS, type ExportPreset } from '@core/export-presets'
import { create } from 'zustand'
import type { AdjustmentKind } from '@core/adjustments'
import type { History } from '@cadence/core/history'
import type { ImageDocument, Rect } from '@core/model'
import type { SelMode } from '@core/selection'
import type { View } from '@core/view'
import { DEFAULT_BRUSH, type BrushOptions } from '../engine/brush'
import type { TransformParams } from '@core/affine'
import { DEFAULT_TEXT_STYLE, type ShapeKind, type TextStyle } from '@core/vector'
import type { FilterPreview, StrokePreview } from '../engine/render'
import type { FloatState } from '../engine/transform'
import type { ProofKind } from '../engine/ops'

export type ToolId =
  | 'move' | 'marquee' | 'lasso' | 'polyLasso' | 'wand' | 'crop' | 'eyedropper'
  | 'brush' | 'eraser' | 'clone' | 'heal' | 'spotHeal' | 'historyBrush' | 'bucket' | 'gradient'
  | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge'
  | 'text' | 'shape' | 'hand' | 'zoom'

/** Retouching brushes: `strength` is how far one stroke moves the pixels toward the effect. */
export type RetouchOptions = BrushOptions & { strength: number }

export interface ToolOptions {
  marquee: { shape: 'rect' | 'ellipse'; mode: SelMode }
  lasso: { mode: SelMode }
  wand: { mode: SelMode; tolerance: number; contiguous: boolean; sampleAll: boolean }
  brush: BrushOptions
  eraser: BrushOptions
  /** Clone Stamp: `aligned` keeps the source offset between strokes. */
  clone: BrushOptions & { aligned: boolean; sampleAll: boolean }
  heal: BrushOptions & { aligned: boolean; sampleAll: boolean }
  /** Spot Healing Brush: no source; `sampleAll` reads every visible layer. */
  spotHeal: BrushOptions & { sampleAll: boolean }
  /** Paints from the history state chosen in the History panel. */
  historyBrush: BrushOptions
  blur: RetouchOptions
  sharpen: RetouchOptions
  smudge: RetouchOptions
  dodge: RetouchOptions & { range: ToneRange }
  burn: RetouchOptions & { range: ToneRange }
  sponge: RetouchOptions & { desaturate: boolean }
  bucket: { tolerance: number; contiguous: boolean; sampleAll: boolean; opacity: number }
  gradient: { kind: 'linear' | 'radial'; opacity: number; reverse: boolean; toTransparent: boolean }
  eyedropper: { size: number; sampleAll: boolean }
  zoom: { out: boolean }
  move: { autoSelect: boolean }
  /** New type uses this style; editing a type layer shows its own. */
  text: TextStyle
  /** Shapes fill with the foreground colour and stroke with the background colour. */
  shape: { kind: ShapeKind; fill: boolean; stroke: boolean; strokeWidth: number; radius: number; sides: number }
}

export const DEFAULT_OPTIONS: ToolOptions = {
  marquee: { shape: 'rect', mode: 'replace' },
  lasso: { mode: 'replace' },
  wand: { mode: 'replace', tolerance: 32, contiguous: true, sampleAll: false },
  brush: { ...DEFAULT_BRUSH },
  eraser: { ...DEFAULT_BRUSH, hardness: 100, pressureSize: false },
  clone: { ...DEFAULT_BRUSH, hardness: 60, pressureSize: false, aligned: true, sampleAll: false },
  heal: { ...DEFAULT_BRUSH, size: 40, hardness: 50, pressureSize: false, aligned: true, sampleAll: false },
  spotHeal: { ...DEFAULT_BRUSH, size: 30, hardness: 60, pressureSize: false, sampleAll: false },
  historyBrush: { ...DEFAULT_BRUSH, hardness: 50, pressureSize: false },
  blur: { ...DEFAULT_BRUSH, size: 40, hardness: 0, pressureSize: false, strength: 50 },
  sharpen: { ...DEFAULT_BRUSH, size: 40, hardness: 0, pressureSize: false, strength: 50 },
  smudge: { ...DEFAULT_BRUSH, size: 30, hardness: 30, pressureSize: false, spacing: 8, strength: 60 },
  dodge: { ...DEFAULT_BRUSH, size: 60, hardness: 0, pressureSize: false, strength: 50, range: 'midtones' },
  burn: { ...DEFAULT_BRUSH, size: 60, hardness: 0, pressureSize: false, strength: 50, range: 'midtones' },
  sponge: { ...DEFAULT_BRUSH, size: 60, hardness: 0, pressureSize: false, strength: 50, desaturate: true },
  bucket: { tolerance: 32, contiguous: true, sampleAll: false, opacity: 100 },
  gradient: { kind: 'linear', opacity: 100, reverse: false, toTransparent: false },
  eyedropper: { size: 1, sampleAll: true },
  zoom: { out: false },
  move: { autoSelect: false },
  text: { ...DEFAULT_TEXT_STYLE },
  shape: { kind: 'rect', fill: true, stroke: false, strokeWidth: 4, radius: 0, sides: 6 }
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
  | { kind: 'filter'; filter: FilterKind }
  | { kind: 'colorRange' }
  | { kind: 'layerStyle'; effect: EffectKind }
  | { kind: 'exportPresets' }
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
  /** Auto-update progress (main process). */
  update: UpdateStatus
  /** File → Export with Presets (saved in settings). */
  exportPresets: ExportPreset[]
  /** Layer Style dialog preview. */
  effectsPreview: { layerId: string; effects: LayerEffects } | null
  /** Pending crop rectangle (document pixels). */
  crop: Rect | null
  busy: string | null
  /** Layer whose mask is shown in place of the image (Alt+click a mask thumbnail). */
  maskView: string | null
  /** Type being edited on the canvas. `key` coalesces the edits into one undo step. */
  textEdit: { docId: string; layerId: string; key: string; isNew: boolean } | null
  /** Clone Stamp / Healing Brush source (Alt+click) and the offset in use. */
  cloneSource: { docId: string; x: number; y: number } | null
  cloneOffset: { docId: string; dx: number; dy: number } | null
  /** History Brush source: a history state of a document (null: the oldest state kept). */
  historySource: { docId: string; state: ImageDocument } | null
  /** Tool groups: the member last chosen in each group (shown in the tool rail). */
  toolPick: Record<string, ToolId>
  /** Soft proofing (display only): the proof space, whether it is shown, and the gamut warning. */
  proofSetup: ProofKind
  proofOn: boolean
  gamutWarning: boolean
  /** User keyboard shortcuts: command id → keys (replaces the default list). */
  keyOverrides: Record<string, string[]>
  /** Free Transform / selection move in progress. */
  transform: { fs: FloatState; params: TransformParams; mode: 'transform' | 'move' } | null
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
  effectsPreview: null,
  exportPresets: structuredClone(DEFAULT_PRESETS),
  update: { state: 'idle' },
  crop: null,
  busy: null,
  maskView: null,
  transform: null,
  textEdit: null,
  cloneSource: null,
  cloneOffset: null,
  historySource: null,
  toolPick: {},
  keyOverrides: {},
  proofSetup: 'srgb',
  proofOn: false,
  gamutWarning: false
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
