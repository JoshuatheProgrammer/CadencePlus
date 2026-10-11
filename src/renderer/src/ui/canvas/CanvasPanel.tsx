import { useEffect, useRef } from 'react'
import { formatZoom } from '@core/view'
import { closeDocument, displayName } from '../../state/doc-actions'
import { isDirty, set, useEditor } from '../../state/store'
import { IconClose } from '../icons'
import { token, tokenPx } from '@cadence/ui/tokens'
import { Viewport } from './Viewport'

/** Nice ruler step (document pixels) so labels are at least `minPx` apart. */
function rulerStep(zoom: number, minPx = 56): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000]
  return steps.find((s) => s * zoom >= minPx) ?? 50000
}

function Ruler({ orient }: { orient: 'h' | 'v' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.view ?? null)
  const vp = useEditor((s) => s.viewport)
  const cursor = useEditor((s) => s.cursor)
  useEffect(() => {
    const c = ref.current
    if (!c || !view) return
    const dpr = window.devicePixelRatio || 1
    const size = tokenPx('--ruler-size', 20)
    const len = orient === 'h' ? vp.w : vp.h
    const W = Math.round((orient === 'h' ? len : size) * dpr)
    const H = Math.round((orient === 'h' ? size : len) * dpr)
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const center = orient === 'h' ? view.cx : view.cy
    const half = len / 2
    const toS = (d: number) => (d - center) * view.zoom + half
    const step = rulerStep(view.zoom)
    const minor = step * view.zoom >= 80 ? step / 10 : step / 5
    const d0 = center - half / view.zoom
    const d1 = center + half / view.zoom
    g.strokeStyle = token('--ruler-tick')
    g.fillStyle = token('--ruler-text')
    g.font = '10px Segoe UI, system-ui, sans-serif'
    g.lineWidth = 1
    g.beginPath()
    for (let d = Math.floor(d0 / minor) * minor; d <= d1; d += minor) {
      const s = Math.round(toS(d)) + 0.5
      const major = Math.abs(d / step - Math.round(d / step)) < 1e-6
      const t = major ? size : size * 0.3
      if (orient === 'h') {
        g.moveTo(s, size)
        g.lineTo(s, size - t)
      } else {
        g.moveTo(size, s)
        g.lineTo(size - t, s)
      }
    }
    g.stroke()
    for (let d = Math.floor(d0 / step) * step; d <= d1; d += step) {
      const s = Math.round(toS(d))
      const label = String(Math.round(d))
      if (orient === 'h') g.fillText(label, s + 3, 10)
      else {
        g.save()
        g.translate(10, s + 3)
        g.rotate(-Math.PI / 2)
        g.textAlign = 'right'
        g.fillText(label, 0, 0)
        g.restore()
      }
    }
    if (cursor) {
      const s = Math.round(toS(orient === 'h' ? cursor.x : cursor.y)) + 0.5
      g.strokeStyle = token('--ruler-cursor')
      g.beginPath()
      if (orient === 'h') {
        g.moveTo(s, 0)
        g.lineTo(s, size)
      } else {
        g.moveTo(0, s)
        g.lineTo(size, s)
      }
      g.stroke()
    }
  }, [view, vp, cursor, orient])
  // The canvas is absolutely positioned so its size never feeds back into the grid layout.
  return (
    <div className={`ruler ${orient}`}>
      <canvas ref={ref} style={orient === 'h' ? { width: vp.w, height: '100%' } : { height: vp.h, width: '100%' }} />
    </div>
  )
}

function DocTabs() {
  const docs = useEditor((s) => s.docs)
  const activeId = useEditor((s) => s.activeId)
  return (
    <div className="doc-tabs" role="tablist">
      {docs.map((d) => (
        <div
          key={d.id}
          role="tab"
          aria-selected={d.id === activeId}
          className={`doc-tab${d.id === activeId ? ' active' : ''}`}
          title={d.path ?? d.sourcePath ?? displayName(d)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              void closeDocument(d.id)
            } else if (e.button === 0) set({ activeId: d.id, crop: null })
          }}
        >
          <span className="name">
            {displayName(d)}
            {isDirty(d) ? ' •' : ''}
          </span>
          <span className="meta">{d.view ? formatZoom(d.view.zoom) : ''}</span>
          <button
            className="close"
            title="Close (Ctrl+W)"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void closeDocument(d.id)}
          >
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function CanvasPanel() {
  const rulers = useEditor((s) => s.showRulers)
  return (
    <div className="canvas-panel">
      <DocTabs />
      <div className={`canvas-grid${rulers ? '' : ' no-rulers'}`}>
        <div className="ruler-corner" />
        <Ruler orient="h" />
        <Ruler orient="v" />
        <Viewport />
      </div>
    </div>
  )
}
