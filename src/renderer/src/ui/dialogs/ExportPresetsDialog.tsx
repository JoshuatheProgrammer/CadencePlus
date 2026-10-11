/**
 * File → Export with Presets: tick presets, adjust them, pick a folder; one
 * file per preset. The list is saved in settings.
 */
import { useState } from 'react'
import { DEFAULT_PRESETS, duplicateNames, presetFileName, presetSize, type ExportPreset, type PresetFormat } from '@core/export-presets'
import { docColor } from '@core/model'
import { Modal, NumberInput } from '@cadence/ui/components'
import { displayName, exportWithPresets, setExportPresets } from '../../state/doc-actions'
import { activeDocState, get, set } from '../../state/store'

const FORMAT_LABELS: Record<PresetFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', tiff: 'TIFF' }

export function ExportPresetsDialog() {
  const ds = activeDocState()!
  const doc = ds.history.present
  const name = displayName(ds)
  const [list, setList] = useState<ExportPreset[]>(() => structuredClone(get().exportPresets))
  const [sel, setSel] = useState(0)
  const close = () => set({ dialog: null })
  const up = (i: number, patch: Partial<ExportPreset>) => setList((l) => l.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const enabled = list.filter((p) => p.enabled)
  const clashes = duplicateNames(name, list)
  const go = async () => {
    setExportPresets(list)
    const folder = await window.cadencePlus.folderDialog('Export with Presets — choose a folder')
    if (!folder) return
    close()
    await exportWithPresets(folder, list.filter((p) => p.enabled))
  }
  const p = list[sel]
  const sixteenDoc = docColor(doc).depth === 16
  return (
    <Modal
      title="Export with Presets"
      onClose={() => (setExportPresets(list), close())}
      onSubmit={() => void go()}
      width={680}
      actions={
        <>
          <span className="note" style={{ marginRight: 'auto' }}>
            {clashes.length ? `Two presets write ${clashes[0]}: change a suffix.` : `${enabled.length} file${enabled.length === 1 ? '' : 's'} · existing files with the same names are replaced`}
          </span>
          <button className="btn" onClick={() => (setExportPresets(list), close())}>
            Close
          </button>
          <button className="btn primary" disabled={!enabled.length || clashes.length > 0} onClick={() => void go()}>
            Export to Folder…
          </button>
        </>
      }
    >
      <div className="presets">
        <div className="preset-list" role="listbox" aria-label="Presets">
          {list.map((x, i) => {
            const sz = presetSize(x, doc.width, doc.height)
            return (
              <div key={x.id} className={`preset-item${i === sel ? ' selected' : ''}`} role="option" aria-selected={i === sel} onClick={() => setSel(i)}>
                <input type="checkbox" checked={x.enabled} aria-label={`Export ${x.name}`} onClick={(e) => e.stopPropagation()} onChange={(e) => up(i, { enabled: e.target.checked })} />
                <span className="preset-name">{x.name}</span>
                <span className="note">
                  {FORMAT_LABELS[x.format]} · {sz.w}×{sz.h}
                </span>
              </div>
            )
          })}
          <div className="preset-tools">
            <button
              className="btn small"
              onClick={() => {
                const n = { ...structuredClone(p ?? DEFAULT_PRESETS[0]), id: `p${Date.now()}`, name: `${p?.name ?? 'Preset'} copy`, enabled: true }
                setList((l) => [...l, n])
                setSel(list.length)
              }}
            >
              Duplicate
            </button>
            <button
              className="btn small"
              disabled={list.length < 2}
              onClick={() => {
                setList((l) => l.filter((_, j) => j !== sel))
                setSel(Math.max(0, sel - 1))
              }}
            >
              Remove
            </button>
            <button className="btn small" onClick={() => (setList(structuredClone(DEFAULT_PRESETS)), setSel(0))}>
              Reset
            </button>
          </div>
        </div>
        {p && (
          <div className="form-grid preset-form">
            <label>Name</label>
            <input type="text" value={p.name} onChange={(e) => up(sel, { name: e.target.value })} />
            <label>Format</label>
            <select value={p.format} onChange={(e) => up(sel, { format: e.target.value as PresetFormat })}>
              {(Object.keys(FORMAT_LABELS) as PresetFormat[]).map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
            {(p.format === 'jpeg' || p.format === 'webp') && (
              <>
                <label>Quality</label>
                <div className="pair">
                  <NumberInput value={p.quality} min={1} max={100} onChange={(v) => up(sel, { quality: v })} /> <span className="unit">%</span>
                </div>
              </>
            )}
            <label>Scale</label>
            <div className="pair">
              <NumberInput value={p.scale} min={1} max={1000} onChange={(v) => up(sel, { scale: v })} /> <span className="unit">%</span>
            </div>
            <label>Longest side</label>
            <div className="pair">
              <NumberInput value={p.maxSide} min={0} max={16384} onChange={(v) => up(sel, { maxSide: v })} /> <span className="unit">px max (0 = no limit)</span>
            </div>
            <label>Suffix</label>
            <input type="text" value={p.suffix} onChange={(e) => up(sel, { suffix: e.target.value })} />
            {(p.format === 'png' || p.format === 'tiff') && sixteenDoc && (
              <>
                <label>Bit depth</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-text)' }}>
                  <input type="checkbox" checked={p.sixteenBit} onChange={(e) => up(sel, { sixteenBit: e.target.checked })} /> 16 bits/channel
                </label>
              </>
            )}
            <label>File</label>
            <span className="note">
              {presetFileName(name, p)} · {presetSize(p, doc.width, doc.height).w} × {presetSize(p, doc.width, doc.height).h} px
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}
