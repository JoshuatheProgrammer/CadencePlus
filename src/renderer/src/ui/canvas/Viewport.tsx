import { useEffect, useRef, useState } from 'react'
import { fitView, panBy, zoomAt, type View } from '@core/view'
import { docRectOnTarget, renderDocument } from '../../engine/render'
import { poolCanvas } from '../../engine/tiles'
import { commitCrop } from '../../state/commands'
import { openPaths, setView } from '../../state/doc-actions'
import { activeDocState, get, set, useEditor } from '../../state/store'
import { toolDef } from '../../state/tools'
import { checkerTile, token } from '../tokens'
import { drawOverlay, hasAnts, onOverlayRequest, overlay, requestOverlay } from './overlay'
import { HANDLERS, panSession, setEventMapper, transformHitAt, transformSession, type Pt, type Session, type ToolContext } from './tool-handlers'
import { transformMatrix } from '../../state/transform-actions'
import { TextEditor } from './TextEditor'

/** The viewport's live geometry, shared with rulers. */
export const viewportGeom = { w: 0, h: 0, dpr: 1 }

let spaceHeld = false

function xfFor(v: View, w: number, h: number, dpr: number) {
  return { scale: v.zoom * dpr, ox: (w / 2 - v.cx * v.zoom) * dpr, oy: (h / 2 - v.cy * v.zoom) * dpr }
}

