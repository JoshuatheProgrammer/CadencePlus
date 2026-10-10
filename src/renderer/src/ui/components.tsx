import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

export type CtxItem = { label: string; action: () => void; disabled?: boolean; kbd?: string; danger?: boolean; checked?: boolean } | { sep: true }

const useCtx = create<{ menu: { x: number; y: number; items: CtxItem[] } | null }>(() => ({ menu: null }))

export function showContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: CtxItem[]): void {
  e.preventDefault?.()
  useCtx.setState({ menu: { x: e.clientX, y: e.clientY, items } })
}

export function ContextMenuHost() {
  const menu = useCtx((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      useCtx.setState({ menu: null })
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useCtx.setState({ menu: null })
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', key, true)
    }
  }, [menu])
  useEffect(() => {
    if (!menu || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 6), y: Math.min(menu.y, window.innerHeight - r.height - 6) })
  }, [menu])
  if (!menu) return null
  return (
    <div ref={ref} className="menu-pop" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}>
      {menu.items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item${it.disabled ? ' disabled' : ''}`}
            style={it.danger && !it.disabled ? { color: 'var(--c-danger)' } : undefined}
            onClick={() => {
              if (it.disabled) return
              useCtx.setState({ menu: null })
              it.action()
            }}
          >
            <span className="check">{it.checked ? '✓' : ''}</span>
            <span className="label">{it.label}</span>
            <span className="kbd">{it.kbd ?? ''}</span>
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scrubbable number (drag horizontally, click to type)
// ---------------------------------------------------------------------------

export function ScrubNumber({
  value,
  onChange,
  onCommit,
  step = 1,
  min = -Infinity,
  max = Infinity,
  decimals = 0,
  unit,
  disabled,
  title
}: {
  value: number
  onChange: (v: number) => void
  onCommit?: () => void
  step?: number
  min?: number
  max?: number
  decimals?: number
  unit?: string
  disabled?: boolean
  title?: string
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  if (editing) {
    return (
      <input
        className="scrub-input"
        autoFocus
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text)
          if (text.trim() !== '' && Number.isFinite(v)) onChange(clamp(v))
          setEditing(false)
          onCommit?.()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEditing(false)
          e.stopPropagation()
        }}
      />
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }} title={title}>
      <span
        className={`scrub${disabled ? ' disabled' : ''}`}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter') {
            setText(value.toFixed(decimals))
            setEditing(true)
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault()
            e.stopPropagation()
            onChange(clamp(value + step * (e.shiftKey ? 10 : 1)))
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault()
            e.stopPropagation()
            onChange(clamp(value - step * (e.shiftKey ? 10 : 1)))
          }
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, v: value, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (Math.abs(dx) > 2) d.moved = true
          if (d.moved) {
            const mult = e.shiftKey ? 10 : e.ctrlKey ? 0.1 : 1
            onChange(clamp(Number((d.v + dx * step * mult).toFixed(Math.max(decimals, 3)))))
          }
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved) {
            setText(value.toFixed(decimals))
            setEditing(true)
          } else if (d) onCommit?.()
        }}
      >
        {value.toFixed(decimals)}
      </span>
      {unit && <span className="unit">{unit}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Slider with a scrubbable value (options bar, adjustments)
// ---------------------------------------------------------------------------

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  width = 90,
  title
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
  width?: number
  title?: string
}) {
  return (
    <span className="slider-field" title={title}>
      <span className="label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width }} onChange={(e) => onChange(Number(e.target.value))} />
      <ScrubNumber value={value} min={min} max={max} step={step} onChange={onChange} unit={unit} decimals={step < 1 ? 1 : 0} />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Number input that commits on blur/Enter
// ---------------------------------------------------------------------------

export function NumberInput({ value, onChange, min, max, width = 80, decimals = 0, autoFocus }: { value: number; onChange: (v: number) => void; min?: number; max?: number; width?: number | string; decimals?: number; autoFocus?: boolean }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(decimals ? String(Number(value.toFixed(decimals))) : String(Math.round(value))), [value, decimals])
  const commit = () => {
    const v = Number(text)
    if (text.trim() === '' || !Number.isFinite(v)) return setText(String(value))
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
    onChange(c)
    setText(String(c))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      autoFocus={autoFocus}
      style={{ width, fontFamily: 'var(--mono)' }}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({ title, children, actions, onClose, onSubmit, width }: { title: string; children: ReactNode; actions: ReactNode; onClose?: () => void; onSubmit?: () => void; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Enter' && onSubmit && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        // Let a focused input commit first.
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        setTimeout(onSubmit, 0)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onSubmit])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={width ? { width } : undefined} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <div className="body">{children}</div>
        <div className="actions">{actions}</div>
      </div>
    </div>
  )
}
