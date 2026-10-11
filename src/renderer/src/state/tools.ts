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
}

export const TOOLS: (ToolDef | null)[] = [
  { id: 'move', label: 'Move', key: 'V', icon: I.IconMove, hint: 'Drag to move the active layer · arrow keys nudge 1 px, Shift+arrow 10 px' },
  { id: 'marquee', label: 'Marquee', key: 'M', icon: I.IconMarquee, hint: 'Drag to select · Shift adds · Alt subtracts · Shift+Alt intersects · hold Shift after starting for a square' },
  { id: 'lasso', label: 'Lasso', key: 'L', icon: I.IconLasso, hint: 'Drag a freehand outline · Shift adds · Alt subtracts' },
  { id: 'wand', label: 'Magic Wand', key: 'W', icon: I.IconWand, hint: 'Click to select similar colours · Shift adds · Alt subtracts' },
  { id: 'crop', label: 'Crop', key: 'C', icon: I.IconCrop, hint: 'Drag a crop area, adjust its edges, then press Enter · Esc cancels' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: I.IconEyedropper, hint: 'Click to pick the foreground colour · Alt+click picks the background colour' },
  null,
  { id: 'brush', label: 'Brush', key: 'B', icon: I.IconBrush, hint: '[ ] size · Shift+[ ] hardness · 1–0 opacity · Shift+click draws a straight line · Alt picks a colour' },
  { id: 'clone', label: 'Clone Stamp', key: 'S', icon: I.IconStamp, hint: 'Alt+click to set the source, then paint · Aligned keeps the offset between strokes' },
  { id: 'heal', label: 'Healing Brush', key: 'J', icon: I.IconHeal, hint: "Alt+click to set the source, then paint over a blemish · the patch takes on the surrounding colour and light when you release" },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: I.IconEraser, hint: '[ ] size · Shift+[ ] hardness · erases to transparency' },
  { id: 'gradient', label: 'Gradient', key: 'G', icon: I.IconGradient, hint: 'Drag to draw a gradient from the foreground colour · Shift snaps to 45°' },
  { id: 'bucket', label: 'Paint Bucket', key: 'Shift+G', icon: I.IconBucket, hint: 'Click to fill similar colours with the foreground colour' },
  null,
  { id: 'text', label: 'Type', key: 'T', icon: I.IconText, hint: 'Click to add type (or click type to edit it) · Ctrl+Enter or click away to finish · Esc cancels' },
  { id: 'shape', label: 'Shape', key: 'U', icon: I.IconShape, hint: 'Drag to draw · Shift constrains · Alt draws from the centre · fills with the foreground colour, strokes with the background colour' },
  null,
  { id: 'hand', label: 'Hand', key: 'H', icon: I.IconHand, hint: 'Drag to scroll · hold Space with any tool' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: I.IconZoom, hint: 'Click to zoom in · Alt+click zooms out · drag to zoom to an area' }
]

export const TOOL_LIST = TOOLS.filter((t): t is ToolDef => !!t)
export const toolDef = (id: ToolId): ToolDef => TOOL_LIST.find((t) => t.id === id)!
