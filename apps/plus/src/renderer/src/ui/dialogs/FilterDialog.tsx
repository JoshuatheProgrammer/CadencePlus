/**
 * Filter dialogs driven by a small spec: sliders, checkboxes and choices
 * produce a pixel op that previews live on the target layer.
 */
import { useEffect, useMemo, useState } from 'react'
import type { PixelOp } from '@core/adjustments'
import { highPassOp, motionBlurOp, noiseOp, unsharpOp, type FilterKind } from '@core/filters'
import { Modal, SliderField } from '@cadence/ui/components'
import * as A from '../../state/image-actions'
import { set } from '../../state/store'


type Field =
  | { id: string; kind: 'slider'; label: string; min: number; max: number; step?: number; unit?: string; default: number }
  | { id: string; kind: 'check'; label: string; default: boolean }
  | { id: string; kind: 'choice'; label: string; options: [string, string][]; default: string }

type Values = Record<string, number | boolean | string>

interface FilterSpec {
  title: string
  fields: Field[]
  op(v: Values): PixelOp
  note?: string
}

const n = (v: Values, k: string) => v[k] as number

export const FILTERS: Record<FilterKind, FilterSpec> = {
  unsharp: {
    title: 'Unsharp Mask',
    fields: [
      { id: 'amount', kind: 'slider', label: 'Amount', min: 1, max: 500, unit: '%', default: 100 },
      { id: 'radius', kind: 'slider', label: 'Radius', min: 0.1, max: 100, step: 0.1, unit: 'px', default: 1.5 },
      { id: 'threshold', kind: 'slider', label: 'Threshold', min: 0, max: 255, unit: 'levels', default: 0 }
    ],
    op: (v) => unsharpOp(n(v, 'amount'), n(v, 'radius'), n(v, 'threshold')),
    note: 'Adds back detail finer than the radius. Threshold leaves differences smaller than this many levels alone (protects skin and skies from grain).'
  },
  highPass: {
    title: 'High Pass',
    fields: [{ id: 'radius', kind: 'slider', label: 'Radius', min: 0.1, max: 250, step: 0.1, unit: 'px', default: 10 }],
    op: (v) => highPassOp(n(v, 'radius')),
    note: 'Keeps detail finer than the radius on 50% grey. Set the layer to Overlay or Soft Light to sharpen.'
  },
  noise: {
    title: 'Add Noise',
    fields: [
      { id: 'amount', kind: 'slider', label: 'Amount', min: 0.1, max: 100, step: 0.1, unit: '%', default: 10 },
      { id: 'dist', kind: 'choice', label: 'Distribution', options: [['uniform', 'Uniform'], ['gaussian', 'Gaussian']], default: 'uniform' },
      { id: 'mono', kind: 'check', label: 'Monochromatic', default: false }
    ],
    op: (v) => noiseOp(n(v, 'amount'), v.dist === 'gaussian', !!v.mono, n(v, 'seed')),
    note: 'The same settings always give the same grain.'
  },
  motionBlur: {
    title: 'Motion Blur',
    fields: [
      { id: 'angle', kind: 'slider', label: 'Angle', min: -90, max: 90, unit: '°', default: 0 },
      { id: 'distance', kind: 'slider', label: 'Distance', min: 1, max: 320, unit: 'px', default: 10 }
    ],
    op: (v) => motionBlurOp(n(v, 'angle'), n(v, 'distance')),
    note: 'At the canvas edge the image continues (edge pixels repeat).'
  }
}

export function FilterDialog({ kind }: { kind: FilterKind }) {
  const spec = FILTERS[kind]
  const [v, setV] = useState<Values>(() => ({ seed: 7, ...Object.fromEntries(spec.fields.map((f) => [f.id, f.default])) }))
  const [preview, setPreview] = useState(true)
  const target = useMemo(() => A.paintTarget(`apply ${spec.title}`)?.layer ?? null, [spec.title])
  const op = spec.op(v)
  useEffect(() => {
    if (!target) return void set({ dialog: null })
    set({ filterPreview: preview ? { layerId: target.id, op } : null })
    // op is derived from v
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, preview, target])
  const close = () => set({ dialog: null, filterPreview: null })
  const ok = () => {
    set({ dialog: null, filterPreview: null })
    A.applyFilter(op, spec.title)
  }
  if (!target) return null
  const put = (id: string, x: number | boolean | string) => setV((o) => ({ ...o, [id]: x }))
  return (
    <Modal
      preview
      title={spec.title}
      onClose={close}
      onSubmit={ok}
      width={440}
      actions={
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview
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
      <div className="adjust-grid">
        {spec.fields.map((f) =>
          f.kind === 'slider' ? (
            <SliderField key={f.id} label={f.label} value={v[f.id] as number} min={f.min} max={f.max} step={f.step} unit={f.unit} width={200} onChange={(x) => put(f.id, x)} />
          ) : f.kind === 'check' ? (
            <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!v[f.id]} onChange={(e) => put(f.id, e.target.checked)} /> {f.label}
            </label>
          ) : (
            <span key={f.id} className="slider-field">
              <span className="label">{f.label}</span>
              <select value={v[f.id] as string} onChange={(e) => put(f.id, e.target.value)}>
                {f.options.map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </span>
          )
        )}
        {spec.note && <span className="note">{spec.note}</span>}
      </div>
    </Modal>
  )
}
