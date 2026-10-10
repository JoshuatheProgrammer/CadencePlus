import { useEffect, useState } from 'react'
import { ADJUSTMENTS } from '@core/adjustments'
import { rasterBounds } from '@core/model'
import { selectionBounds } from '../../engine/selection'
import * as A from '../../state/image-actions'
import { useEditor } from '../../state/store'
import { ScrubNumber, SliderField } from '../components'
import { ColorField } from './ColorPanel'

function NameField({ id, name, disabled }: { id: string; name: string; disabled: boolean }) {
  const [v, setV] = useState(name)
  useEffect(() => setV(name), [name])
  return (
    <input
      type="text"
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() && v !== name ? A.renameLayer(id, v) : setV(name))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(name)
      }}
    />
  )
}

export function PropertiesPanel() {
  const doc = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.history.present ?? null)
  if (!doc) return <div className="panel"><div className="empty-hint">No document open.</div></div>
  const l = doc.layers.find((x) => x.id === doc.activeLayerId)
  const sel = doc.selection ? selectionBounds(doc.selection, doc.width, doc.height) : null
  const rb = l?.content.type === 'raster' ? rasterBounds(l.content) : null
  return (
    <div className="panel">
      <div className="panel-body">
        {l && (
          <div className="prop-section">
            <div className="prop-head">
              {l.content.type === 'raster' ? 'Pixel Layer' : l.content.type === 'fill' ? 'Fill Layer' : ADJUSTMENTS[l.content.adjustment.kind].label}
            </div>
            <div className="prop-row">
              <label>Name</label>
              <div className="ctrl">
                <NameField id={l.id} name={l.name} disabled={false} />
              </div>
            </div>
            <div className="prop-row">
              <label>Opacity</label>
              <div className="ctrl">
                <ScrubNumber value={Math.round(l.opacity * 100)} min={0} max={100} unit="%" disabled={l.locked} onChange={(v) => A.setLayerOpacity(l.id, v / 100)} />
              </div>
            </div>
            <div className="prop-row">
              <label>Visible</label>
              <div className="ctrl">
                <input type="checkbox" checked={l.visible} onChange={(e) => A.setLayerVisible(l.id, e.target.checked)} />
              </div>
            </div>
            <div className="prop-row">
              <label>Locked</label>
              <div className="ctrl">
                <input type="checkbox" checked={l.locked} onChange={(e) => A.setLayerLocked(l.id, e.target.checked)} />
              </div>
            </div>
            {l.content.type === 'raster' && (
              <>
                <div className="prop-row">
                  <label>Position</label>
                  <div className="ctrl">
                    <span className="unit">X</span>
                    <ScrubNumber value={l.content.x} disabled={l.locked} onChange={(v) => A.setLayerPosition(l.id, v, (l.content as { y: number }).y, `pos:${l.id}`)} />
                    <span className="unit">Y</span>
                    <ScrubNumber value={l.content.y} disabled={l.locked} onChange={(v) => A.setLayerPosition(l.id, (l.content as { x: number }).x, v, `pos:${l.id}`)} />
                  </div>
                </div>
                <div className="prop-row">
                  <label>Tiles</label>
                  <div className="ctrl">
                    <span className="value dim">
                      {Object.keys(l.content.tiles).length} × 256 px{rb ? ` · ${rb.w} × ${rb.h} area` : ' · empty'}
                    </span>
                  </div>
                </div>
              </>
            )}
            {l.content.type === 'fill' && (
              <div className="prop-row">
                <label>Color</label>
                <div className="ctrl">
                  <ColorField value={l.content.color} disabled={l.locked} onChange={(c) => A.setFillColor(l.id, c)} />
                </div>
              </div>
            )}
            {l.content.type === 'adjustment' &&
              (() => {
                const a = l.content.adjustment
                const def = ADJUSTMENTS[a.kind]
                if (!def.params.length) return <div className="prop-row"><label /><div className="ctrl note">No settings.</div></div>
                return def.params.map((p) => (
                  <div className="prop-row" key={p.id}>
                    <label>{p.label}</label>
                    <div className="ctrl">
                      <SliderField
                        label=""
                        value={a.params[p.id] ?? p.default}
                        min={p.min}
                        max={p.max}
                        unit={p.unit}
                        width={120}
                        onChange={(v) => A.setAdjustmentParams(l.id, { ...a, params: { ...a.params, [p.id]: v } })}
                      />
                    </div>
                  </div>
                ))
              })()}
          </div>
        )}
        <div className="prop-section">
          <div className="prop-head">Document</div>
          <div className="prop-row">
            <label>Size</label>
            <div className="ctrl">
              <span className="value">
                {doc.width} × {doc.height} px
              </span>
            </div>
          </div>
          <div className="prop-row">
            <label>Resolution</label>
            <div className="ctrl">
              <span className="value">{doc.resolution} ppi</span>
            </div>
          </div>
          <div className="prop-row">
            <label>Mode</label>
            <div className="ctrl">
              <span className="value">RGB · 8 bits/channel</span>
            </div>
          </div>
          <div className="prop-row">
            <label>Color profile</label>
            <div className="ctrl">
              <span className="value dim" title="Colour management (ICC profiles, 16-bit) is planned; pixels are treated as sRGB.">sRGB (unmanaged)</span>
            </div>
          </div>
          <div className="prop-row">
            <label>Layers</label>
            <div className="ctrl">
              <span className="value">{doc.layers.length}</span>
            </div>
          </div>
        </div>
        {doc.selection && (
          <div className="prop-section">
            <div className="prop-head">Selection</div>
            <div className="prop-row">
              <label>Bounds</label>
              <div className="ctrl">
                <span className="value">{sel ? `${sel.w} × ${sel.h} px at ${sel.x}, ${sel.y}` : 'Empty'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
