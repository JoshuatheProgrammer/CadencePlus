import { memo, useEffect, useRef, useState } from 'react'
import { ADJUSTMENT_KINDS, ADJUSTMENTS } from '@core/adjustments'
import { BLEND_MODES, type ImageDocument, type Layer } from '@core/model'
import { displayRows } from '@core/tree'
import { renderDocument } from '../../engine/render'
import { poolCanvas } from '../../engine/tiles'
import * as A from '../../state/image-actions'
import { activeDoc, set, useEditor } from '../../state/store'
import { keysFor } from '../../state/commands'
import { ScrubNumber, showContextMenu } from '../components'
import { IconChevronDown, IconChevronRight, IconFolder, IconText, IconEye, IconEyeOff, IconFx, IconLock, IconMask, IconNewLayer, IconTrash, IconUnlock, IconFillLayer } from '../icons'
import { checkerTile } from '../tokens'

const THUMB = 34

export const LayerThumb = memo(function LayerThumb({ doc, layer }: { doc: ImageDocument; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const S = Math.round(THUMB * dpr)
    c.width = c.height = S
    const g = c.getContext('2d')!
    g.clearRect(0, 0, S, S)
    const scale = Math.min(S / doc.width, S / doc.height)
    const w = Math.max(1, Math.round(doc.width * scale))
    const h = Math.max(1, Math.round(doc.height * scale))
    const ox = Math.round((S - w) / 2)
    const oy = Math.round((S - h) / 2)
    g.fillStyle = g.createPattern(checkerTile(3 * dpr), 'repeat')!
    g.fillRect(ox, oy, w, h)
    if (layer.content.type === 'adjustment') return
    const tmp = poolCanvas('thumb', S, S)
    renderDocument(tmp, doc, { xf: { scale, ox, oy }, width: S, height: S, onlyLayer: layer.id })
    g.drawImage(tmp, 0, 0)
  }, [layer.id, layer.content, doc.width, doc.height, doc])
  if (layer.content.type === 'adjustment') {
    return (
      <div className="layer-thumb adj" title={ADJUSTMENTS[layer.content.adjustment.kind].label}>
        <IconFx size={16} />
      </div>
    )
  }
  if (layer.content.type === 'group') {
    return (
      <div className="layer-thumb adj type" title="Group">
        <IconFolder size={18} />
      </div>
    )
  }
  if (layer.content.type === 'text') {
    return (
      <div className="layer-thumb adj type" title="Type layer — double-click the text on the canvas with the Type tool to edit">
        <IconText size={18} />
      </div>
    )
  }
  return <canvas ref={ref} className="layer-thumb" style={{ width: THUMB, height: THUMB }} />
}, (a, b) => a.layer.content === b.layer.content && a.layer.id === b.layer.id && a.doc.width === b.doc.width && a.doc.height === b.doc.height)

/** Mask thumbnail: white = visible, black = hidden. */
const MaskThumb = memo(function MaskThumb({ doc, layer }: { doc: ImageDocument; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !layer.mask) return
    const dpr = window.devicePixelRatio || 1
    const S = Math.round(THUMB * dpr)
    c.width = c.height = S
    const g = c.getContext('2d')!
    g.fillStyle = '#2a2d33'
    g.fillRect(0, 0, S, S)
    const scale = Math.min(S / doc.width, S / doc.height)
    const w = Math.max(1, Math.round(doc.width * scale))
    const h = Math.max(1, Math.round(doc.height * scale))
    const ox = Math.round((S - w) / 2)
    const oy = Math.round((S - h) / 2)
    const tmp = poolCanvas('thumb.mask', S, S)
    renderDocument(tmp, doc, { xf: { scale, ox, oy }, width: S, height: S, maskView: layer.id })
    g.drawImage(tmp, 0, 0)
  }, [layer.id, layer.mask, doc.width, doc.height, doc])
  return <canvas ref={ref} className="layer-thumb" style={{ width: THUMB, height: THUMB }} />
}, (a, b) => a.layer.mask === b.layer.mask && a.layer.id === b.layer.id && a.doc.width === b.doc.width && a.doc.height === b.doc.height)

