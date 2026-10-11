/**
 * Command registry: every menu item and shortcut runs a command, so menus,
 * keys and tests share one path. Keys use "Ctrl+Shift+Alt+Key" notation.
 */
import { resetWorkspace, togglePanel } from '../ui/workspace'
import * as D from './doc-actions'
import * as A from './image-actions'
import { activeDoc, activeDocState, get, set, setToolOption, toast, type PanelId, type ToolId } from './store'
import { TOOL_GROUPS, TOOL_LIST } from './tools'
import { canHaveEffects, EFFECT_KINDS, EFFECT_LABELS } from '@core/effects'
import { PROOF_LABELS } from '../engine/ops'
import { docColor, type DocColor } from '@core/model'
import * as T from './transform-actions'
import { commitText } from './vector-actions'

export interface Command {
  id: string
  label: string
  keys?: string[]
  run: () => void
  /** Greyed out in menus when false. */
  enabled?: () => boolean
}

const hasDoc = () => !!activeDoc()
const hasSel = () => !!activeDoc()?.selection
const activeL = () => {
  const d = activeDoc()
  return d?.layers.find((l) => l.id === d.activeLayerId)
}
const hasMask = () => !!activeL()?.mask
const canAddMask = () => {
  const l = activeL()
  return !!l && !l.mask && !l.locked
}
function toggleMask(): void {
  const l = activeL()
  if (l?.mask) A.setMaskEnabled(l.id, !l.mask.enabled)
}
function toggleTarget(): void {
  const d = activeDoc()
  const l = activeL()
  if (d && l?.mask) A.selectLayer(l.id, d.target === 'mask' ? 'pixels' : 'mask')
}
const canStyle = () => {
  const l = activeL()
  return !!l && canHaveEffects(l)
}
const canUndo = () => !!activeDocState()?.history.past.length
const canRedo = () => !!activeDocState()?.history.future.length

function setTool(id: ToolId): void {
  const t = TOOL_LIST.find((x) => x.id === id)
  if (!t) return
  if (t.unavailable) return void toast(t.unavailable, 'info')
  if (get().textEdit) commitText()
  set((s) => ({ tool: id, toolPick: t.group ? { ...s.toolPick, [t.group]: id } : s.toolPick }))
}

