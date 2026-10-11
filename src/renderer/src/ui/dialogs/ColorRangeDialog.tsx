/**
 * Select → Color Range. The preview shows the selection as greys (white =
 * selected); clicking the image thumbnail samples a colour.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { RANGE_LABELS, rangeFunction, type RangeKind, type RangeSpec } from '@core/color-range'
import { hexToRgb } from '@cadence/core/color'
import type { SelMode } from '@core/selection'
import { Modal, SliderField } from '@cadence/ui/components'
import { ctx2d } from '../../engine/format'
import { sampleSource } from '../../engine/pixels'
import { maskFromCanvas } from '../../engine/selection'
import * as A from '../../state/image-actions'
import { activeDoc, get, set } from '../../state/store'

const PREVIEW = 220

/** Selected amount → alpha of a canvas the size of `src`. */
export function colorRangeCanvas(src: OffscreenCanvas, spec: RangeSpec): OffscreenCanvas {
  const w = src.width
  const h = src.height
  const d = ctx2d(src).getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data
  const out = new ImageData(w, h)
  const f = rangeFunction(spec)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    out.data[i + 3] = Math.round(f(d[i], d[i + 1], d[i + 2]) * 255 * (d[i + 3] / 255))
  }
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(out, 0, 0)
  return c
}

export function ColorRangeDialog() {
  const doc = activeDoc()!
  const [kind, setKind] = useState<RangeKind>('sampled')
  const [color, setColor] = useState(() => get().fg)
  const [fuzz, setFuzz] = useState(40)
  const [mode, setMode] = useState<SelMode>('replace')
  const [sampleAll, setSampleAll] = useState(true)
  const view = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLCanvasElement>(null)
  // A small copy of the image for the live preview.
  const thumb = useMemo(() => {
    const s = Math.min(1, PREVIEW / Math.max(doc.width, doc.height))
    const c = new OffscreenCanvas(Math.max(1, Math.round(doc.width * s)), Math.max(1, Math.round(doc.height * s)))
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(sampleSource(doc, sampleAll), 0, 0, c.width, c.height)
    return c
  }, [doc, sampleAll])
  const rgb = hexToRgb(color)
  const spec: RangeSpec = { kind, color: [rgb.r, rgb.g, rgb.b], fuzziness: fuzz }
  useEffect(() => {
    const m = colorRangeCanvas(thumb, spec)
    for (const [ref, draw] of [
      [view, (g: CanvasRenderingContext2D) => (g.fillStyle = '#000', g.fillRect(0, 0, thumb.width, thumb.height), g.drawImage(whiteOf(m), 0, 0))],
      [image, (g: CanvasRenderingContext2D) => g.drawImage(thumb, 0, 0)]
    ] as const) {
      const c = ref.current
      if (!c) continue
      c.width = thumb.width
      c.height = thumb.height
      draw(c.getContext('2d')!)
    }
    // spec is derived from these values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumb, kind, color, fuzz])
  const close = () => set({ dialog: null })
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * thumb.width)
    const y = Math.floor(((e.clientY - r.top) / r.height) * thumb.height)
    const p = thumb.getContext('2d')!.getImageData(x, y, 1, 1).data
    setColor('#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join(''))
    setKind('sampled')
  }
  const ok = () => {
    close()
    const full = colorRangeCanvas(sampleSource(doc, sampleAll), spec)
    A.addSelectionShape({ kind: 'mask', maskId: maskFromCanvas(full), x: 0, y: 0 }, mode, 'Color Range')
  }
  return (
    <Modal
      title="Color Range"
      onClose={close}
      onSubmit={ok}
      width={560}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={ok}>
            OK
          </button>
        </>
      }
    >
      <div className="color-range">
        <div className="form-grid">
          <label>Select</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as RangeKind)}>
            {(Object.keys(RANGE_LABELS) as RangeKind[]).map((k) => (
              <option key={k} value={k}>
                {RANGE_LABELS[k]}
              </option>
            ))}
          </select>
          {kind === 'sampled' && (
            <>
              <label>Colour</label>
              <div className="pair">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Sampled colour" />
                <span className="note">or click the image</span>
              </div>
              <label>Fuzziness</label>
              <SliderField label="" value={fuzz} min={0} max={200} width={160} onChange={setFuzz} />
            </>
          )}
          <label>Sample</label>
          <select value={sampleAll ? 'all' : 'layer'} onChange={(e) => setSampleAll(e.target.value === 'all')}>
            <option value="all">All layers</option>
            <option value="layer">Current layer</option>
          </select>
          <label>Selection</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as SelMode)}>
            <option value="replace">New selection</option>
            <option value="add">Add to selection</option>
            <option value="subtract">Subtract from selection</option>
            <option value="intersect">Intersect with selection</option>
          </select>
        </div>
        <div className="color-range-previews">
          <figure>
            <canvas ref={view} />
            <figcaption>Selection</figcaption>
          </figure>
          <figure>
            <canvas ref={image} onClick={pick} style={{ cursor: 'crosshair' }} title="Click to sample a colour" />
            <figcaption>Image</figcaption>
          </figure>
        </div>
      </div>
    </Modal>
  )
}

/** White where selected (from an alpha mask), for the preview. */
function whiteOf(m: OffscreenCanvas): OffscreenCanvas {
  const c = new OffscreenCanvas(m.width, m.height)
  const g = c.getContext('2d')!
  g.drawImage(m, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  return c
}
