/**
 * Layer → Layer Style: switch effects on and off on the left, edit the
 * selected one on the right. Changes preview live; OK makes one undo step.
 */
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_EFFECTS, EFFECT_KINDS, EFFECT_LABELS, type EffectKind, type LayerEffects } from '@core/effects'
import type { BlendMode } from '@core/model'
import { Modal, SliderField } from '@cadence/ui/components'
import * as A from '../../state/image-actions'
import { activeDoc, set } from '../../state/store'

const BLENDS: [BlendMode, string][] = [
  ['normal', 'Normal'],
  ['multiply', 'Multiply'],
  ['screen', 'Screen'],
  ['overlay', 'Overlay'],
  ['soft-light', 'Soft Light'],
  ['color-dodge', 'Color Dodge'],
  ['color-burn', 'Color Burn'],
  ['darken', 'Darken'],
  ['lighten', 'Lighten']
]

export function LayerStyleDialog({ focus }: { focus: EffectKind }) {
  const doc = activeDoc()!
  const layer = useMemo(() => doc.layers.find((l) => l.id === doc.activeLayerId)!, [doc])
  const [fx, setFx] = useState<LayerEffects>(() => {
    const cur = structuredClone(layer.effects ?? {})
    // Opening on an effect switches it on (with defaults the first time).
    cur[focus] = { ...(DEFAULT_EFFECTS[focus] as object), ...(cur[focus] as object), enabled: true } as never
    return cur
  })
  const [sel, setSel] = useState<EffectKind>(focus)
  const [preview, setPreview] = useState(true)
  useEffect(() => {
    set({ effectsPreview: preview ? { layerId: layer.id, effects: fx } : null })
  }, [fx, preview, layer.id])
  const close = () => set({ dialog: null, effectsPreview: null })
  const ok = () => {
    close()
    A.setLayerEffects(layer.id, fx)
  }
  const toggle = (k: EffectKind, on: boolean) => setFx((f) => ({ ...f, [k]: { ...(DEFAULT_EFFECTS[k] as object), ...(f[k] as object), enabled: on } }))
  const up = <K extends EffectKind>(k: K, patch: Partial<NonNullable<LayerEffects[K]>>) => setFx((f) => ({ ...f, [k]: { ...(DEFAULT_EFFECTS[k] as object), ...(f[k] as object), ...patch } }))
  const e = { ...(DEFAULT_EFFECTS[sel] as object), ...(fx[sel] as object) } as Record<string, number | string | boolean>
  const pct = (v: unknown) => Math.round((v as number) * 100)
  return (
    <Modal
      title={`Layer Style — ${layer.name}`}
      onClose={close}
      onSubmit={ok}
      width={620}
      actions={
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
            <input type="checkbox" checked={preview} onChange={(ev) => setPreview(ev.target.checked)} /> Preview
          </label>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={ok}>
            OK
          </button>
        </>
      }
    >
      <div className="layer-style">
        <div className="fx-list" role="listbox" aria-label="Effects">
          {EFFECT_KINDS.map((k) => (
            <div key={k} className={`fx-item${sel === k ? ' selected' : ''}`} role="option" aria-selected={sel === k} onClick={() => setSel(k)}>
              <input type="checkbox" checked={!!fx[k]?.enabled} aria-label={`${EFFECT_LABELS[k]} on`} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => toggle(k, ev.target.checked)} />
              {EFFECT_LABELS[k]}
            </div>
          ))}
        </div>
        <div className="fx-settings">
          <div className="fx-title">{EFFECT_LABELS[sel]}</div>
          <div className="adjust-grid">
            <span className="slider-field">
              <span className="label">Colour</span>
              <input type="color" value={e.color as string} aria-label="Colour" onChange={(ev) => up(sel, { color: ev.target.value } as never)} />
            </span>
            {'blend' in e && (
              <span className="slider-field">
                <span className="label">Blend</span>
                <select value={e.blend as string} onChange={(ev) => up(sel, { blend: ev.target.value as BlendMode } as never)}>
                  {BLENDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <SliderField label="Opacity" value={pct(e.opacity)} min={0} max={100} unit="%" width={200} onChange={(v) => up(sel, { opacity: v / 100 } as never)} />
            {sel === 'dropShadow' && (
              <>
                <SliderField label="Angle" value={e.angle as number} min={-180} max={180} unit="°" width={200} onChange={(v) => up('dropShadow', { angle: v })} />
                <SliderField label="Distance" value={e.distance as number} min={0} max={250} unit="px" width={200} onChange={(v) => up('dropShadow', { distance: v })} />
              </>
            )}
            {sel === 'stroke' && (
              <span className="slider-field">
                <span className="label">Position</span>
                <select value={e.position as string} onChange={(ev) => up('stroke', { position: ev.target.value as 'outside' | 'inside' | 'center' })}>
                  <option value="outside">Outside</option>
                  <option value="inside">Inside</option>
                  <option value="center">Center</option>
                </select>
              </span>
            )}
            {'size' in e && <SliderField label="Size" value={e.size as number} min={sel === 'stroke' ? 1 : 0} max={sel === 'stroke' ? 100 : 250} unit="px" width={200} onChange={(v) => up(sel, { size: v } as never)} />}
          </div>
          {sel === 'stroke' && <span className="note">Stroke widths are exact along straight edges; sharp corners come out slightly rounded.</span>}
        </div>
      </div>
    </Modal>
  )
}