export const COMMANDS: Command[] = [
  // File
  { id: 'file.new', label: 'New…', keys: ['Ctrl+N'], run: () => set({ dialog: { kind: 'newDocument' } }) },
  { id: 'file.open', label: 'Open…', keys: ['Ctrl+O'], run: () => void D.openDialog() },
  { id: 'file.close', label: 'Close', keys: ['Ctrl+W'], run: () => void D.closeDocument(), enabled: hasDoc },
  { id: 'file.closeAll', label: 'Close All', keys: ['Ctrl+Alt+W'], run: () => void D.closeAll(), enabled: hasDoc },
  { id: 'file.save', label: 'Save', keys: ['Ctrl+S'], run: () => void D.save(), enabled: hasDoc },
  { id: 'file.saveAs', label: 'Save As…', keys: ['Ctrl+Shift+S'], run: () => void D.save(get().activeId, true), enabled: hasDoc },
  { id: 'file.export', label: 'Export As…', keys: ['Ctrl+Alt+Shift+W'], run: () => set({ dialog: { kind: 'export' } }), enabled: hasDoc },

  // Edit
  { id: 'edit.undo', label: 'Undo', keys: ['Ctrl+Z'], run: () => (T.transforming() ? T.cancelTransform() : D.undo()), enabled: () => T.transforming() || canUndo() },
  { id: 'edit.redo', label: 'Redo', keys: ['Ctrl+Shift+Z'], run: D.redo, enabled: canRedo },
  { id: 'edit.cut', label: 'Cut', keys: ['Ctrl+X'], run: () => void A.copy(false, true), enabled: hasDoc },
  { id: 'edit.copy', label: 'Copy', keys: ['Ctrl+C'], run: () => void A.copy(false), enabled: hasDoc },
  { id: 'edit.copyMerged', label: 'Copy Merged', keys: ['Ctrl+Shift+C'], run: () => void A.copy(true), enabled: hasDoc },
  { id: 'edit.paste', label: 'Paste', keys: ['Ctrl+V'], run: () => void A.paste() },
  { id: 'edit.clear', label: 'Clear', keys: ['Delete', 'Backspace'], run: A.clearSelected, enabled: hasDoc },
  { id: 'edit.fillFg', label: 'Fill with Foreground Color', keys: ['Alt+Backspace', 'Alt+Delete'], run: () => A.fillWith(get().fg), enabled: hasDoc },
  { id: 'edit.freeTransform', label: 'Free Transform', keys: ['Ctrl+T'], run: () => void T.startTransform(), enabled: () => hasDoc() && !T.transforming() },
  { id: 'edit.transform.flipH', label: 'Flip Horizontal', run: () => T.quickTransform('flipH'), enabled: hasDoc },
  { id: 'edit.transform.flipV', label: 'Flip Vertical', run: () => T.quickTransform('flipV'), enabled: hasDoc },
  { id: 'edit.transform.rot180', label: 'Rotate 180°', run: () => T.quickTransform('rot180'), enabled: hasDoc },
  { id: 'edit.transform.rot90', label: 'Rotate 90° Clockwise', run: () => T.quickTransform('rot90'), enabled: hasDoc },
  { id: 'edit.transform.rot270', label: 'Rotate 90° Counter Clockwise', run: () => T.quickTransform('rot270'), enabled: hasDoc },
  { id: 'transform.commit', label: 'Commit Transform', keys: ['Enter'], run: T.commitTransform, enabled: T.transforming },
  { id: 'transform.cancel', label: 'Cancel Transform', keys: ['Escape'], run: T.cancelTransform, enabled: T.transforming },
  { id: 'edit.fillBg', label: 'Fill with Background Color', keys: ['Ctrl+Backspace', 'Ctrl+Delete'], run: () => A.fillWith(get().bg), enabled: hasDoc },

  // Image
  { id: 'image.brightnessContrast', label: 'Brightness/Contrast…', run: () => set({ dialog: { kind: 'adjust', adjustment: 'brightnessContrast' } }), enabled: hasDoc },
  { id: 'image.hueSaturation', label: 'Hue/Saturation…', keys: ['Ctrl+U'], run: () => set({ dialog: { kind: 'adjust', adjustment: 'hueSaturation' } }), enabled: hasDoc },
  { id: 'image.blackWhite', label: 'Black & White…', keys: ['Ctrl+Alt+Shift+B'], run: () => set({ dialog: { kind: 'adjust', adjustment: 'blackWhite' } }), enabled: hasDoc },
  { id: 'image.sepia', label: 'Sepia Tone…', run: () => set({ dialog: { kind: 'adjust', adjustment: 'sepia' } }), enabled: hasDoc },
  { id: 'image.levels', label: 'Levels…', keys: ['Ctrl+L'], run: () => set({ dialog: { kind: 'adjust', adjustment: 'levels' } }), enabled: hasDoc },
  { id: 'image.curves', label: 'Curves…', keys: ['Ctrl+M'], run: () => set({ dialog: { kind: 'adjust', adjustment: 'curves' } }), enabled: hasDoc },
  { id: 'image.invert', label: 'Invert', keys: ['Ctrl+I'], run: A.invertTarget, enabled: hasDoc },
  { id: 'image.desaturate', label: 'Desaturate', keys: ['Ctrl+Shift+U'], run: () => A.applyFilter('grayscale(1)', 'Desaturate'), enabled: hasDoc },
  { id: 'image.mode8', label: '8 Bits/Channel', run: () => modeTo({ depth: 8 }, 'Convert to 8 Bits/Channel'), enabled: hasDoc },
  { id: 'image.mode16', label: '16 Bits/Channel', run: () => modeTo({ depth: 16 }, 'Convert to 16 Bits/Channel'), enabled: hasDoc },
  { id: 'image.toSrgb', label: 'sRGB IEC61966-2.1', run: () => modeTo({ space: 'srgb' }, 'Convert to sRGB'), enabled: hasDoc },
  { id: 'image.toP3', label: 'Display P3', run: () => modeTo({ space: 'display-p3' }, 'Convert to Display P3'), enabled: hasDoc },
  { id: 'image.imageSize', label: 'Image Size…', keys: ['Ctrl+Alt+I'], run: () => set({ dialog: { kind: 'imageSize' } }), enabled: hasDoc },
  { id: 'image.canvasSize', label: 'Canvas Size…', keys: ['Ctrl+Alt+C'], run: () => set({ dialog: { kind: 'canvasSize' } }), enabled: hasDoc },
  { id: 'image.rotateCw', label: 'Rotate 90° Clockwise', run: () => A.transformImage({ kind: 'rotate', turns: 1 }, 'Rotate Canvas'), enabled: hasDoc },
  { id: 'image.rotateCcw', label: 'Rotate 90° Counter Clockwise', run: () => A.transformImage({ kind: 'rotate', turns: 3 }, 'Rotate Canvas'), enabled: hasDoc },
  { id: 'image.rotate180', label: 'Rotate 180°', run: () => A.transformImage({ kind: 'rotate', turns: 2 }, 'Rotate Canvas'), enabled: hasDoc },
  { id: 'image.flipH', label: 'Flip Canvas Horizontal', run: () => A.transformImage({ kind: 'flip', axis: 'h' }, 'Flip Canvas Horizontal'), enabled: hasDoc },
  { id: 'image.flipV', label: 'Flip Canvas Vertical', run: () => A.transformImage({ kind: 'flip', axis: 'v' }, 'Flip Canvas Vertical'), enabled: hasDoc },
  { id: 'image.crop', label: 'Crop to Selection', run: A.cropToSelection, enabled: hasSel },

  // Layer
  { id: 'layer.new', label: 'New Layer', keys: ['Ctrl+Shift+N'], run: A.newLayer, enabled: hasDoc },
  { id: 'layer.newFill', label: 'New Fill Layer (Foreground Color)', run: () => A.newFillLayer(), enabled: hasDoc },
  { id: 'layer.adj.brightnessContrast', label: 'Brightness/Contrast', run: () => A.newAdjustmentLayer('brightnessContrast'), enabled: hasDoc },
  { id: 'layer.adj.hueSaturation', label: 'Hue/Saturation', run: () => A.newAdjustmentLayer('hueSaturation'), enabled: hasDoc },
  { id: 'layer.adj.blackWhite', label: 'Black & White', run: () => A.newAdjustmentLayer('blackWhite'), enabled: hasDoc },
  { id: 'layer.adj.invert', label: 'Invert', run: () => A.newAdjustmentLayer('invert'), enabled: hasDoc },
  { id: 'layer.adj.sepia', label: 'Sepia Tone', run: () => A.newAdjustmentLayer('sepia'), enabled: hasDoc },
  { id: 'layer.adj.levels', label: 'Levels', run: () => A.newAdjustmentLayer('levels'), enabled: hasDoc },
  { id: 'layer.adj.curves', label: 'Curves', run: () => A.newAdjustmentLayer('curves'), enabled: hasDoc },
  { id: 'layer.mask.revealAll', label: 'Reveal All', run: () => A.addLayerMask('revealAll'), enabled: canAddMask },
  { id: 'layer.mask.hideAll', label: 'Hide All', run: () => A.addLayerMask('hideAll'), enabled: canAddMask },
  { id: 'layer.mask.revealSelection', label: 'Reveal Selection', run: () => A.addLayerMask('revealSelection'), enabled: () => canAddMask() && hasSel() },
  { id: 'layer.mask.hideSelection', label: 'Hide Selection', run: () => A.addLayerMask('hideSelection'), enabled: () => canAddMask() && hasSel() },
  { id: 'layer.mask.delete', label: 'Delete', run: () => A.deleteLayerMask(), enabled: hasMask },
  { id: 'layer.mask.apply', label: 'Apply', run: () => A.applyLayerMask(), enabled: hasMask },
  { id: 'layer.mask.toggle', label: 'Disable / Enable', run: toggleMask, enabled: hasMask },
  { id: 'layer.mask.target', label: 'Edit Mask / Pixels', keys: ['Ctrl+\\'], run: toggleTarget, enabled: hasMask },
  { id: 'layer.newGroup', label: 'New Group', run: A.newGroup, enabled: hasDoc },
  { id: 'layer.group', label: 'Group Layers', keys: ['Ctrl+G'], run: A.groupActive, enabled: hasDoc },
  { id: 'layer.ungroup', label: 'Ungroup Layers', keys: ['Ctrl+Shift+G'], run: A.ungroupActive, enabled: () => activeL()?.content.type === 'group' },
  { id: 'layer.duplicate', label: 'Duplicate Layer', run: A.duplicateLayer, enabled: hasDoc },
  { id: 'layer.viaCopy', label: 'New Layer via Copy', keys: ['Ctrl+J'], run: () => A.layerViaCopy(false), enabled: hasDoc },
  { id: 'layer.viaCut', label: 'New Layer via Cut', keys: ['Ctrl+Shift+J'], run: () => A.layerViaCopy(true), enabled: hasSel },
  { id: 'layer.delete', label: 'Delete Layer', run: () => A.deleteLayer(), enabled: hasDoc },
  { id: 'layer.rasterize', label: 'Rasterize Layer', run: A.rasterizeActive, enabled: hasDoc },
  { id: 'layer.forward', label: 'Bring Forward', keys: ['Ctrl+]'], run: () => A.reorderActive(1), enabled: hasDoc },
  { id: 'layer.backward', label: 'Send Backward', keys: ['Ctrl+['], run: () => A.reorderActive(-1), enabled: hasDoc },
  { id: 'layer.mergeDown', label: 'Merge Down', keys: ['Ctrl+E'], run: A.mergeDown, enabled: hasDoc },
  { id: 'layer.mergeVisible', label: 'Merge Visible', keys: ['Ctrl+Shift+E'], run: A.mergeVisible, enabled: hasDoc },
  { id: 'layer.flatten', label: 'Flatten Image', run: A.flattenImage, enabled: hasDoc },

  // Select
  { id: 'select.all', label: 'All', keys: ['Ctrl+A'], run: A.selectAll, enabled: hasDoc },
  { id: 'select.deselect', label: 'Deselect', keys: ['Ctrl+D'], run: A.deselect, enabled: hasSel },
  { id: 'select.inverse', label: 'Inverse', keys: ['Ctrl+Shift+I'], run: A.invertSelection, enabled: hasSel },
  { id: 'select.feather', label: 'Feather…', keys: ['Shift+F6'], run: () => set({ dialog: { kind: 'feather' } }), enabled: hasSel },

  // Filter
  ...EFFECT_KINDS.map((k) => ({ id: `layer.style.${k}`, label: `${EFFECT_LABELS[k]}…`, run: () => set({ dialog: { kind: 'layerStyle', effect: k } }), enabled: canStyle })),
  { id: 'layer.style.clear', label: 'Clear Layer Style', run: () => A.setLayerEffects(activeL()!.id, undefined), enabled: () => canStyle() && !!activeL()?.effects },
  { id: 'select.quickMask', label: 'Edit in Quick Mask Mode', keys: ['Q'], run: A.toggleQuickMask, enabled: hasDoc },
  { id: 'select.colorRange', label: 'Color Range…', run: () => set({ dialog: { kind: 'colorRange' } }), enabled: hasDoc },
  { id: 'filter.blur', label: 'Gaussian Blur…', run: () => set({ dialog: { kind: 'blur' } }), enabled: hasDoc },
  { id: 'filter.motionBlur', label: 'Motion Blur…', run: () => set({ dialog: { kind: 'filter', filter: 'motionBlur' } }), enabled: hasDoc },
  { id: 'filter.unsharp', label: 'Unsharp Mask…', run: () => set({ dialog: { kind: 'filter', filter: 'unsharp' } }), enabled: hasDoc },
  { id: 'filter.noise', label: 'Add Noise…', run: () => set({ dialog: { kind: 'filter', filter: 'noise' } }), enabled: hasDoc },
  { id: 'filter.highPass', label: 'High Pass…', run: () => set({ dialog: { kind: 'filter', filter: 'highPass' } }), enabled: hasDoc },

  // View
  { id: 'view.zoomIn', label: 'Zoom In', keys: ['Ctrl+=', 'Ctrl+Shift+='], run: D.zoomIn, enabled: hasDoc },
  { id: 'view.zoomOut', label: 'Zoom Out', keys: ['Ctrl+-'], run: D.zoomOut, enabled: hasDoc },
  { id: 'view.fit', label: 'Fit on Screen', keys: ['Ctrl+0'], run: D.fitOnScreen, enabled: hasDoc },
  { id: 'view.fill', label: 'Fill Screen', run: D.fillScreen, enabled: hasDoc },
  { id: 'view.actual', label: '100%', keys: ['Ctrl+1'], run: D.actualPixels, enabled: hasDoc },
  { id: 'view.proofColors', label: 'Proof Colors', keys: ['Ctrl+Y'], run: () => set((s) => ({ proofOn: !s.proofOn })), enabled: hasDoc },
  { id: 'view.gamutWarning', label: 'Gamut Warning', keys: ['Ctrl+Shift+Y'], run: () => set((s) => ({ gamutWarning: !s.gamutWarning })), enabled: hasDoc },
  ...(['srgb', 'gray', 'protanopia', 'deuteranopia', 'tritanopia'] as const).map((k) => ({ id: `view.proof.${k}`, label: PROOF_LABELS[k], run: () => set({ proofSetup: k, proofOn: true }), enabled: hasDoc })),
  { id: 'view.rulers', label: 'Rulers', keys: ['Ctrl+R'], run: () => set((s) => ({ showRulers: !s.showRulers })) },
  { id: 'view.pixelGrid', label: 'Pixel Grid', run: () => set((s) => ({ showPixelGrid: !s.showPixelGrid })) },
  { id: 'view.nextDoc', label: 'Next Document', keys: ['Ctrl+Tab'], run: () => cycleDoc(1), enabled: hasDoc },
  { id: 'view.prevDoc', label: 'Previous Document', keys: ['Ctrl+Shift+Tab'], run: () => cycleDoc(-1), enabled: hasDoc },

  // Window
  { id: 'window.reset', label: 'Reset Workspace', run: resetWorkspace },

  // Help
  { id: 'help.shortcuts', label: 'Keyboard Shortcuts', keys: ['Ctrl+/'], run: () => set({ dialog: { kind: 'shortcuts' } }) },
  { id: 'help.about', label: 'About Cadence+', run: () => set({ dialog: { kind: 'about' } }) },

  // Tools & colours
  ...TOOL_LIST.filter((t) => !t.unavailable).map((t) => ({ id: `tool.${t.id}`, label: `${t.label} Tool`, keys: t.group ? [] : [t.key], run: () => setTool(t.id) })),
  // Grouped tools share a key: it picks the group's last-used tool; Shift+key cycles the group.
  ...TOOL_GROUPS.flatMap(({ group, members }) => [
    { id: `tools.${group}`, label: `${members.map((m) => m.label).join(' / ')} Tools`, keys: [members[0].key], run: () => setTool(get().toolPick[group] ?? members[0].id) },
    {
      id: `tools.${group}.next`,
      label: `Next of ${members.map((m) => m.label).join(' / ')}`,
      keys: [`Shift+${members[0].key}`],
      run: () => {
        const cur = members.findIndex((m) => m.id === get().tool)
        const from = cur >= 0 ? cur : members.findIndex((m) => m.id === (get().toolPick[group] ?? members[0].id))
        setTool(members[(from + 1) % members.length].id)
      }
    }
  ]),
  { id: 'tool.sizeDown', label: 'Decrease Brush Size', keys: ['['], run: () => A.stepBrushSize(-1) },
  { id: 'tool.sizeUp', label: 'Increase Brush Size', keys: [']'], run: () => A.stepBrushSize(1) },
  { id: 'tool.softer', label: 'Decrease Brush Hardness', keys: ['Shift+['], run: () => A.stepHardness(-1) },
  { id: 'tool.harder', label: 'Increase Brush Hardness', keys: ['Shift+]'], run: () => A.stepHardness(1) },
  { id: 'color.swap', label: 'Swap Foreground and Background Colors', keys: ['X'], run: A.swapColors },
  { id: 'color.default', label: 'Default Colors', keys: ['D'], run: A.defaultColors },
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => ({ id: `tool.opacity${k}`, label: `Tool Opacity ${k === '0' ? 100 : Number(k) * 10}%`, keys: [k], run: () => setOpacityKey(k) })),
  { id: 'layer.nudgeLeft', label: 'Nudge Left', keys: ['ArrowLeft'], run: () => nudge(-1, 0) },
  { id: 'layer.nudgeRight', label: 'Nudge Right', keys: ['ArrowRight'], run: () => nudge(1, 0) },
  { id: 'layer.nudgeUp', label: 'Nudge Up', keys: ['ArrowUp'], run: () => nudge(0, -1) },
  { id: 'layer.nudgeDown', label: 'Nudge Down', keys: ['ArrowDown'], run: () => nudge(0, 1) },
  { id: 'layer.nudgeLeft10', label: 'Nudge Left 10 px', keys: ['Shift+ArrowLeft'], run: () => nudge(-10, 0) },
  { id: 'layer.nudgeRight10', label: 'Nudge Right 10 px', keys: ['Shift+ArrowRight'], run: () => nudge(10, 0) },
  { id: 'layer.nudgeUp10', label: 'Nudge Up 10 px', keys: ['Shift+ArrowUp'], run: () => nudge(0, -10) },
  { id: 'layer.nudgeDown10', label: 'Nudge Down 10 px', keys: ['Shift+ArrowDown'], run: () => nudge(0, 10) },
  { id: 'crop.commit', label: 'Commit Crop', keys: ['Enter'], run: commitCrop, enabled: () => !!get().crop },
  { id: 'crop.cancel', label: 'Cancel Crop', keys: ['Escape'], run: () => set({ crop: null }), enabled: () => !!get().crop }
]

