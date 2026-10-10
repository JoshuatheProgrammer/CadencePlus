/**
 * Editors for adjustment settings, shared by the Image → Adjustments dialogs
 * and the Properties panel (adjustment layers): sliders for filter-based
 * adjustments, a histogram + slider editor for Levels, and a point editor
 * for Curves.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ADJUSTMENTS, type Adjustment } from '@core/adjustments'
import { CHANNELS, curveTable, IDENTITY_CURVE, type Channel } from '@core/lut'
import { SliderField } from './components'
import { token } from './tokens'

export type Histograms = Record<Channel, Uint32Array> | null

const CH_LABEL: Record<Channel, string> = { rgb: 'RGB', r: 'Red', g: 'Green', b: 'Blue' }
const CH_COLOR: Record<Channel, string> = { rgb: '#e8ecf2', r: '#f26d6d', g: '#5cc48d', b: '#69b7ff' }

function drawHistogram(g: CanvasRenderingContext2D, h: Uint32Array | undefined, W: number, H: number, color: string): void {
  if (!h) return
  let max = 0
  // Ignore the single tallest bin so one flat colour doesn't flatten the rest.
  const sorted = [...h].sort((a, b) => b - a)
  max = sorted[1] || sorted[0] || 1
  g.fillStyle = color
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, h[i] / max)
    const x0 = Math.floor((i / 256) * W)
    const x1 = Math.ceil(((i + 1) / 256) * W)
    g.fillRect(x0, H - v * H, Math.max(1, x1 - x0), v * H)
  }
}

function useCanvas(draw: (g: CanvasRenderingContext2D, W: number, H: number, dpr: number) => void, deps: unknown[], w: number, h: number) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    draw(g, w, h, dpr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

function Triangle({ x, fill, onDrag, title }: { x: number; fill: string; onDrag: (dx: number, e: PointerEvent) => void; title: string }) {
  return (
    <div
      className="lv-tri"
      style={{ left: x, borderBottomColor: fill }}
      title={title}
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const start = e.clientX
        const move = (ev: PointerEvent) => onDrag(ev.clientX - start, ev)
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      }}
    />
  )
}

function LevelsEditor({ a, onChange, hist }: { a: Adjustment; onChange: (a: Adjustment) => void; hist: Histograms }) {
  const W = 256
  const p = (id: string, d: number) => a.params[id] ?? d
  const inB = p('inBlack', 0)
  const inW = p('inWhite', 255)
  const gamma = p('gamma', 1)
  const outB = p('outBlack', 0)
  const outW = p('outWhite', 255)
  const set = (patch: Record<string, number>) => onChange({ ...a, params: { ...a.params, ...patch } })
  const midX = inB + (inW - inB) * Math.pow(0.5, gamma)
  const ref = useCanvas((g, w, h) => drawHistogram(g, hist?.rgb, w, h, token('--c-text-2')), [hist], W, 100)
  const startRef = useRef({ inB, inW, gamma, outB, outW, midX })
  const begin = () => (startRef.current = { inB, inW, gamma, outB, outW, midX })
  return (
    <div className="levels">
      <canvas ref={ref} className="hist" style={{ width: W, height: 100 }} />
      <div className="lv-track" onPointerDown={begin}>
        <div className="lv-grad" />
        <Triangle x={inB} fill="#000" title="Input black" onDrag={(dx) => set({ inBlack: Math.round(Math.min(inW - 2, Math.max(0, startRef.current.inB + dx))) })} />
        <Triangle
          x={midX}
          fill="#808080"
          title="Midtones (gamma)"
          onDrag={(dx) => {
            const x = Math.min(inW - 1, Math.max(inB + 1, startRef.current.midX + dx))
            const t = (x - inB) / (inW - inB)
            set({ gamma: Math.round(Math.min(9.99, Math.max(0.1, Math.log(t) / Math.log(0.5))) * 100) / 100 })
          }}
        />
        <Triangle x={inW} fill="#fff" title="Input white" onDrag={(dx) => set({ inWhite: Math.round(Math.max(inB + 2, Math.min(255, startRef.current.inW + dx))) })} />
      </div>
      <div className="lv-fields">
        <SliderField label="Black" value={inB} min={0} max={253} width={0} onChange={(v) => set({ inBlack: Math.min(v, inW - 2) })} />
        <SliderField label="Gamma" value={gamma} min={0.1} max={9.99} step={0.01} width={0} onChange={(v) => set({ gamma: v })} />
        <SliderField label="White" value={inW} min={2} max={255} width={0} onChange={(v) => set({ inWhite: Math.max(v, inB + 2) })} />
      </div>
      <div className="form-section" style={{ margin: '8px 0 6px' }}>Output levels</div>
      <div className="lv-track out" onPointerDown={begin}>
        <div className="lv-grad" />
        <Triangle x={outB} fill="#000" title="Output black" onDrag={(dx) => set({ outBlack: Math.round(Math.min(255, Math.max(0, startRef.current.outB + dx))) })} />
        <Triangle x={outW} fill="#fff" title="Output white" onDrag={(dx) => set({ outWhite: Math.round(Math.min(255, Math.max(0, startRef.current.outW + dx))) })} />
      </div>
      <div className="lv-fields">
        <SliderField label="Black" value={outB} min={0} max={255} width={0} onChange={(v) => set({ outBlack: v })} />
        <SliderField label="White" value={outW} min={0} max={255} width={0} onChange={(v) => set({ outWhite: v })} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

const GRAPH = 256

function CurvesEditor({ a, onChange, hist }: { a: Adjustment; onChange: (a: Adjustment) => void; hist: Histograms }) {
  const [ch, setCh] = useState<Channel>('rgb')
  const [sel, setSel] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const pts = a.curves?.[ch] ?? IDENTITY_CURVE
  const table = useMemo(() => curveTable(pts), [pts])
  const setPts = (next: number[]) => onChange({ ...a, curves: { ...(a.curves ?? {}), [ch]: next } })
  const ref = useCanvas(
    (g, W, H) => {
      g.fillStyle = token('--c-inset')
      g.fillRect(0, 0, W, H)
      drawHistogram(g, hist?.[ch], W, H, 'rgba(146,155,170,0.28)')
      g.strokeStyle = token('--c-border')
      g.lineWidth = 1
      g.beginPath()
      for (let i = 1; i < 4; i++) {
        const v = Math.round((i * W) / 4) + 0.5
        g.moveTo(v, 0)
        g.lineTo(v, H)
        g.moveTo(0, v)
        g.lineTo(W, v)
      }
      g.stroke()
      g.strokeStyle = token('--c-border-strong')
      g.beginPath()
      g.moveTo(0, H)
      g.lineTo(W, 0)
      g.stroke()
      // Other channels' curves, faint
      for (const c of CHANNELS) {
        if (c === ch || !a.curves?.[c]) continue
        const t = curveTable(a.curves[c]!)
        g.strokeStyle = CH_COLOR[c] + '55'
        g.beginPath()
        for (let x = 0; x < 256; x++) (x ? g.lineTo : g.moveTo).call(g, x + 0.5, H - t[x] - 0.5)
        g.stroke()
      }
      g.strokeStyle = CH_COLOR[ch]
      g.lineWidth = 1.5
      g.beginPath()
      for (let x = 0; x < 256; x++) (x ? g.lineTo : g.moveTo).call(g, x + 0.5, H - table[x] - 0.5)
      g.stroke()
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i]
        const y = H - pts[i + 1]
        g.fillStyle = sel === i / 2 ? CH_COLOR[ch] : token('--c-panel')
        g.strokeStyle = CH_COLOR[ch]
        g.lineWidth = 1.25
        g.beginPath()
        g.rect(x - 3.5, y - 3.5, 7, 7)
        g.fill()
        g.stroke()
      }
    },
    [pts, ch, hist, sel, table, a.curves],
    GRAPH,
    GRAPH
  )
  const toVal = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: Math.round(((e.clientX - r.left) / r.width) * 255), y: Math.round(255 - ((e.clientY - r.top) / r.height) * 255) }
  }
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const v = toVal(e)
    let idx = -1
    for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i] - v.x) <= 6 && Math.abs(pts[i + 1] - v.y) <= 6) idx = i / 2
    let cur = [...pts]
    if (idx < 0) {
      // Add a point on the curve at this x.
      cur.push(Math.min(255, Math.max(0, v.x)), table[Math.min(255, Math.max(0, v.x))])
      const pairs: [number, number][] = []
      for (let i = 0; i < cur.length; i += 2) pairs.push([cur[i], cur[i + 1]])
      pairs.sort((p, q) => p[0] - q[0])
      cur = pairs.flat()
      idx = pairs.findIndex((p) => p[0] === Math.min(255, Math.max(0, v.x)))
      setPts(cur)
    }
    setSel(idx)
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const n = cur.length / 2
    const lo = idx > 0 ? cur[(idx - 1) * 2] + 1 : 0
    const hi = idx < n - 1 ? cur[(idx + 1) * 2] - 1 : 255
    const move = (ev: PointerEvent) => {
      const q = toVal(ev)
      const next = [...cur]
      // Dragging an inner point far outside the graph removes it.
      const out = q.y < -24 || q.y > 279 || q.x < -24 || q.x > 279
      if (out && idx > 0 && idx < n - 1) {
        next.splice(idx * 2, 2)
        setPts(next)
        return
      }
      next[idx * 2] = Math.min(hi, Math.max(lo, q.x))
      next[idx * 2 + 1] = Math.min(255, Math.max(0, q.y))
      setPts(next)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const selected = sel !== null && sel * 2 < pts.length ? { x: pts[sel * 2], y: pts[sel * 2 + 1] } : null
  return (
    <div className="curves">
      <div className="curves-bar">
        <select value={ch} onChange={(e) => (setCh(e.target.value as Channel), setSel(null))}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CH_LABEL[c]}
            </option>
          ))}
        </select>
        <button className="btn small" onClick={() => (setPts([...IDENTITY_CURVE]), setSel(null))}>
          Reset {CH_LABEL[ch]}
        </button>
      </div>
      <canvas
        ref={ref}
        className="curve-graph"
        style={{ width: GRAPH, height: GRAPH }}
        onPointerDown={onDown}
        onPointerMove={(e) => setHover(toVal(e))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null && sel > 0 && sel < pts.length / 2 - 1) {
            const next = [...pts]
            next.splice(sel * 2, 2)
            setPts(next)
            setSel(null)
            e.stopPropagation()
          }
        }}
        tabIndex={0}
        aria-label={`${CH_LABEL[ch]} curve`}
      />
      <div className="note curve-read">
        {selected ? `Input ${selected.x} → Output ${selected.y}` : hover ? `Input ${Math.min(255, Math.max(0, hover.x))} → Output ${table[Math.min(255, Math.max(0, hover.x))]}` : 'Click to add a point · drag off the graph (or Delete) to remove'}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Settings editor for any adjustment. */
export function AdjustmentEditor({ a, onChange, hist, sliderWidth = 200 }: { a: Adjustment; onChange: (a: Adjustment) => void; hist: Histograms; sliderWidth?: number }) {
  if (a.kind === 'levels') return <LevelsEditor a={a} onChange={onChange} hist={hist} />
  if (a.kind === 'curves') return <CurvesEditor a={a} onChange={onChange} hist={hist} />
  const def = ADJUSTMENTS[a.kind]
  if (!def.params.length) return <div className="note">This adjustment has no settings.</div>
  return (
    <div className="adjust-grid">
      {def.params.map((p) => (
        <SliderField
          key={p.id}
          label={p.label}
          value={a.params[p.id] ?? p.default}
          min={p.min}
          max={p.max}
          step={p.step}
          unit={p.unit}
          width={sliderWidth}
          onChange={(v) => onChange({ ...a, params: { ...a.params, [p.id]: v } })}
        />
      ))}
    </div>
  )
}
