import { useEffect, useMemo, useState } from 'react'
import { ADJUSTMENTS, adjustmentOp, blurFilter, defaultAdjustment, type AdjustmentKind } from '@core/adjustments'
import { docColor, MAX_DIMENSION } from '@core/model'
import { exportImage, type ExportFormat } from '../../engine/io'
import { COMMANDS } from '../../state/commands'
import { exportAs, formatBytes, newDocument, type BackgroundChoice } from '../../state/doc-actions'
import * as A from '../../state/image-actions'
import { activeDoc, get, set, toast, useEditor, type Dialog } from '../../state/store'
import { histogram } from '@core/lut'
import { layerCanvas } from '../../engine/pixels'
import { AdjustmentEditor } from '../AdjustmentEditor'
import { Modal, NumberInput, SliderField } from '@cadence/ui/components'
import { Logo, Wordmark } from '../icons'
import { ShortcutsDialog } from './ShortcutsDialog'
import { FilterDialog } from './FilterDialog'
import { ColorRangeDialog } from './ColorRangeDialog'

const close = () => set({ dialog: null, filterPreview: null })

// ---------------------------------------------------------------------------
// New document
// ---------------------------------------------------------------------------

export const PRESETS: { name: string; w: number; h: number; ppi: number; group: string }[] = [
  { name: 'Default', w: 1920, h: 1080, ppi: 72, group: 'Screen' },
  { name: '4K UHD', w: 3840, h: 2160, ppi: 72, group: 'Screen' },
  { name: 'Square post', w: 1080, h: 1080, ppi: 72, group: 'Social' },
  { name: 'Story', w: 1080, h: 1920, ppi: 72, group: 'Social' },
  { name: 'A4 portrait', w: 2480, h: 3508, ppi: 300, group: 'Print' },
  { name: 'Letter', w: 2550, h: 3300, ppi: 300, group: 'Print' },
  { name: 'Icon', w: 512, h: 512, ppi: 72, group: 'Screen' },
  { name: 'Web banner', w: 1500, h: 500, ppi: 72, group: 'Screen' },
  { name: '4 × 6 photo', w: 1800, h: 1200, ppi: 300, group: 'Print' }
]

function NewDocumentDialog() {
  const [name, setName] = useState('Untitled-1')
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)
  const [ppi, setPpi] = useState(72)
  const [bg, setBg] = useState<BackgroundChoice>('white')
  const [depth, setDepth] = useState<8 | 16>(8)
  const [space, setSpace] = useState<'srgb' | 'display-p3'>('srgb')
  const bgColor = useEditor((s) => s.bg)
  useEffect(() => {
    const n = get().docs.length + 1
    setName(`Untitled-${n}`)
  }, [])
  const mb = (w * h * 4) / 1024 ** 2
  const create = () => {
    if (newDocument({ name, width: w, height: h, resolution: ppi, background: bg, color: { depth, space } })) close()
  }
  return (
    <Modal
      title="New Document"
      onClose={close}
      onSubmit={create}
      width={560}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={create}>
            Create
          </button>
        </>
      }
    >
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.name} className={`preset${p.w === w && p.h === h && p.ppi === ppi ? ' selected' : ''}`} onClick={() => (setW(p.w), setH(p.h), setPpi(p.ppi))}>
            <span className="n">{p.name}</span>
            <span className="d">
              {p.w} × {p.h} · {p.ppi} ppi
            </span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <div className="form-section">Details</div>
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label>Width</label>
        <div className="pair">
          <NumberInput value={w} min={1} max={MAX_DIMENSION} onChange={setW} /> <span className="unit">px</span>
        </div>
        <label>Height</label>
        <div className="pair">
          <NumberInput value={h} min={1} max={MAX_DIMENSION} onChange={setH} /> <span className="unit">px</span>
          <button className="btn small" title="Swap width and height" onClick={() => (setW(h), setH(w))}>
            Swap
          </button>
        </div>
        <label>Resolution</label>
        <div className="pair">
          <NumberInput value={ppi} min={1} max={2400} onChange={setPpi} /> <span className="unit">pixels/inch</span>
        </div>
        <label>Color mode</label>
        <div className="pair">
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value) as 8 | 16)} style={{ width: 150 }}>
            <option value={8}>RGB · 8 bits/channel</option>
            <option value={16}>RGB · 16 bits/channel</option>
          </select>
          <select value={space} onChange={(e) => setSpace(e.target.value as 'srgb' | 'display-p3')} style={{ flex: 1 }}>
            <option value="srgb">sRGB IEC61966-2.1</option>
            <option value="display-p3">Display P3 (wide gamut)</option>
          </select>
        </div>
        <label>Background</label>
        <select value={bg} onChange={(e) => setBg(e.target.value as BackgroundChoice)}>
          <option value="white">White</option>
          <option value="black">Black</option>
          <option value="background">Background color ({bgColor})</option>
          <option value="transparent">Transparent</option>
        </select>
        <label />
        <span className="note">
          RGB · {depth} bits/channel · {mb * (depth / 8) < 1024 ? `${(mb * (depth / 8)).toFixed(1)} MB` : `${((mb * (depth / 8)) / 1024).toFixed(2)} GB`} per full layer · max {MAX_DIMENSION.toLocaleString()} px per side
        </span>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Adjustments (destructive, previewed live)
