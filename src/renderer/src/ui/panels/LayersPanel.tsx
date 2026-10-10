import { memo, useEffect, useRef, useState } from 'react'
import { ADJUSTMENT_KINDS, ADJUSTMENTS } from '@core/adjustments'
import { BLEND_MODES, type ImageDocument, type Layer } from '@core/model'
import { renderDocument } from '../../engine/render'
import { poolCanvas } from '../../engine/tiles'
import * as A from '../../state/image-actions'
import { activeDoc, useEditor } from '../../state/store'
import { keysFor } from '../../state/commands'
import { ScrubNumber, showContextMenu } from '../components'
import { IconEye, IconEyeOff, IconFx, IconLock, IconNewLayer, IconTrash, IconUnlock, IconFillLayer } from '../icons'
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
  return <canvas ref={ref} className="layer-thumb" style={{ width: THUMB, height: THUMB }} />
}, (a, b) => a.layer.content === b.layer.content && a.layer.id === b.layer.id && a.doc.width === b.doc.width && a.doc.height === b.doc.height)

function LayerRow({ doc, layer, active, onDragStart, renaming, setRenaming }: { doc: ImageDocument; layer: Layer; active: boolean; onDragStart: (e: React.PointerEvent, id: string) => void; renaming: boolean; setRenaming: (id: string | null) => void }) {
  const [name, setName] = useState(layer.name)
  useEffect(() => setName(layer.name), [layer.name])
  const kind = layer.content.type === 'fill' ? 'Fill layer' : layer.content.type === 'adjustment' ? 'Adjustment layer' : 'Pixel layer'
  return (
    <div
      className={`layer-row${active ? ' active' : ''}${layer.visible ? '' : ' hidden'}`}
      data-layer={layer.id}
      onPointerDown={(e) => {
        if (e.button !== 0 || renaming) return
        if ((e.target as HTMLElement).closest('button')) return
        A.selectLayer(layer.id)
        onDragStart(e, layer.id)
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.layer-name')) setRenaming(layer.id)
      }}
      onContextMenu={(e) => {
        A.selectLayer(layer.id)
        showContextMenu(e, [
          { label: 'Rename Layer…', action: () => setRenaming(layer.id) },
          { label: 'Duplicate Layer', action: A.duplicateLayer },
          { label: 'Delete Layer', action: () => A.deleteLayer(layer.id), disabled: layer.locked || doc.layers.length < 2 },
          { sep: true },
          { label: 'Select Pixels', action: () => A.selectLayerPixels(layer.id), disabled: layer.content.type === 'adjustment' },
          { label: 'Rasterize Layer', action: A.rasterizeActive, disabled: layer.content.type !== 'fill' },
          { sep: true },
          { label: 'Merge Down', action: A.mergeDown, kbd: keysFor('layer.mergeDown')[0], disabled: doc.layers[0].id === layer.id },
          { label: 'Merge Visible', action: A.mergeVisible, kbd: keysFor('layer.mergeVisible')[0] },
          { label: 'Flatten Image', action: A.flattenImage }
        ])
      }}
      title={`${layer.name} · ${kind}${layer.locked ? ' · locked' : ''}`}
    >
      <button className={`eye${layer.visible ? '' : ' off'}`} title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={() => A.setLayerVisible(layer.id, !layer.visible)}>
        {layer.visible ? <IconEye /> : <IconEyeOff />}
      </button>
      <span
        onPointerDown={(e) => {
          if (e.ctrlKey && e.button === 0) {
            e.stopPropagation()
            A.selectLayerPixels(layer.id)
          }
        }}
        title="Ctrl+click to select this layer's pixels"
      >
        <LayerThumb doc={doc} layer={layer} />
      </span>
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

export function LayersPanel() {
  const doc = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.history.present ?? null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; index: number; y: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  if (!doc) return <div className="panel"><div className="empty-hint">Open or create a document to see its layers.</div></div>
  const active = doc.layers.find((l) => l.id === doc.activeLayerId) ?? null
  const top = [...doc.layers].reverse()

  const startDrag = (e: React.PointerEvent, id: string) => {
    const startY = e.clientY
    let moved = false
    let target: { index: number; y: number } | null = null
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 5) return
      moved = true
      const list = listRef.current
      if (!list) return
      const rows = [...list.querySelectorAll<HTMLElement>('.layer-row')]
      const lr = list.getBoundingClientRect()
      // Gap index in top → bottom order
      let gap = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (ev.clientY < r.top + r.height / 2) {
          gap = i
          break
        }
      }
      const y = gap < rows.length ? rows[gap].getBoundingClientRect().top - lr.top + list.scrollTop : rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom - lr.top + list.scrollTop : 0
      target = { index: gap, y }
      setDrop({ id, ...target })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrop(null)
      const d = activeDoc()
      if (!moved || !target || !d) return
      const from = d.layers.findIndex((l) => l.id === id)
      // Convert top-down gap to a bottom-up index after removal.
      let to = d.layers.length - target.index
      if (from < to) to -= 1
      if (to !== from) A.moveLayerTo(id, to)
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
        {top.map((l) => (
          <LayerRow key={l.id} doc={doc} layer={l} active={l.id === doc.activeLayerId} onDragStart={startDrag} renaming={renaming === l.id} setRenaming={setRenaming} />
        ))}
        {drop && <div className="layer-drop" style={{ top: drop.y - 1 }} />}
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
