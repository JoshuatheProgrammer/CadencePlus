import type { SelMode } from '@core/selection'
import { commitCrop } from '../state/commands'
import { actualPixels, fillScreen, fitOnScreen } from '../state/doc-actions'
import * as A from '../state/image-actions'
import { set, setToolOption, useEditor, type ToolOptions } from '../state/store'
import { toolDef } from '../state/tools'
import { SliderField } from './components'
import { IconCheck, IconClose } from './icons'

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

function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="opt-check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const MODES: { v: SelMode; label: string; title: string }[] = [
  { v: 'replace', label: 'New', title: 'New selection' },
  { v: 'add', label: 'Add', title: 'Add to selection (Shift)' },
  { v: 'subtract', label: 'Subtract', title: 'Subtract from selection (Alt)' },
  { v: 'intersect', label: 'Intersect', title: 'Intersect with selection (Shift+Alt)' }
]

function BrushOptions({ tool }: { tool: 'brush' | 'eraser' }) {
  const o = useEditor((s) => s.options[tool])
  const up = (p: Partial<ToolOptions['brush']>) => setToolOption(tool, p)
  return (
    <>
      <SliderField label="Size" value={o.size} min={1} max={1000} unit="px" width={110} onChange={(v) => up({ size: v })} title="[ and ] change size" />
      <SliderField label="Hardness" value={o.hardness} min={0} max={100} unit="%" width={70} onChange={(v) => up({ hardness: v })} title="Shift+[ and Shift+] change hardness" />
      <span className="sep-v" />
      <SliderField label="Opacity" value={o.opacity} min={1} max={100} unit="%" width={70} onChange={(v) => up({ opacity: v })} title="Number keys 1–0 set opacity" />
      <SliderField label="Flow" value={o.flow} min={1} max={100} unit="%" width={70} onChange={(v) => up({ flow: v })} />
      <SliderField label="Spacing" value={o.spacing} min={1} max={200} unit="%" width={60} onChange={(v) => up({ spacing: v })} />
      <span className="sep-v" />
      <Check label="Pressure → size" checked={o.pressureSize} onChange={(v) => up({ pressureSize: v })} title="Pen pressure controls brush size (pen tablets only)" />
      <Check label="Pressure → flow" checked={o.pressureFlow} onChange={(v) => up({ pressureFlow: v })} title="Pen pressure controls flow (pen tablets only)" />
    </>
  )
}

function ViewButtons() {
  return (
    <>
      <button className="btn small" onClick={actualPixels}>
        100%
      </button>
      <button className="btn small" onClick={fitOnScreen}>
        Fit Screen
      </button>
      <button className="btn small" onClick={fillScreen}>
        Fill Screen
      </button>
    </>
  )
}