// ---------------------------------------------------------------------------

function AdjustDialog({ kind }: { kind: AdjustmentKind }) {
  const def = ADJUSTMENTS[kind]
  const [adj, setAdj] = useState(() => defaultAdjustment(kind))
  const [preview, setPreview] = useState(true)
  const target = useMemo(() => {
    const t = activeDoc() ? A.paintTarget('apply an adjustment') : null
    if (t?.kind === 'mask') {
      toast(`${ADJUSTMENTS[kind].label} changes colours, so it applies to pixels, not masks. Click the layer thumbnail to target its pixels.`, 'warn')
      return null
    }
    return t?.layer ?? null
  }, [kind])
  const op = useMemo(() => adjustmentOp(adj), [adj])
  const hist = useMemo(() => {
    const d = activeDoc()
    if (!d || !target) return null
    const c = layerCanvas(d, target, 'hist')
    return histogram(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
  }, [target])
  useEffect(() => {
    if (!target) return void set({ dialog: null })
    set({ filterPreview: preview && op ? { layerId: target.id, op } : null })
  }, [op, preview, target])
  const ok = () => {
    set({ dialog: null, filterPreview: null })
    if (op) A.applyFilter(op, def.label)
  }
  if (!target) return null
  return (
    <Modal
      title={def.label}
      onClose={close}
      onSubmit={ok}
      width={420}
      actions={
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview
          </label>
          <button className="btn" onClick={() => setAdj(defaultAdjustment(kind))}>
            Reset
          </button>
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
        <AdjustmentEditor a={adj} onChange={setAdj} hist={hist} />
        <span className="note">
          Applies to “{target.name}”{activeDoc()?.selection ? ' inside the selection' : ''}. For a non-destructive version use Layer → New Adjustment Layer.
        </span>
      </div>
    </Modal>
  )
}

function BlurDialog() {
  const [radius, setRadius] = useState(4)
  const [preview, setPreview] = useState(true)
  const target = useMemo(() => A.paintTarget('blur it')?.layer ?? null, [])
  useEffect(() => {
    if (!target) return void set({ dialog: null })
    set({ filterPreview: preview && radius > 0 ? { layerId: target.id, op: blurFilter(radius) } : null })
  }, [radius, preview, target])
  const ok = () => {
    set({ dialog: null, filterPreview: null })
    A.applyFilter(blurFilter(radius), 'Gaussian Blur')
  }
  if (!target) return null
  return (
    <Modal
      title="Gaussian Blur"
      onClose={close}
      onSubmit={ok}
      width={420}
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
        <SliderField label="Radius" value={radius} min={0.1} max={250} step={0.1} unit="px" width={200} onChange={setRadius} />
        <span className="note">Pixels beyond the layer edge count as transparent, so edges soften toward transparency.</span>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Image size / canvas size / feather
// ---------------------------------------------------------------------------

function ImageSizeDialog() {
  const d = activeDoc()!
  const [w, setW] = useState(d.width)
  const [h, setH] = useState(d.height)
  const [link, setLink] = useState(true)
  const ratio = d.width / d.height
  const ok = () => {
    close()
    if (w !== d.width || h !== d.height) A.transformImage({ kind: 'resize', width: w, height: h }, 'Image Size')
  }
  return (
    <Modal
      title="Image Size"
      onClose={close}
      onSubmit={ok}
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
      <div className="form-grid">
        <label>Current</label>
        <span className="note">
          {d.width} × {d.height} px
        </span>
        <label>Width</label>
        <div className="pair">
          <NumberInput value={w} min={1} max={MAX_DIMENSION} onChange={(v) => (setW(v), link && setH(Math.max(1, Math.round(v / ratio))))} />
          <span className="unit">px</span>
          <span className="unit">{Math.round((w / d.width) * 1000) / 10}%</span>
        </div>
        <label>Height</label>
        <div className="pair">
          <NumberInput value={h} min={1} max={MAX_DIMENSION} onChange={(v) => (setH(v), link && setW(Math.max(1, Math.round(v * ratio))))} />
          <span className="unit">px</span>
          <span className="unit">{Math.round((h / d.height) * 1000) / 10}%</span>
        </div>
        <label>Constrain</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-text)' }}>
          <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> Keep proportions
        </label>
        <label>Resample</label>
        <span className="note">High-quality (browser) — bicubic-like</span>
      </div>
    </Modal>
  )
}

const ANCHORS: [number, number][] = [
  [0, 0], [0.5, 0], [1, 0],
  [0, 0.5], [0.5, 0.5], [1, 0.5],
  [0, 1], [0.5, 1], [1, 1]
]

function CanvasSizeDialog() {
  const d = activeDoc()!
  const [w, setW] = useState(d.width)
  const [h, setH] = useState(d.height)
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5])
  const ok = () => {
    close()
    if (w !== d.width || h !== d.height) A.resizeCanvas(w, h, anchor[0], anchor[1])
  }
  return (
    <Modal
      title="Canvas Size"
      onClose={close}
      onSubmit={ok}
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
      <div className="form-grid">
        <label>Current</label>
        <span className="note">
          {d.width} × {d.height} px
        </span>
        <label>Width</label>
        <div className="pair">
          <NumberInput value={w} min={1} max={MAX_DIMENSION} onChange={setW} /> <span className="unit">px</span>
        </div>
        <label>Height</label>
        <div className="pair">
          <NumberInput value={h} min={1} max={MAX_DIMENSION} onChange={setH} /> <span className="unit">px</span>
        </div>
        <label>Anchor</label>
        <div className="anchor-grid">
          {ANCHORS.map(([ax, ay]) => (
            <button key={`${ax}${ay}`} className={anchor[0] === ax && anchor[1] === ay ? 'active' : ''} onClick={() => setAnchor([ax, ay])} title="Keep the image at this edge" />
          ))}
        </div>
        <label />
        <span className="note">New canvas area is transparent. Pixels outside the canvas are kept on their layers.</span>
      </div>
    </Modal>
  )
}

function FeatherDialog() {
  const [r, setR] = useState(5)
  const ok = () => {
    close()
    A.featherSelection(r)
  }
  return (
    <Modal
      title="Feather Selection"
      onClose={close}
      onSubmit={ok}
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
      <div className="form-grid">
        <label>Feather radius</label>
        <div className="pair">
          <NumberInput value={r} min={0.1} max={1000} decimals={1} onChange={setR} autoFocus /> <span className="unit">px</span>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportDialog() {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(90)
  const [sixteen, setSixteen] = useState(true)
  const [estimate, setEstimate] = useState<string>('…')
  const color = docColor(activeDoc()!)
  useEffect(() => {
    let live = true
    setEstimate('…')
    const t = setTimeout(() => {
      const d = activeDoc()
      if (!d) return
      exportImage(d, format, quality / 100, { sixteenBit: sixteen })
        .then((b) => live && setEstimate(formatBytes(b.length)))
        .catch((e: Error) => live && setEstimate(e.message))
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [format, quality, sixteen])
  const d = activeDoc()!
  const ok = () => {
    close()
    void exportAs(format, quality / 100, { sixteenBit: sixteen })
  }
  return (
    <Modal
      title="Export As"
      onClose={close}
      onSubmit={ok}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={ok}>
            Export…
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>Format</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          <option value="png">PNG — lossless, keeps transparency</option>
          <option value="jpeg">JPEG — smaller, no transparency</option>
          <option value="webp">WebP — lossy, keeps transparency</option>
          <option value="tiff">TIFF — lossless, uncompressed</option>
          <option value="psd">Photoshop (PSD) — keeps layers</option>
        </select>
        {(format === 'jpeg' || format === 'webp') && (
          <>
            <label>Quality</label>
            <SliderField label="" value={quality} min={1} max={100} unit="%" width={180} onChange={setQuality} />
          </>
        )}
        <label>Image</label>
        <span className="note">
          {d.width} × {d.height} px ·{' '}
          {format === 'psd' ? 'layers, groups, masks and adjustment layers; type and shapes as pixels' : `all visible layers, flattened${format === 'jpeg' ? ' · transparency becomes white' : ''}`}
        </span>
        {(format === 'png' || format === 'tiff') && color.depth === 16 && (
          <>
            <label>Bit depth</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-text)' }}>
              <input type="checkbox" checked={sixteen} onChange={(e) => setSixteen(e.target.checked)} /> 16 bits/channel
            </label>
          </>
        )}
        <label>Colour</label>
        <span className="note">
          {format === 'psd' ? (color.space === 'display-p3' ? 'converted to sRGB' : 'sRGB') : color.space === 'display-p3' ? 'Display P3, profile embedded' : 'sRGB'}
          {(format !== 'png' && format !== 'tiff') || color.depth === 8 || !sixteen ? ' · 8 bits/channel' : ' · 16 bits/channel'}
        </span>
        <label>File size</label>
        <span className="note">{estimate}</span>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function AboutDialog() {
  const v = window.cadencePlus.versions
  return (
    <Modal
      title="About Cadence+"
      onClose={close}
      actions={
        <button className="btn primary" onClick={close}>
          Close
        </button>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Logo size={56} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            <Wordmark />
          </div>
          <div className="note">Image editor · version {v.app}</div>
          <div className="note">
            Electron {v.electron} · Chromium {v.chrome}
          </div>
          <div className="note" style={{ marginTop: 6 }}>
            Sibling of Cadence. 8-bit RGB, tile-based layers, GPU compositing.
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ConfirmDialog({ d }: { d: Extract<Dialog, { kind: 'confirm' }> }) {
  const cancel = d.buttons.find((b) => b.value === 'cancel')
  const primary = d.buttons.find((b) => b.primary)
  return (
    <Modal
      title={d.title}
      onClose={() => d.resolve(cancel?.value ?? d.buttons[0].value)}
      onSubmit={primary ? () => d.resolve(primary.value) : undefined}
      actions={d.buttons.map((b) => (
        <button key={b.value} className={`btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`} onClick={() => d.resolve(b.value)} autoFocus={b.primary}>
          {b.label}
        </button>
      ))}
    >
      <div style={{ whiteSpace: 'pre-wrap' }}>{d.message}</div>
    </Modal>
  )
}

function PromptDialog({ d }: { d: Extract<Dialog, { kind: 'prompt' }> }) {
  const [v, setV] = useState(d.value)
  return (
    <Modal
      title={d.title}
      onClose={() => d.resolve(null)}
      onSubmit={() => d.resolve(v)}
      actions={
        <>
          <button className="btn" onClick={() => d.resolve(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => d.resolve(v)}>
            OK
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>{d.label}</label>
        <input type="text" autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} />
      </div>
    </Modal>
  )
}

export function Dialogs() {
  const d = useEditor((s) => s.dialog)
  if (!d) return null
  switch (d.kind) {
    case 'newDocument':
      return <NewDocumentDialog />
    case 'adjust':
      return <AdjustDialog kind={d.adjustment} />
    case 'blur':
      return <BlurDialog />
    case 'filter':
      return <FilterDialog kind={d.filter} />
    case 'colorRange':
      return activeDoc() ? <ColorRangeDialog /> : null
    case 'imageSize':
      return activeDoc() ? <ImageSizeDialog /> : null
    case 'canvasSize':
      return activeDoc() ? <CanvasSizeDialog /> : null
    case 'feather':
      return <FeatherDialog />
    case 'export':
      return activeDoc() ? <ExportDialog /> : null
    case 'shortcuts':
      return <ShortcutsDialog />
    case 'about':
      return <AboutDialog />
    case 'confirm':
      return <ConfirmDialog d={d} />
    case 'prompt':
      return <PromptDialog d={d} />
  }
}
