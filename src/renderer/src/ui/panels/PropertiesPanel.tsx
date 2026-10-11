import { useEffect, useState } from 'react'
import { ADJUSTMENTS } from '@core/adjustments'
import { rasterBounds } from '@core/model'
import { selectionBounds } from '../../engine/selection'
import * as A from '../../state/image-actions'
import { useEditor } from '../../state/store'
import { histogram } from '@core/lut'
import { docColor, type ImageDocument } from '@core/model'
import { renderComposite } from '../../engine/render'
import { AdjustmentEditor, type Histograms } from '../AdjustmentEditor'
import { ShapeProps, TextContentField, TextStyleControls } from '../VectorControls'
import { ScrubNumber } from '../components'
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

const histCache = new WeakMap<object, Histograms>()

/** Histogram of the image beneath an adjustment layer (cached per layer stack). */
function histogramBelow(doc: ImageDocument, id: string): Histograms {
  const i = doc.layers.findIndex((l) => l.id === id)
  const below = doc.layers.slice(0, i)
  const key = below[below.length - 1] ?? doc
  const hit = histCache.get(key)
  if (hit !== undefined) return hit
  const c = renderComposite({ ...doc, layers: below }, 'hist.below')
  const h = histogram(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
  histCache.set(key, h)
  return h
}

export function PropertiesPanel() {
  const doc = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.history.present ?? null)
  if (!doc) return <div className="panel"><div className="empty-hint">No document open.</div></div>
  const l = doc.layers.find((x) => x.id === doc.activeLayerId)
  const sel = doc.selection ? selectionBounds(doc.selection, doc.width, doc.height) : null
  const rb = l?.content.type === 'raster' ? rasterBounds(l.content) : null
  const hist = l?.content.type === 'adjustment' ? histogramBelow(doc, l.id) : null
  return (
    <div className="panel">
      <div className="panel-body">
        {l && (
          <div className="prop-section">
            <div className="prop-head">
              {l.content.type === 'adjustment' ? ADJUSTMENTS[l.content.adjustment.kind].label : { raster: 'Pixel Layer', fill: 'Fill Layer', text: 'Type Layer', shape: 'Shape Layer', group: 'Group' }[l.content.type]}
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
            {(l.content.type === 'text' || l.content.type === 'shape') && (
              <div className="prop-row">
                <label>Transform</label>
                <div className="ctrl">
                  <span className="value dim">
                    {Math.round(l.content.params.cx)}, {Math.round(l.content.params.cy)} · {Math.round(Math.abs(l.content.params.sx) * 100)}% × {Math.round(Math.abs(l.content.params.sy) * 100)}% ·{' '}
                    {Math.round((l.content.params.rot * 1800) / Math.PI) / 10}°
                  </span>
                </div>
              </div>
            )}
            {l.content.type === 'text' && (
              <>
                <div className="prop-row" style={{ alignItems: 'start' }}>
                  <label>Text</label>
                  <div className="ctrl">
                    <TextContentField id={l.id} text={l.content.text.text} />
                  </div>
                </div>
                <div className="prop-editor text-style">
                  <TextStyleControls style={l.content.text} />
                </div>
              </>
            )}
            {l.content.type === 'shape' && <ShapeProps id={l.id} shape={l.content.shape} locked={l.locked} />}
            {l.content.type === 'fill' && (
              <div className="prop-row">
                <label>Color</label>
                <div className="ctrl">
                  <ColorField value={l.content.color} disabled={l.locked} onChange={(c) => A.setFillColor(l.id, c)} />
                </div>
              </div>
            )}
            {l.content.type === 'adjustment' && (
              <div className="prop-editor">
                <AdjustmentEditor a={l.content.adjustment} onChange={(a) => A.setAdjustmentParams(l.id, a)} hist={hist} sliderWidth={120} />
              </div>
            )}
          </div>
        )}
        {l && (
          <div className="prop-section">
            <div className="prop-head">
              Layer Mask
              {l.mask && doc.target === 'mask' && <span className="note" style={{ fontWeight: 400 }}>— editing</span>}
            </div>
            {l.mask ? (
              <>
                <div className="prop-row">
                  <label>Enabled</label>
                  <div className="ctrl">
                    <input type="checkbox" checked={l.mask.enabled} onChange={(e) => A.setMaskEnabled(l.id, e.target.checked)} />
                  </div>
                </div>
                <div className="prop-row">
                  <label>Edit</label>
                  <div className="ctrl">
                    <span className="seg">
                      <button className={doc.target !== 'mask' ? 'active' : ''} onClick={() => A.selectLayer(l.id, 'pixels')}>
                        Pixels
                      </button>
                      <button className={doc.target === 'mask' ? 'active' : ''} onClick={() => A.selectLayer(l.id, 'mask')}>
                        Mask
                      </button>
                    </span>
                  </div>
                </div>
                <div className="prop-row">
                  <label />
                  <div className="ctrl" style={{ flexWrap: 'wrap' }}>
                    <button className="btn small" onClick={() => (A.selectLayer(l.id, 'mask'), A.invertTarget())}>
                      Invert
                    </button>
                    <button className="btn small" onClick={() => A.maskToSelection(l.id)}>
                      Select
                    </button>
                    <button className="btn small" disabled={l.content.type !== 'raster'} onClick={() => A.applyLayerMask(l.id)}>
                      Apply
                    </button>
                    <button className="btn small" onClick={() => A.deleteLayerMask(l.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="prop-row">
                <label />
                <div className="ctrl">
                  <button className="btn small" disabled={l.locked} onClick={() => A.addLayerMask()}>
                    {doc.selection ? 'Add Mask from Selection' : 'Add Mask'}
                  </button>
                </div>
              </div>
            )}
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
              <span className="value">RGB · {docColor(doc).depth} bits/channel</span>
            </div>
          </div>
          <div className="prop-row">
            <label>Color profile</label>
            <div className="ctrl">
              <span className="value">{docColor(doc).space === 'srgb' ? 'sRGB IEC61966-2.1' : 'Display P3'}</span>
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