export function OptionsBar() {
  const tool = useEditor((s) => s.tool)
  const o = useEditor((s) => s.options)
  const crop = useEditor((s) => s.crop)
  const hasSel = useEditor((s) => !!s.docs.find((d) => d.id === s.activeId)?.history.present.selection)
  const def = toolDef(tool)
  let body: React.ReactNode = null
  switch (tool) {
    case 'move':
      body = <Check label="Auto-select layer" checked={o.move.autoSelect} onChange={(v) => setToolOption('move', { autoSelect: v })} title="Click picks the topmost layer with pixels under the pointer" />
      break
    case 'marquee':
      body = (
        <>
          <Seg
            value={o.marquee.shape}
            options={[
              { v: 'rect', label: 'Rectangle' },
              { v: 'ellipse', label: 'Ellipse' }
            ]}
            onChange={(v) => setToolOption('marquee', { shape: v })}
          />
          <Seg value={o.marquee.mode} options={MODES} onChange={(v) => setToolOption('marquee', { mode: v })} />
        </>
      )
      break
    case 'lasso':
      body = <Seg value={o.lasso.mode} options={MODES} onChange={(v) => setToolOption('lasso', { mode: v })} />
      break
    case 'wand':
      body = (
        <>
          <Seg value={o.wand.mode} options={MODES} onChange={(v) => setToolOption('wand', { mode: v })} />
          <SliderField label="Tolerance" value={o.wand.tolerance} min={0} max={255} width={80} onChange={(v) => setToolOption('wand', { tolerance: v })} />
          <Check label="Contiguous" checked={o.wand.contiguous} onChange={(v) => setToolOption('wand', { contiguous: v })} />
          <Check label="Sample all layers" checked={o.wand.sampleAll} onChange={(v) => setToolOption('wand', { sampleAll: v })} />
        </>
      )
      break
    case 'crop':
      body = crop ? (
        <>
          <span className="label">
            {crop.w} × {crop.h} px
          </span>
          <button className="btn small" onClick={() => set({ crop: null })} title="Cancel (Esc)">
            <IconClose size={12} /> Cancel
          </button>
          <button className="btn small primary" onClick={commitCrop} title="Commit (Enter)">
            <IconCheck size={12} /> Crop
          </button>
        </>
      ) : (
        <button className="btn small" disabled={!hasSel} onClick={A.cropToSelection}>
          Crop to Selection
        </button>
      )
      break
    case 'eyedropper':
      body = (
        <>
          <span className="label">Sample size</span>
          <select value={o.eyedropper.size} onChange={(e) => setToolOption('eyedropper', { size: Number(e.target.value) })}>
            <option value={1}>Point sample</option>
            <option value={3}>3 × 3 average</option>
            <option value={5}>5 × 5 average</option>
            <option value={11}>11 × 11 average</option>
          </select>
          <span className="label">Sample</span>
          <select value={o.eyedropper.sampleAll ? 'all' : 'layer'} onChange={(e) => setToolOption('eyedropper', { sampleAll: e.target.value === 'all' })}>
            <option value="all">All layers</option>
            <option value="layer">Current layer</option>
          </select>
        </>
      )
      break
    case 'brush':
    case 'eraser':
      body = <BrushOptions tool={tool} />
      break
    case 'gradient':
      body = (
        <>
          <Seg
            value={o.gradient.kind}
            options={[
              { v: 'linear', label: 'Linear' },
              { v: 'radial', label: 'Radial' }
            ]}
            onChange={(v) => setToolOption('gradient', { kind: v })}
          />
          <SliderField label="Opacity" value={o.gradient.opacity} min={1} max={100} unit="%" width={70} onChange={(v) => setToolOption('gradient', { opacity: v })} />
          <Check label="Reverse" checked={o.gradient.reverse} onChange={(v) => setToolOption('gradient', { reverse: v })} />
          <Check label="Foreground to transparent" checked={o.gradient.toTransparent} onChange={(v) => setToolOption('gradient', { toTransparent: v })} />
        </>
      )
      break
    case 'bucket':
      body = (
        <>
          <SliderField label="Tolerance" value={o.bucket.tolerance} min={0} max={255} width={80} onChange={(v) => setToolOption('bucket', { tolerance: v })} />
          <SliderField label="Opacity" value={o.bucket.opacity} min={1} max={100} unit="%" width={70} onChange={(v) => setToolOption('bucket', { opacity: v })} />
          <Check label="Contiguous" checked={o.bucket.contiguous} onChange={(v) => setToolOption('bucket', { contiguous: v })} />
          <Check label="All layers" checked={o.bucket.sampleAll} onChange={(v) => setToolOption('bucket', { sampleAll: v })} />
        </>
      )
      break
    case 'hand':
      body = <ViewButtons />
      break
    case 'zoom':
      body = (
        <>
          <Seg
            value={o.zoom.out ? 'out' : 'in'}
            options={[
              { v: 'in', label: 'Zoom In' },
              { v: 'out', label: 'Zoom Out', title: 'Alt toggles' }
            ]}
            onChange={(v) => setToolOption('zoom', { out: v === 'out' })}
          />
          <ViewButtons />
        </>
      )
      break
  }
  return (
    <div className="optionsbar">
      <div className="tool-badge">
        <def.icon size={16} />
        {def.label}
      </div>
      {body}
      <span className="hint">{def.hint}</span>
    </div>
  )
}