export function Viewport() {
  const wrap = useRef<HTMLDivElement>(null)
  const docCanvas = useRef<HTMLCanvasElement>(null)
  const ovCanvas = useRef<HTMLCanvasElement>(null)
  const session = useRef<Session | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0, dpr: window.devicePixelRatio || 1 })
  const [dragging, setDragging] = useState(false)
  const [space, setSpace] = useState(false)
  const [dropping, setDropping] = useState(false)

  const ds = useEditor((s) => s.docs.find((d) => d.id === s.activeId) ?? null)
  const tool = useEditor((s) => s.tool)
  const stroke = useEditor((s) => s.stroke)
  const filterPreview = useEditor((s) => s.filterPreview)
  const crop = useEditor((s) => s.crop)
  const maskView = useEditor((s) => s.maskView)
  const transform = useEditor((s) => (s.transform && s.transform.fs.docId === s.activeId ? s.transform : null))
  const [tfCursor, setTfCursor] = useState<string | null>(null)
  const showGrid = useEditor((s) => s.showPixelGrid)
  const zoomOut = useEditor((s) => s.options.zoom.out)
  const brushSize = useEditor((s) => (s.tool === 'brush' || s.tool === 'eraser' || s.tool === 'clone' || s.tool === 'heal' ? s.options[s.tool].size : null))
  const doc = ds?.history.present ?? null
  const view = ds?.view ?? null

  // Size tracking
  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      setSize({ w: Math.round(r.width), h: Math.round(r.height), dpr })
      set({ viewport: { w: Math.round(r.width), h: Math.round(r.height) } })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  viewportGeom.w = size.w
  viewportGeom.h = size.h
  viewportGeom.dpr = size.dpr

  // Fit new documents on first show
  useEffect(() => {
    if (!ds || ds.view || !wrap.current) return
    // Measure live: the options bar may have just appeared and the
    // ResizeObserver state can lag one frame behind.
    const r = wrap.current.getBoundingClientRect()
    if (r.width > 0) setView(ds.id, fitView(ds.history.present.width, ds.history.present.height, r.width, r.height))
  }, [ds, size.w, size.h])

  // Document render
  useEffect(() => {
    const c = docCanvas.current
    if (!c || !doc || !view || !size.w) return
    const raf = requestAnimationFrame(() => {
      const W = Math.round(size.w * size.dpr)
      const H = Math.round(size.h * size.dpr)
      if (c.width !== W || c.height !== H) {
        c.width = W
        c.height = H
      }
      const ctx = c.getContext('2d')!
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const xf = xfFor(view, size.w, size.h, size.dpr)
      const r = docRectOnTarget(doc, xf)
      // Transparency checkerboard, fixed in screen space like Photoshop's
      ctx.fillStyle = ctx.createPattern(checkerTile(8 * size.dpr), 'repeat')!
      ctx.fillRect(r.x, r.y, r.w, r.h)
      const comp = poolCanvas('view.composite', W, H)
      renderDocument(comp, doc, { xf, width: W, height: H, stroke, filterPreview, maskView, float: transform ? { fs: transform.fs, m: transformMatrix(transform), params: transform.params } : null })
      ctx.drawImage(comp, 0, 0)
      // Pixel grid at high zoom
      if (showGrid && view.zoom >= 8) {
        ctx.save()
        ctx.beginPath()
        const s = xf.scale
        const x0 = Math.max(0, Math.floor(-xf.ox / s))
        const x1 = Math.min(doc.width, Math.ceil((W - xf.ox) / s))
        const y0 = Math.max(0, Math.floor(-xf.oy / s))
        const y1 = Math.min(doc.height, Math.ceil((H - xf.oy) / s))
        for (let x = x0; x <= x1; x++) {
          const px = Math.round(xf.ox + x * s) + 0.5
          ctx.moveTo(px, Math.max(r.y, 0))
          ctx.lineTo(px, Math.min(r.y + r.h, H))
        }
        for (let y = y0; y <= y1; y++) {
          const py = Math.round(xf.oy + y * s) + 0.5
          ctx.moveTo(Math.max(r.x, 0), py)
          ctx.lineTo(Math.min(r.x + r.w, W), py)
        }
        ctx.strokeStyle = token('--pixel-grid')
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      }
      ctx.strokeStyle = token('--c-doc-edge')
      ctx.lineWidth = 1
      ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1)
    })
    return () => cancelAnimationFrame(raf)
  }, [doc, view, size, stroke, stroke?.rev, filterPreview, showGrid, maskView, transform])

  // Overlay render (ants animate while a selection exists)
  const frameRef = useRef(0)
  const phase = useRef(0)
  useEffect(() => {
    const draw = () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(() => {
        const c = ovCanvas.current
        if (!c || !doc || !view || !size.w) return
        const W = Math.round(size.w * size.dpr)
        const H = Math.round(size.h * size.dpr)
        if (c.width !== W || c.height !== H) {
          c.width = W
          c.height = H
        }
        drawOverlay(c, { doc, view, w: size.w, h: size.h, dpr: size.dpr, crop: tool === 'crop' || crop ? crop : null, brushSize: space || transform ? null : brushSize, antsPhase: phase.current, transform: !!transform, showCloneMarker: tool === 'clone' || tool === 'heal' })
      })
    }
    onOverlayRequest(draw)
    draw()
    const timer = window.setInterval(() => {
      if (!hasAnts()) return
      phase.current = (phase.current + 1) % 8
      draw()
    }, 110)
    return () => {
      onOverlayRequest(null)
      clearInterval(timer)
      cancelAnimationFrame(frameRef.current)
    }
  }, [doc, view, size, crop, tool, brushSize, space, transform])

  // Clear the pending crop when leaving the Crop tool
  useEffect(() => {
    if (tool !== 'crop' && get().crop) set({ crop: null })
  }, [tool])

  // Space = temporary Hand
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target) && !get().dialog) {
        e.preventDefault()
        if (!spaceHeld) {
          spaceHeld = true
          setSpace(true)
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld = false
        setSpace(false)
      }
    }
    const blur = () => {
      spaceHeld = false
      setSpace(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const toPt = (e: { clientX: number; clientY: number }, v: View): Pt => {
    const r = wrap.current!.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    return { sx, sy, x: (sx - size.w / 2) / v.zoom + v.cx, y: (sy - size.h / 2) / v.zoom + v.cy }
  }

  const context = (): ToolContext | null => {
    const d = activeDocState()
    if (!d || !d.view) return null
    return { docId: d.id, doc: d.history.present, view: d.view, w: size.w, h: size.h }
  }

  setEventMapper((c, e) => toPt(e, c.view))

  const onPointerDown = (e: React.PointerEvent) => {
    const c = context()
    if (!c || session.current) return
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    wrap.current!.setPointerCapture(e.pointerId)
    const p = toPt(e, c.view)
    let s: Session | null
    const hit = get().transform && get().transform!.fs.docId === c.docId ? transformHitAt(c, p.sx, p.sy) : null
    if (e.button === 1 || spaceHeld || tool === 'hand') s = panSession(c, p)
    else if (hit) s = transformSession(c, p, hit)
    else s = HANDLERS[tool]?.(c, p, e.nativeEvent) ?? null
    session.current = s
    setDragging(!!s)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = activeDocState()
    if (!d?.view) return
    const p = toPt(e, d.view)
    overlay.pointer = { x: p.sx, y: p.sy }
    if (brushSize) requestOverlay()
    const s = get()
    if (!s.cursor || Math.floor(s.cursor.x) !== Math.floor(p.x) || Math.floor(s.cursor.y) !== Math.floor(p.y)) set({ cursor: { x: p.x, y: p.y } })
    session.current?.move(p, e.nativeEvent)
    if (!session.current && get().transform) {
      const hit = transformHitAt({ view: d.view, w: size.w, h: size.h }, p.sx, p.sy)
      const cur = !hit ? null : hit.kind === 'move' ? 'move' : hit.kind === 'rotate' ? 'alias' : hit.hx * hit.hy > 0 ? 'nwse-resize' : hit.hx * hit.hy < 0 ? 'nesw-resize' : hit.hx ? 'ew-resize' : 'ns-resize'
      if (cur !== tfCursor) setTfCursor(cur)
    } else if (tfCursor && !get().transform) setTfCursor(null)
  }

  const endSession = (e: React.PointerEvent, cancelled = false) => {
    const s = session.current
    session.current = null
    setDragging(false)
    if (!s) return
    const d = activeDocState()
    if (cancelled || !d?.view) s.cancel?.()
    else s.up(toPt(e, d.view), e.nativeEvent)
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const d = activeDocState()
    if (!d?.view) return
    const v = d.view
    if (e.ctrlKey || e.altKey) {
      const p = toPt(e, v)
      setView(d.id, zoomAt(v, size.w, size.h, v.zoom * Math.exp(-e.deltaY * 0.0022), p.sx, p.sy))
    } else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX
      const dy = e.shiftKey ? 0 : e.deltaY
      setView(d.id, panBy(v, -dx, -dy))
    }
  }

  const onDoubleClick = () => {
    if (tool === 'crop' && get().crop) commitCrop()
  }

  const wheelRef = useRef(onWheel)
  wheelRef.current = onWheel
  useEffect(() => {
    const el = wrap.current!
    const h = (e: WheelEvent) => wheelRef.current(e)
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  const cursorClass = space || tool === 'hand' ? 'tool-hand' : `tool-${tool}`
  const noCursor = !space && brushSize !== null
  return (
    <div
      ref={wrap}
      className={`viewport ${cursorClass}${dragging ? ' dragging' : ''}${tool === 'zoom' && zoomOut ? ' out' : ''}${dropping ? ' drop-target' : ''}`}
      style={transform && tfCursor ? { cursor: tfCursor } : noCursor && !transform ? { cursor: 'none' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endSession(e)}
      onPointerCancel={(e) => endSession(e, true)}
      onLostPointerCapture={(e) => session.current && endSession(e)}
      onPointerLeave={() => {
        overlay.pointer = null
        requestOverlay()
        set({ cursor: null })
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDropping(true)
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const paths = [...e.dataTransfer.files].map((f) => window.cadencePlus.pathForFile(f)).filter(Boolean)
        if (paths.length) void openPaths(paths)
      }}
      aria-label={doc ? `${doc.name} canvas, ${toolDef(tool).label} tool` : 'Canvas'}
    >
      <canvas ref={docCanvas} style={{ width: size.w, height: size.h }} />
      <canvas ref={ovCanvas} style={{ width: size.w, height: size.h, pointerEvents: 'none' }} />
      <TextEditor w={size.w} h={size.h} />
    </div>
  )
}
