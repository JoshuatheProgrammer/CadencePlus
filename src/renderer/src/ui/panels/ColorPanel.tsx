import { useEffect, useRef, useState } from 'react'
import { hexToRgb, hsvToRgb, parseHex, rgbToHex, rgbToHsv, type HSV } from '@core/color'
import { get, set, useEditor } from '../../state/store'
import { NumberInput } from '../components'

/** HSV picker. Keeps its own hue so dragging through grey doesn't lose it. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value)))
  useEffect(() => {
    if (rgbToHex(hsvToRgb(hsv)) !== value.toLowerCase()) {
      const n = rgbToHsv(hexToRgb(value))
      // Keep hue/saturation for greys
      setHsv((h) => ({ h: n.s === 0 ? h.h : n.h, s: n.v === 0 ? h.s : n.s, v: n.v }))
    }
  }, [value])
  const update = (n: HSV) => {
    setHsv(n)
    onChange(rgbToHex(hsvToRgb(n)))
  }
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const drag = (el: HTMLElement | null, e: React.PointerEvent, fn: (fx: number, fy: number) => void) => {
    if (!el || e.button !== 0) return
    el.setPointerCapture(e.pointerId)
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
    }
    at(e)
    const move = (ev: PointerEvent) => at(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const rgb = hsvToRgb(hsv)
  const hueColor = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }))
  const [hexText, setHexText] = useState(value)
  useEffect(() => setHexText(value), [value])
  return (
    <>
      <div
        ref={svRef}
        className="sv-box"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
        onPointerDown={(e) => drag(svRef.current, e, (fx, fy) => update({ ...hsv, s: fx, v: 1 - fy }))}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
      >
        <div className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <div
        ref={hueRef}
        className="hue-strip"
        onPointerDown={(e) => drag(hueRef.current, e, (fx) => update({ ...hsv, h: fx * 360 }))}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
      >
        <div className="knob" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="color-fields">
        {(['r', 'g', 'b'] as const).map((k) => (
          <span className="f" key={k}>
            <span>{k.toUpperCase()}</span>
            <NumberInput value={rgb[k]} min={0} max={255} width="100%" onChange={(v) => update(rgbToHsv({ ...rgb, [k]: v }))} />
          </span>
        ))}
        <span className="f">
          <span>#</span>
          <input
            type="text"
            value={hexText.replace(/^#/, '')}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={() => {
              const p = parseHex(hexText)
              if (p) update(rgbToHsv(p))
              else setHexText(value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </span>
      </div>
    </>
  )
}

/** A swatch + hex that opens a picker popover. */
export function ColorField({ value, onChange, disabled }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)
  const pop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (pop.current && !pop.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <>
      <button
        className="swatch-preview"
        style={{ background: value, padding: 0 }}
        disabled={disabled}
        title="Choose colour"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setOpen(open ? null : { x: Math.min(r.left, window.innerWidth - 250), y: Math.min(r.bottom + 4, window.innerHeight - 260) })
        }}
      />
      <span className="value" style={{ fontFamily: 'var(--mono)' }}>
        {value}
      </span>
      {open && (
        <div ref={pop} className="menu-pop color-pop" style={{ left: open.x, top: open.y, width: 240 }}>
          <div className="color-panel">
            <ColorPicker value={value} onChange={onChange} />
          </div>
        </div>
      )}
    </>
  )
}

export function ColorPanel() {
  const fg = useEditor((s) => s.fg)
  const bg = useEditor((s) => s.bg)
  const target = useEditor((s) => s.colorTarget)
  const value = target === 'fg' ? fg : bg
  return (
    <div className="panel">
      <div className="panel-body color-panel">
        <div className="color-target">
          <div className="color-chips" style={{ marginTop: 0 }}>
            <button className={`color-chip bg${target === 'bg' ? ' editing' : ''}`} style={{ background: bg }} title="Background colour" onClick={() => set({ colorTarget: 'bg' })} />
            <button className={`color-chip fg${target === 'fg' ? ' editing' : ''}`} style={{ background: fg }} title="Foreground colour" onClick={() => set({ colorTarget: 'fg' })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>{target === 'fg' ? 'Foreground' : 'Background'}</span>
            <span className="note">Click a chip to edit it</span>
          </div>
        </div>
        <ColorPicker value={value} onChange={(c) => set(get().colorTarget === 'fg' ? { fg: c } : { bg: c })} />
      </div>
    </div>
  )
}

export function SwatchesPanel() {
  const swatches = useEditor((s) => s.swatches)
  const fg = useEditor((s) => s.fg)
  const save = (list: string[]) => {
    set({ swatches: list })
    void window.cadencePlus.setSetting('swatches', list)
  }
  return (
    <div className="panel">
      <div className="panel-body">
        <div className="swatch-grid">
          {swatches.map((c, i) => (
            <button
              key={`${c}${i}`}
              className={`swatch${c === fg ? ' current' : ''}`}
              style={{ background: c }}
              title={`${c}\nClick: foreground · Alt+click: background · Right-click: remove`}
              onClick={(e) => set(e.altKey || e.ctrlKey ? { bg: c } : { fg: c })}
              onContextMenu={(e) => {
                e.preventDefault()
                save(swatches.filter((_, j) => j !== i))
              }}
            />
          ))}
        </div>
      </div>
      <div className="panel-footer">
        <button className="btn small" onClick={() => !swatches.includes(fg) && save([...swatches, fg])} disabled={swatches.includes(fg)} title="Add the foreground colour">
          Add Foreground
        </button>
      </div>
    </div>
  )
}
