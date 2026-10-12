import { useEffect, useRef, useState } from 'react'
import { clampZoom, formatZoom, MAX_ZOOM, MIN_ZOOM } from '@core/view'
import { renderDocument } from '../../engine/render'
import { poolCanvas } from '../../engine/tiles'
import { setView, zoomIn, zoomOut } from '../../state/doc-actions'
import { activeDocState, useEditor } from '../../state/store'
import { IconZoom, IconZoomOut } from '../icons'
import { checkerTile, token } from '@cadence/ui/tokens'

const toSlider = (z: number) => Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)
const fromSlider = (t: number) => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, t)

export function NavigatorPanel() {
  const ds = useEditor((s) => s.docs.find((d) => d.id === s.activeId) ?? null)
  const vp = useEditor((s) => s.viewport)
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const geom = useRef({ scale: 1, ox: 0, oy: 0 })
  const doc = ds?.history.present
  const view = ds?.view

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Thumbnail (debounced: the composite only changes with edits)
  useEffect(() => {
    const c = canvas.current
    if (!c || !doc || !size.w) return
    const t = setTimeout(() => {
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(size.w * dpr)
      const H = Math.round(size.h * dpr)
      c.width = W
      c.height = H
      const pad = 10 * dpr
      const scale = Math.min((W - pad * 2) / doc.width, (H - pad * 2) / doc.height)
      const w = doc.width * scale
      const h = doc.height * scale
      const ox = Math.round((W - w) / 2)
      const oy = Math.round((H - h) / 2)
      geom.current = { scale: scale / dpr, ox: ox / dpr, oy: oy / dpr }
      const g = c.getContext('2d')!
      g.fillStyle = g.createPattern(checkerTile(4 * dpr), 'repeat')!
      g.fillRect(ox, oy, Math.round(w), Math.round(h))
      const tmp = poolCanvas('nav', W, H)
      renderDocument(tmp, doc, { xf: { scale, ox, oy }, width: W, height: H })
      g.drawImage(tmp, 0, 0)
      drawViewBox()
    }, 120)
    return () => clearTimeout(t)
  }, [doc, size])

  const box = useRef<HTMLDivElement>(null)
  const drawViewBox = () => {
    const b = box.current
    const d = activeDocState()
    if (!b || !d?.view) return
    const { scale, ox, oy } = geom.current
    const v = d.view
    const w = (vp.w / v.zoom) * scale
    const h = (vp.h / v.zoom) * scale
    b.style.left = `${ox + (v.cx - vp.w / 2 / v.zoom) * scale}px`
    b.style.top = `${oy + (v.cy - vp.h / 2 / v.zoom) * scale}px`
    b.style.width = `${w}px`
    b.style.height = `${h}px`
  }
  useEffect(drawViewBox, [view, vp, size])

  if (!ds || !doc || !view) return <div className="panel"><div className="empty-hint">No document open.</div></div>

  const panTo = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect()
    const { scale, ox, oy } = geom.current
    const d = activeDocState()
    if (!d?.view) return
    setView(d.id, { ...d.view, cx: (e.clientX - r.left - ox) / scale, cy: (e.clientY - r.top - oy) / scale })
  }

  return (
    <div className="panel">
      <div
        ref={wrap}
        className="navigator"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          panTo(e)
        }}
        onPointerMove={(e) => e.buttons & 1 && panTo(e)}
      >
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
        <div ref={box} className="nav-box" style={{ borderColor: token('--c-accent') }} />
      </div>
      <div className="nav-bar">
        <button className="icon-btn small" title="Zoom out" onClick={zoomOut}>
          <IconZoomOut size={14} />
        </button>
        <input type="range" min={0} max={1} step={0.001} value={toSlider(view.zoom)} onChange={(e) => setView(ds.id, { ...view, zoom: clampZoom(fromSlider(Number(e.target.value))) })} aria-label="Zoom" />
        <button className="icon-btn small" title="Zoom in" onClick={zoomIn}>
          <IconZoom size={14} />
        </button>
        <span className="val">{formatZoom(view.zoom)}</span>
      </div>
    </div>
  )
}