function LayerRow({ doc, layer, depth, active, onDragStart, renaming, setRenaming, dropInto }: { doc: ImageDocument; layer: Layer; depth: number; active: boolean; onDragStart: (e: React.PointerEvent, id: string) => void; renaming: boolean; setRenaming: (id: string | null) => void; dropInto: boolean }) {
  const maskView = useEditor((s) => s.maskView)
  const onMask = active && doc.target === 'mask' && !!layer.mask
  const [name, setName] = useState(layer.name)
  useEffect(() => setName(layer.name), [layer.name])
  const kind = { fill: 'Fill layer', adjustment: 'Adjustment layer', raster: 'Pixel layer', text: 'Type layer', shape: 'Shape layer', group: 'Group' }[layer.content.type]
  const isGroup = layer.content.type === 'group'
  const collapsed = layer.content.type === 'group' && layer.content.collapsed
  return (
    <div
      className={`layer-row${active ? ' active' : ''}${layer.visible ? '' : ' hidden'}${isGroup ? ' group' : ''}${dropInto ? ' drop-into' : ''}`}
      data-layer={layer.id}
      onPointerDown={(e) => {
        if (e.button !== 0 || renaming) return
        if ((e.target as HTMLElement).closest('button')) return
        // Clicking the mask thumbnail targets the mask; anywhere else targets the pixels.
        const toMask = !!(e.target as HTMLElement).closest('.mask-thumb')
        if (!toMask || !(e.shiftKey || e.altKey || e.ctrlKey)) A.selectLayer(layer.id, toMask ? 'mask' : 'pixels')
        onDragStart(e, layer.id)
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.layer-name')) setRenaming(layer.id)
      }}
      onContextMenu={(e) => {
        A.selectLayer(layer.id)
        showContextMenu(e, [
          { label: isGroup ? 'Rename Group…' : 'Rename Layer…', action: () => setRenaming(layer.id) },
          { label: isGroup ? 'Duplicate Group' : 'Duplicate Layer', action: A.duplicateLayer },
          ...(isGroup ? [{ label: 'Ungroup Layers', action: A.ungroupActive, kbd: keysFor('layer.ungroup')[0] }] : [{ label: 'Group Layer', action: A.groupActive, kbd: keysFor('layer.group')[0] }]),
          { label: 'Delete Layer', action: () => A.deleteLayer(layer.id), disabled: layer.locked || doc.layers.length < 2 },
          { sep: true },
          { label: 'Select Pixels', action: () => A.selectLayerPixels(layer.id), disabled: layer.content.type === 'adjustment' },
          { label: 'Rasterize Layer', action: A.rasterizeActive, disabled: layer.content.type === 'raster' || layer.content.type === 'adjustment' },
          { sep: true },
          ...(layer.mask
            ? [
                { label: layer.mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask', action: () => A.setMaskEnabled(layer.id, !layer.mask!.enabled) },
                { label: 'Apply Layer Mask', action: () => A.applyLayerMask(layer.id), disabled: layer.content.type !== 'raster' },
                { label: 'Delete Layer Mask', action: () => A.deleteLayerMask(layer.id) },
                { label: 'Add Mask to Selection', action: () => A.maskToSelection(layer.id) }
              ]
            : [
                { label: 'Add Layer Mask (Reveal All)', action: () => A.addLayerMask('revealAll') },
                { label: 'Add Layer Mask (Hide All)', action: () => A.addLayerMask('hideAll') },
                { label: 'Add Layer Mask (Reveal Selection)', action: () => A.addLayerMask('revealSelection'), disabled: !doc.selection }
              ]),
          { sep: true },
          { label: isGroup ? 'Merge Group' : 'Merge Down', action: A.mergeDown, kbd: keysFor('layer.mergeDown')[0] },
          { label: 'Merge Visible', action: A.mergeVisible, kbd: keysFor('layer.mergeVisible')[0] },
          { label: 'Flatten Image', action: A.flattenImage }
        ])
      }}
      title={`${layer.name} · ${kind}${layer.locked ? ' · locked' : ''}`}
    >
      <button className={`eye${layer.visible ? '' : ' off'}`} title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={() => A.setLayerVisible(layer.id, !layer.visible)}>
        {layer.visible ? <IconEye /> : <IconEyeOff />}
      </button>
      {depth > 0 && <span className="indent" style={{ width: depth * 16 }} />}
      {isGroup ? (
        <button className="chevron" title={collapsed ? 'Expand group' : 'Collapse group'} onClick={() => A.setCollapsed(layer.id, !collapsed)}>
          {collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
        </button>
      ) : depth > 0 ? (
        <span className="chevron-space" />
      ) : null}
      <span
        onPointerDown={(e) => {
          if (e.ctrlKey && e.button === 0) {
            e.stopPropagation()
            A.selectLayerPixels(layer.id)
          }
        }}
        title="Ctrl+click to select this layer's pixels"
      >
        <span className={`thumb-wrap${active && !onMask ? ' targeted' : ''}`}>
          <LayerThumb doc={doc} layer={layer} />
        </span>
      </span>
      {layer.mask && (
        <span
          className={`thumb-wrap mask-thumb${onMask ? ' targeted' : ''}${layer.mask.enabled ? '' : ' disabled'}${maskView === layer.id ? ' viewing' : ''}`}
          title={'Layer mask — click to edit it\nShift+click: enable/disable · Alt+click: view mask · Ctrl+click: load as selection'}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            if (e.shiftKey) {
              e.stopPropagation()
              A.setMaskEnabled(layer.id, !layer.mask!.enabled)
            } else if (e.altKey) {
              e.stopPropagation()
              A.selectLayer(layer.id, 'mask')
              set({ maskView: maskView === layer.id ? null : layer.id })
            } else if (e.ctrlKey) {
              e.stopPropagation()
              A.maskToSelection(layer.id)
            }
          }}
        >
          <MaskThumb doc={doc} layer={layer} />
        </span>
      )}
      <span className="layer-name">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(null)
              if (name.trim() && name !== layer.name) A.renameLayer(layer.id, name)
              else setName(layer.name)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setName(layer.name)
                setRenaming(null)
              }
            }}
          />
        ) : (
          layer.name
        )}
      </span>
      {layer.opacity < 1 && <span className="opacity-badge">{Math.round(layer.opacity * 100)}%</span>}
      {layer.locked && (
        <span className="lock" title="Locked">
          <IconLock size={13} />
        </span>
      )}
    </div>
  )
}