const byId = new Map(COMMANDS.map((c) => [c.id, c]))
export const command = (id: string): Command | undefined => byId.get(id)

/** Commands that work alongside an open transform; anything else commits it first. */
const TRANSFORM_SAFE = /^(transform\.|edit\.transform\.|edit\.undo$|edit\.freeTransform$|view\.|help\.|color\.|tool\.(size|softer|harder|opacity)|layer\.nudge)/

function execute(c: Command): void {
  if (T.transforming() && !TRANSFORM_SAFE.test(c.id)) T.commitTransform()
  c.run()
}

export function run(id: string): void {
  const c = byId.get(id)
  if (c && (c.enabled?.() ?? true)) execute(c)
}

/** Keys for a command: the user's override, else the default. */
export function keysFor(id: string): string[] {
  return get().keyOverrides[id] ?? byId.get(id)?.keys ?? []
}

export function defaultKeysFor(id: string): string[] {
  return byId.get(id)?.keys ?? []
}

/** Sets (or with null, resets) a command's keys and saves them. */
export function setKeysFor(id: string, keys: string[] | null): void {
  const o = { ...get().keyOverrides }
  if (keys === null || JSON.stringify(keys) === JSON.stringify(defaultKeysFor(id))) delete o[id]
  else o[id] = keys
  set({ keyOverrides: o })
  void window.cadencePlus.setSetting('keymap', o)
}

