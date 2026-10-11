/**
 * Controls for type and shape layers, used by the options bar (Type/Shape
 * tools) and the Properties panel.
 */
import { useEffect, useState } from 'react'
import type { ShapeData, TextStyle } from '@core/vector'
import { availableFonts } from '../engine/vector'
import { commitText, editText, setTextStyle, updateShape, updateText } from '../state/vector-actions'
import { setToolOption, useEditor } from '../state/store'
import { NumberInput } from '@cadence/ui/components'
import { ColorField } from './panels/ColorPanel'

const WEIGHTS: [number, string][] = [
  [100, 'Thin'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semibold'],
  [700, 'Bold'],
  [900, 'Black']
]

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'active' : ''} role="radio" aria-checked={value === o.v} title={o.title} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </span>
  )
}

/** Font, size, weight, style, alignment, colour, leading and tracking. */
export function TextStyleControls({ style, compact }: { style: TextStyle; compact?: boolean }) {
  const fonts = availableFonts()
  const list = fonts.includes(style.font) ? fonts : [style.font, ...fonts]
  return (
    <>
      <select value={style.font} onChange={(e) => setTextStyle({ font: e.target.value })} title="Font" style={{ maxWidth: compact ? 140 : 170 }}>
        {list.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
      </select>
      <select value={style.weight} onChange={(e) => setTextStyle({ weight: Number(e.target.value) })} title="Weight">
        {WEIGHTS.map(([w, n]) => (
          <option key={w} value={w}>
            {n}
          </option>
        ))}
      </select>
      <span className="seg">
        <button className={style.italic ? 'active' : ''} title="Italic" onClick={() => setTextStyle({ italic: !style.italic })} style={{ fontStyle: 'italic', fontFamily: 'serif' }}>
          I
        </button>
      </span>
      <span className="label">Size</span>
      <NumberInput value={style.size} min={1} max={2000} decimals={1} width={52} onChange={(v) => setTextStyle({ size: v })} />
      <span className="unit">px</span>
      <Seg
        value={style.align}
        options={[
          { v: 'left', label: 'Left' },
          { v: 'center', label: 'Center' },
          { v: 'right', label: 'Right' }
        ]}
        onChange={(v) => setTextStyle({ align: v })}
      />
      <ColorField value={style.color} onChange={(c) => setTextStyle({ color: c })} />
      <span className="label" title="Line height as a multiple of the size">
        Leading
      </span>
      <NumberInput value={style.leading} min={0.5} max={5} decimals={2} width={48} onChange={(v) => setTextStyle({ leading: v })} />
      <span className="label" title="Extra space between letters">
        Tracking
      </span>
      <NumberInput value={style.tracking} min={-50} max={500} decimals={1} width={48} onChange={(v) => setTextStyle({ tracking: v })} />
    </>
  )
}

/** Text content editor for the Properties panel. */
export function TextContentField({ id, text }: { id: string; text: string }) {
  const [v, setV] = useState(text)
  useEffect(() => setV(text), [text])
  const editing = useEditor((s) => s.textEdit?.layerId === id)
  return (
    <textarea
      className="prop-text"
      value={v}
      disabled={editing}
      rows={3}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v === text) return
        // Edits from the panel go through a one-off editing session (one undo step).
        editText(id)
        updateText(v)
        commitText()
      }}
    />
  )
}

export function ShapeOptions() {
  const o = useEditor((s) => s.options.shape)
  const up = (p: Partial<typeof o>) => setToolOption('shape', p)
  return (
    <>
      <Seg
        value={o.kind}
        options={[
          { v: 'rect', label: 'Rectangle' },
          { v: 'ellipse', label: 'Ellipse' },
          { v: 'polygon', label: 'Polygon' },
          { v: 'line', label: 'Line' }
        ]}
        onChange={(v) => up({ kind: v })}
      />
      {o.kind !== 'line' && (
        <>
          <label className="opt-check" title="Fill with the foreground colour">
            <input type="checkbox" checked={o.fill} onChange={(e) => up({ fill: e.target.checked })} /> Fill
          </label>
          <label className="opt-check" title="Stroke with the background colour">
            <input type="checkbox" checked={o.stroke} onChange={(e) => up({ stroke: e.target.checked })} /> Stroke
          </label>
        </>
      )}
      <span className="label">{o.kind === 'line' ? 'Weight' : 'Stroke'}</span>
      <NumberInput value={o.strokeWidth} min={0.5} max={500} decimals={1} width={48} onChange={(v) => up({ strokeWidth: v })} />
      <span className="unit">px</span>
      {o.kind === 'rect' && (
        <>
          <span className="label">Radius</span>
          <NumberInput value={o.radius} min={0} max={5000} width={48} onChange={(v) => up({ radius: v })} />
        </>
      )}
      {o.kind === 'polygon' && (
        <>
          <span className="label">Sides</span>
          <NumberInput value={o.sides} min={3} max={64} width={40} onChange={(v) => up({ sides: Math.round(v) })} />
        </>
      )}
    </>
  )
}

/** Shape layer settings for the Properties panel. */
export function ShapeProps({ id, shape, locked }: { id: string; shape: ShapeData; locked: boolean }) {
  const up = (p: Partial<ShapeData>) => updateShape(id, p)
  return (
    <>
      <div className="prop-row">
        <label>Size</label>
        <div className="ctrl">
          <span className="unit">W</span>
          <NumberInput value={shape.w} min={1} max={30000} decimals={1} width={64} onChange={(v) => up({ w: v })} />
          <span className="unit">H</span>
          <NumberInput value={shape.h} min={1} max={30000} decimals={1} width={64} onChange={(v) => up({ h: v })} />
        </div>
      </div>
      {shape.kind !== 'line' && (
        <div className="prop-row">
          <label>Fill</label>
          <div className="ctrl">
            <input type="checkbox" checked={!!shape.fill} disabled={locked} onChange={(e) => up({ fill: e.target.checked ? '#000000' : null })} />
            {shape.fill && <ColorField value={shape.fill} disabled={locked} onChange={(c) => up({ fill: c })} />}
          </div>
        </div>
      )}
      <div className="prop-row">
        <label>Stroke</label>
        <div className="ctrl">
          {shape.kind !== 'line' && <input type="checkbox" checked={!!shape.stroke} disabled={locked} onChange={(e) => up({ stroke: e.target.checked ? '#000000' : null })} />}
          {shape.stroke && <ColorField value={shape.stroke} disabled={locked} onChange={(c) => up({ stroke: c })} />}
          {shape.stroke && <NumberInput value={shape.strokeWidth} min={0.5} max={500} decimals={1} width={48} onChange={(v) => up({ strokeWidth: v })} />}
        </div>
      </div>
      {shape.kind === 'rect' && (
        <div className="prop-row">
          <label>Corner radius</label>
          <div className="ctrl">
            <NumberInput value={shape.radius} min={0} max={5000} width={64} onChange={(v) => up({ radius: v })} />
          </div>
        </div>
      )}
      {shape.kind === 'polygon' && (
        <div className="prop-row">
          <label>Sides</label>
          <div className="ctrl">
            <NumberInput value={shape.sides} min={3} max={64} width={64} onChange={(v) => up({ sides: Math.round(v) })} />
          </div>
        </div>
      )}
    </>
  )
}