type Drop = { id: string; where: 'above' | 'below' | 'into'; row: string; y: number; indent: number }

export function LayersPanel() {
  const doc = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.history.present ?? null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  if (!doc) return <div className="panel"><div className="empty-hint">Open or create a document to see its layers.</div></div>
  const active = doc.layers.find((l) => l.id === doc.activeLayerId) ?? null
  const rows = displayRows(doc.layers)

  const startDrag = (e: React.PointerEvent, id: string) => {
    const startY = e.clientY
    let moved = false
    let target: Drop | null = null
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 5) return
      moved = true
      const list = listRef.current
      if (!list) return
      const els = [...list.querySelectorAll<HTMLElement>('.layer-row')]
      const lr = list.getBoundingClientRect()
      const current = displayRows(activeDoc()!.layers)
      let found: Drop | null = null
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect()
        if (ev.clientY > r.bottom && i < els.length - 1) continue
        const row = current[i]
        if (!row) break
        const f = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
        const grp = row.layer.content.type === 'group'
        const open = grp && !(row.layer.content as { collapsed: boolean }).collapsed
        // Groups take drops in their middle (or anywhere below the top quarter when expanded).
        const where: Drop['where'] = grp && row.layer.id !== id && (open ? f > 0.25 : f > 0.25 && f < 0.75) ? 'into' : f < 0.5 ? 'above' : 'below'
        const y = (where === 'below' ? r.bottom : r.top) - lr.top + list.scrollTop
        found = { id, where, row: row.layer.id, y, indent: 4 + row.depth * 16 }
        break
      }
      target = found
      setDrop(found)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrop(null)
      const d = activeDoc()
      if (!moved || !target || !d || target.row === id) return
      const rowLayer = d.layers.find((l) => l.id === target!.row)!
      // Flat positions are counted without the dragged layer.
      const without = d.layers.filter((l) => l.id !== id)
      const ri = without.findIndex((l) => l.id === rowLayer.id)
      if (target.where === 'into') A.moveLayerInto(id, rowLayer.id, ri)
      else A.moveLayerInto(id, rowLayer.parent ?? null, target.where === 'above' ? ri + 1 : ri)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="panel">
      <div className="layer-props">
        <select
          value={active?.blend ?? 'normal'}
          disabled={!active || active.locked}
          onChange={(e) => active && A.setLayerBlend(active.id, e.target.value as Layer['blend'])}
          title="Blend mode"
          style={{ flex: 1, minWidth: 0 }}
        >
          {active?.content.type === 'group' && <option value="pass-through">Pass Through</option>}
          {BLEND_MODES.map((m, i) =>
            m ? (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ) : (
              <option key={`sep${i}`} disabled>
                ──────────
              </option>
            )
          )}
        </select>
        <span>Opacity</span>
        <ScrubNumber
          value={Math.round((active?.opacity ?? 1) * 100)}
          min={0}
          max={100}
          unit="%"
          disabled={!active || active.locked}
          onChange={(v) => active && A.setLayerOpacity(active.id, v / 100)}
        />
        <button
          className={`icon-btn${active?.locked ? ' active' : ''}`}
          disabled={!active}
          title={active?.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={() => active && A.setLayerLocked(active.id, !active.locked)}
        >
          {active?.locked ? <IconLock /> : <IconUnlock />}
        </button>
      </div>
      <div className="panel-body layer-list" ref={listRef} style={{ position: 'relative' }}>
        {rows.map(({ layer: l, depth }) => (
          <LayerRow
            key={l.id}
            doc={doc}
            layer={l}
            depth={depth}
            active={l.id === doc.activeLayerId}
            onDragStart={startDrag}
            renaming={renaming === l.id}
            setRenaming={setRenaming}
            dropInto={drop?.where === 'into' && drop.row === l.id}
          />
        ))}
        {drop && drop.where !== 'into' && <div className="layer-drop" style={{ top: drop.y - 1, left: drop.indent }} />}
      </div>
      <div className="panel-footer">
        <button
          className="icon-btn"
          title="New adjustment layer"
          onClick={(e) =>
            showContextMenu(
              { clientX: e.currentTarget.getBoundingClientRect().left, clientY: e.currentTarget.getBoundingClientRect().top - 150 },
              ADJUSTMENT_KINDS.map((k) => ({ label: ADJUSTMENTS[k].label, action: () => A.newAdjustmentLayer(k) }))
            )
          }
        >
          <IconFx />
        </button>
        <button
          className="icon-btn"
          title={active?.mask ? 'This layer already has a mask' : 'Add layer mask (reveals the selection if there is one) · Alt+click: hide all'}
          disabled={!active || !!active.mask || active.locked}
          onClick={(e) => A.addLayerMask(e.altKey ? 'hideAll' : doc.selection ? 'revealSelection' : 'revealAll')}
        >
          <IconMask />
        </button>
        <button className="icon-btn" title="New group (Ctrl+G groups the active layer)" onClick={A.newGroup}>
          <IconFolder />
        </button>
        <button className="icon-btn" title="New fill layer (foreground colour)" onClick={() => A.newFillLayer()}>
          <IconFillLayer />
        </button>
        <button className="icon-btn" title={`New layer (${keysFor('layer.new')[0]})`} onClick={A.newLayer}>
          <IconNewLayer />
        </button>
        <button className="icon-btn" title="Delete layer" disabled={!active || active.locked || doc.layers.length < 2} onClick={() => A.deleteLayer()}>
          <IconTrash />
        </button>
      </div>
    </div>
  )
}
