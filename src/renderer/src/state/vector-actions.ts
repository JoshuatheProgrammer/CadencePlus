/**
 * Type and shape layers: creating them, editing text on the canvas (one undo
 * step per editing session), and changing their style.
 */
import { paramsForRect, type TransformParams } from '@core/affine'
import * as E from '@core/edit'
import { dropLast } from '@core/history'
import { activeLayer, isVector, uid, type Rect } from '@core/model'
import type { ShapeData, TextData, TextStyle } from '@core/vector'
import { layoutText, vectorSize } from '../engine/vector'
import { edit, editDoc } from './doc-actions'
import { activeDoc, activeDocState, get, set, toast, updateDocState } from './store'

/** Layer name for type: its first line, like Photoshop. */
function typeName(text: string): string {
  const first = text.split(/\r?\n/)[0].trim()
  return first ? (first.length > 32 ? `${first.slice(0, 31)}…` : first) : 'Type'
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** Starts new point type with its baseline at (x, y). */
export function startNewText(x: number, y: number): void {
  const ds = activeDocState()
  if (!ds) return
  const data: TextData = { ...get().options.text, color: get().fg, text: '' }
  const L = layoutText(data)
  const params = paramsForRect({ x, y: y - L.ascent, w: L.w, h: L.h })
  const key = uid('type')
  const ok = editDoc(ds.id, 'Type Layer', (d) => void E.addLayer(d, { type: 'text', text: data, params }, 'Type'), key)
  const id = get().docs.find((d) => d.id === ds.id)!.history.present.activeLayerId!
  if (ok) set({ textEdit: { docId: ds.id, layerId: id, key, isNew: true } })
}

/** Opens an existing type layer for editing. */
export function editText(layerId: string): void {
  const ds = activeDocState()
  const l = ds?.history.present.layers.find((x) => x.id === layerId)
  if (!ds || !l || l.content.type !== 'text') return
  if (l.locked) return void toast(`“${l.name}” is locked. Unlock it to edit its text.`, 'warn')
  if (ds.history.present.activeLayerId !== layerId) updateActive(layerId)
  set({ textEdit: { docId: ds.id, layerId, key: uid('type'), isNew: false } })
}

function updateActive(id: string): void {
  const ds = activeDocState()
  if (!ds) return
  // Selecting a layer is not an undo step.
  updateDocState(ds.id, (d) => ({ ...d, history: { ...d.history, present: { ...d.history.present, activeLayerId: id, target: 'pixels' }, revision: d.history.revision + 1, coalesceKey: null } }))
}

function editedLayer() {
  const te = get().textEdit
  const ds = te && get().docs.find((d) => d.id === te.docId)
  const l = ds?.history.present.layers.find((x) => x.id === te!.layerId)
  return te && ds && l && l.content.type === 'text' ? { te, ds, l, c: l.content } : null
}

/** Replaces the text (and optionally style) of the layer being edited. */
export function updateText(text: string, style?: Partial<TextStyle>): void {
  const e = editedLayer()
  if (!e) return
  const next: TextData = { ...e.c.text, ...style, text }
  const before = vectorSize(e.c)
  const after = vectorSize({ ...e.c, text: next })
  editDoc(
    e.ds.id,
    e.te.isNew ? 'Type Layer' : 'Edit Type',
    (d) => {
      E.setText(d, e.l.id, next, before, after)
      if (e.te.isNew) E.renameLayer(d, e.l.id, typeName(text))
    },
    e.te.key
  )
}

function dropSession(docId: string, key: string): boolean {
  const ds = get().docs.find((d) => d.id === docId)
  if (!ds || ds.history.coalesceKey !== key) return false
  updateDocState(docId, (d) => ({ ...d, history: dropLast(d.history) }))
  return true
}

/** Ends editing; new type that was left empty disappears without an undo step. */
export function commitText(): void {
  const e = editedLayer()
  const te = get().textEdit
  set({ textEdit: null })
  if (!te || !e) return
  if (!e.c.text.text.trim()) {
    if (te.isNew) dropSession(te.docId, te.key)
    else editDoc(te.docId, 'Delete Layer', (d) => E.deleteLayer(d, te.layerId))
  }
}

/** Esc: throws away this editing session's changes. */
export function cancelText(): void {
  const te = get().textEdit
  set({ textEdit: null })
  if (te) dropSession(te.docId, te.key)
}

/** Options bar / Properties: restyles the active type layer (or the defaults for new type). */
export function setTextStyle(style: Partial<TextStyle>): void {
  set((s) => ({ options: { ...s.options, text: { ...s.options.text, ...style } } }))
  const e = editedLayer()
  if (e) return updateText(e.c.text.text, style)
  const d = activeDoc()
  const l = d && activeLayer(d)
  // New type uses the foreground colour, so the colour control edits it.
  if (!l || l.content.type !== 'text') return void (style.color && set({ fg: style.color }))
  const next = { ...l.content.text, ...style }
  const before = vectorSize(l.content)
  const after = vectorSize({ ...l.content, text: next })
  edit('Type Style', (x) => E.setText(x, l.id, next, before, after), `typestyle:${l.id}:${Object.keys(style).join()}`)
}

/** Topmost type layer whose box contains document point (x, y). */
export function textLayerAt(x: number, y: number): string | null {
  const d = activeDoc()
  if (!d) return null
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i]
    if (!l.visible || l.content.type !== 'text') continue
    const s = vectorSize(l.content)
    const p = l.content.params
    const dx = x - p.cx
    const dy = y - p.cy
    const cos = Math.cos(p.rot)
    const sin = Math.sin(p.rot)
    const lx = (dx * cos + dy * sin) / p.sx
    const ly = (-dx * sin + dy * cos) / p.sy
    if (Math.abs(lx) <= s.w / 2 + 4 && Math.abs(ly) <= s.h / 2 + 4) return l.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Creates a shape layer filling `r` (or, for lines, from `a` to `b`). */
export function createShape(r: Rect, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const s = get()
  const o = s.options.shape
  let shape: ShapeData
  let params: TransformParams
  if (o.kind === 'line') {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1) return
    const h = Math.max(1, o.strokeWidth)
    shape = { kind: 'line', w: len, h, fill: null, stroke: s.fg, strokeWidth: Math.max(1, o.strokeWidth), radius: 0, sides: o.sides }
    params = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, sx: 1, sy: 1, rot: Math.atan2(b.y - a.y, b.x - a.x) }
  } else {
    if (r.w < 1 || r.h < 1) return
    shape = { kind: o.kind, w: r.w, h: r.h, fill: o.fill ? s.fg : null, stroke: o.stroke ? s.bg : null, strokeWidth: o.strokeWidth, radius: o.radius, sides: o.sides }
    if (!shape.fill && !shape.stroke) shape.fill = s.fg
    params = paramsForRect(r)
  }
  const name = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', polygon: 'Polygon' }[o.kind]
  edit(`${name} Shape`, (d) => void E.addLayer(d, { type: 'shape', shape, params }, E.nextLayerName(d, name)))
}

export function updateShape(id: string, patch: Partial<ShapeData>): void {
  const d = activeDoc()
  const l = d?.layers.find((x) => x.id === id)
  if (!l || l.content.type !== 'shape') return
  edit('Shape', (x) => E.setShape(x, id, { ...(l.content as { shape: ShapeData }).shape, ...patch }), `shape:${id}:${Object.keys(patch).join()}`)
}

/** Moves a type/shape layer by (dx, dy) from `start`. */
export function moveVector(id: string, start: TransformParams, dx: number, dy: number, coalesce: string): void {
  edit('Move', (x) => E.setVectorParams(x, id, { ...start, cx: start.cx + dx, cy: start.cy + dy }), coalesce)
}

export const isVectorLayerActive = (): boolean => {
  const d = activeDoc()
  const l = d && activeLayer(d)
  return !!l && isVector(l.content)
}