export function resetAllKeys(): void {
  set({ keyOverrides: {} })
  void window.cadencePlus.setSetting('keymap', {})
}

function modeTo(patch: Partial<DocColor>, label: string): void {
  const d = activeDoc()
  if (d) A.convertDocColor({ ...docColor(d), ...patch }, label)
}

export function currentColor(): DocColor | null {
  const d = activeDoc()
  return d ? docColor(d) : null
}

function cycleDoc(dir: 1 | -1): void {
  const s = get()
  const i = s.docs.findIndex((d) => d.id === s.activeId)
  const n = s.docs.length
  if (n > 1) set({ activeId: s.docs[(i + dir + n) % n].id, crop: null })
}

function nudge(dx: number, dy: number): void {
  const t = get().transform
  if (t) return T.updateTransform({ ...t.params, cx: t.params.cx + dx, cy: t.params.cy + dy })
  if (get().tool === 'move') A.nudgeActive(dx, dy)
}

function setOpacityKey(k: string): void {
  const t = get().tool
  const v = k === '0' ? 100 : Number(k) * 10
  if (t === 'brush' || t === 'eraser' || t === 'clone' || t === 'heal' || t === 'historyBrush') setToolOption(t, { opacity: v })
  else if (t === 'blur' || t === 'sharpen' || t === 'smudge' || t === 'dodge' || t === 'burn' || t === 'sponge') setToolOption(t, { strength: v })
  else if (t === 'bucket' || t === 'gradient') setToolOption(t, { opacity: v })
}

