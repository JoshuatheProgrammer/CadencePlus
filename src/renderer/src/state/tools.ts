import type { FunctionComponent } from 'react'
import * as I from '../ui/icons'
import type { ToolId } from './store'

export interface ToolDef {
  id: ToolId
  label: string
  /** Shortcut shown in tooltips. */
  key: string
  icon: FunctionComponent<{ size?: number }>
  /** Not built yet: shown disabled with an explanation. */
  unavailable?: string
  /** One-line usage hint for the options bar. */
  hint: string
  /** Tools sharing a rail slot (and a shortcut: the key picks the group, Shift+key cycles it). */
  group?: string
}

export const TOOLS: (ToolDef | null)[] = [
  { id: 'move', label: 'Move', key: 'V', icon: I.IconMove, hint: 'Drag to move the active layer · arrow keys nudge 1 px, Shift+arrow 10 px' },
  { id: 'marquee', label: 'Marquee', key: 'M', icon: I.IconMarquee, hint: 'Drag to select · Shift adds · Alt subtracts · Shift+Alt intersects · hold Shift after starting for a square' },
  { id: 'lasso', label: 'Lasso', key: 'L', group: 'lasso', icon: I.IconLasso, hint: 'Drag a freehand outline · Shift adds · Alt subtracts' },
  { id: 'polyLasso', label: 'Polygonal Lasso', key: 'L', group: 'lasso', icon: I.IconPolyLasso, hint: 'Click corners · click the first point, double-click or press Enter to close · Backspace removes the last point · Esc cancels · Shift at the first click adds, Alt subtracts' },
  { id: 'wand', label: 'Magic Wand', key: 'W', icon: I.IconWand, hint: 'Click to select similar colours · Shift adds · Alt subtracts' },
  { id: 'crop', label: 'Crop', key: 'C', icon: I.IconCrop, hint: 'Drag a crop area, adjust its edges, then press Enter · Esc cancels' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: I.IconEyedropper, hint: 'Click to pick the foreground colour · Alt+click picks the background colour' },
  null,
  { id: 'brush', label: 'Brush', key: 'B', icon: I.IconBrush, hint: '[ ] size · Shift+[ ] hardness · 1–0 opacity · Shift+click draws a straight line · Alt picks a colour' },
  { id: 'clone', label: 'Clone Stamp', key: 'S', icon: I.IconStamp, hint: 'Alt+click to set the source, then paint · Aligned keeps the offset between strokes' },
  { id: 'heal', label: 'Healing Brush', key: 'J', icon: I.IconHeal, hint: "Alt+click to set the source, then paint over a blemish · the patch takes on the surrounding colour and light when you release" },
  { id: 'historyBrush', label: 'History Brush', key: 'Y', icon: I.IconHistoryBrush, hint: 'Paints pixels back from a history state · click the brush column in the History panel to choose the state (default: the oldest)' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: I.IconEraser, hint: '[ ] size · Shift+[ ] hardness · erases to transparency' },
  { id: 'gradient', label: 'Gradient', key: 'G', icon: I.IconGradient, hint: 'Drag to draw a gradient from the foreground colour · Shift snaps to 45°' },
  { id: 'bucket', label: 'Paint Bucket', key: 'Shift+G', icon: I.IconBucket, hint: 'Click to fill similar colours with the foreground colour' },
  { id: 'blur', label: 'Blur', key: 'R', group: 'focus', icon: I.IconBlurTool, hint: 'Paint to soften detail · Strength sets how much one stroke blurs · stroke again to build up' },
  { id: 'sharpen', label: 'Sharpen', key: 'R', group: 'focus', icon: I.IconSharpen, hint: 'Paint to crisp up detail (unsharp mask) · stroke again to build up' },
  { id: 'smudge', label: 'Smudge', key: 'R', group: 'focus', icon: I.IconSmudge, hint: 'Drag to push pixels like wet paint · Strength sets how far the colour is carried' },
  { id: 'dodge', label: 'Dodge', key: 'O', group: 'tone', icon: I.IconDodge, hint: 'Paint to lighten the chosen tonal range · Exposure sets the amount per stroke' },
  { id: 'burn', label: 'Burn', key: 'O', group: 'tone', icon: I.IconBurn, hint: 'Paint to darken the chosen tonal range · Exposure sets the amount per stroke' },
  { id: 'sponge', label: 'Sponge', key: 'O', group: 'tone', icon: I.IconSponge, hint: 'Paint to saturate or desaturate · Flow sets the amount per stroke' },
  null,
  { id: 'text', label: 'Type', key: 'T', icon: I.IconText, hint: 'Click to add type (or click type to edit it) · Ctrl+Enter or click away to finish · Esc cancels' },
  { id: 'shape', label: 'Shape', key: 'U', icon: I.IconShape, hint: 'Drag to draw · Shift constrains · Alt draws from the centre · fills with the foreground colour, strokes with the background colour' },
  null,
  { id: 'hand', label: 'Hand', key: 'H', icon: I.IconHand, hint: 'Drag to scroll · hold Space with any tool' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: I.IconZoom, hint: 'Click to zoom in · Alt+click zooms out · drag to zoom to an area' }
]

export const TOOL_LIST = TOOLS.filter((t): t is ToolDef => !!t)

/** Tools whose options are brush options (size, hardness, …). */
export const BRUSH_TOOLS = ['brush', 'eraser', 'clone', 'heal', 'historyBrush', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge'] as const
export type BrushToolId = (typeof BRUSH_TOOLS)[number]
export const isBrushTool = (t: ToolId): t is BrushToolId => (BRUSH_TOOLS as readonly string[]).includes(t)

/** Groups with their members, in rail order. */
export const TOOL_GROUPS: { group: string; members: ToolDef[] }[] = [...new Set(TOOL_LIST.map((t) => t.group).filter((g): g is string => !!g))].map((group) => ({
  group,
  members: TOOL_LIST.filter((t) => t.group === group)
}))

/** Command id of a tool's shortcut: its group's for grouped tools. */
export const toolCommand = (t: ToolDef): string => (t.group ? `tools.${t.group}` : `tool.${t.id}`)

/** Members of a tool's group (just the tool when it has none). */
export const groupOf = (id: ToolId): ToolDef[] => {
  const g = toolDef(id).group
  return g ? TOOL_LIST.filter((t) => t.group === g) : [toolDef(id)]
}
export const toolDef = (id: ToolId): ToolDef => TOOL_LIST.find((t) => t.id === id)!