export function commitCrop(): void {
  const r = get().crop
  if (!r) return
  set({ crop: null })
  if (r.w >= 1 && r.h >= 1) A.crop(r)
}

export function panelCommand(id: PanelId): void {
  togglePanel(id)
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Backquote: '`',
  Space: 'Space',
  NumpadAdd: '=',
  NumpadSubtract: '-'
}

/** "Ctrl+Shift+Z" for a keyboard event (layout-independent for letters, digits and brackets). */
export function comboOf(e: KeyboardEvent): string {
  let key: string
  if (e.code.startsWith('Key')) key = e.code.slice(3)
  else if (e.code.startsWith('Digit')) key = e.code.slice(5)
  else if (e.code.startsWith('Numpad') && /\d$/.test(e.code)) key = e.code.slice(-1)
  else key = CODE_KEYS[e.code] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}

let keymap: Map<string, string[]> | null = null
let keymapFor: Record<string, string[]> | null = null

/** A key can serve several commands (Enter commits a transform or a crop); the first enabled one wins. */
function buildKeymap(): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const c of COMMANDS) for (const k of keysFor(c.id)) m.set(k, [...(m.get(k) ?? []), c.id])
  keymapFor = get().keyOverrides
  return m
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['checkbox', 'radio', 'range', 'button'].includes(type)
  }
  return false
}

/** Global key handler; returns true when a command ran. */
export function handleKeydown(e: KeyboardEvent): boolean {
  if (get().dialog) return false
  if (isTyping(e.target)) return false
  if (!keymap || keymapFor !== get().keyOverrides) keymap = buildKeymap()
  const ids = keymap.get(comboOf(e))
  if (!ids) return false
  e.preventDefault()
  const c = ids.map((id) => byId.get(id)!).find((x) => x.enabled?.() ?? true)
  if (c) execute(c)
  return true
}
