/**
 * Keyboard Shortcuts editor: every command, searchable; click + and press a
 * key to add a shortcut, × to remove one, ↺ to restore the default. A key
 * already in use moves to the new command and the previous owner is named.
 */
import { useEffect, useMemo, useState } from 'react'
import { COMMANDS, comboOf, defaultKeysFor, keysFor, resetAllKeys, setKeysFor } from '../../state/commands'
import { set, useEditor } from '../../state/store'
import { Modal } from '@cadence/ui/components'

const GROUPS: Record<string, string> = {
  file: 'File',
  edit: 'Edit',
  image: 'Image',
  layer: 'Layer',
  select: 'Select',
  filter: 'Filter',
  view: 'View',
  tool: 'Tools',
  color: 'Color',
  window: 'Window',
  help: 'Help',
  crop: 'Crop',
  transform: 'Transform'
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

export function ShortcutsDialog() {
  useEditor((s) => s.keyOverrides)
  const [q, setQ] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const close = () => set({ dialog: null })

  useEffect(() => {
    if (!recording) return
    document.body.dataset.recording = '1'
    const onKey = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(null)
        return
      }
      const combo = comboOf(e)
      const takenFrom = COMMANDS.filter((c) => c.id !== recording && keysFor(c.id).includes(combo))
      for (const c of takenFrom) setKeysFor(c.id, keysFor(c.id).filter((k) => k !== combo))
      if (!keysFor(recording).includes(combo)) setKeysFor(recording, [...keysFor(recording), combo])
      setNote(takenFrom.length ? `${combo} was moved from “${takenFrom.map((c) => c.label).join('”, “')}”.` : null)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      delete document.body.dataset.recording
      window.removeEventListener('keydown', onKey, true)
    }
  }, [recording])

  const groups = useMemo(() => {
    const out = new Map<string, typeof COMMANDS>()
    const needle = q.trim().toLowerCase()
    for (const c of COMMANDS) {
      const keys = keysFor(c.id)
      if (needle && !c.label.toLowerCase().includes(needle) && !keys.some((k) => k.toLowerCase().includes(needle))) continue
      const g = GROUPS[c.id.split('.')[0]] ?? 'Other'
      if (!out.has(g)) out.set(g, [])
      out.get(g)!.push(c)
    }
    return [...out.entries()]
    // keyOverrides changes re-render via the store subscription above
  }, [q, useEditor.getState().keyOverrides])

  return (
    <Modal
      title="Keyboard Shortcuts"
      onClose={recording ? undefined : close}
      width={760}
      actions={
        <>
          <button
            className="btn"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              resetAllKeys()
              setNote('All shortcuts restored to their defaults.')
            }}
          >
            Reset All
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="shortcut-tools">
        <input type="text" placeholder="Search commands or keys…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ flex: 1 }} />
        <span className="note">{recording ? 'Press the new shortcut… (Esc cancels)' : note ?? 'Click + to add a shortcut.'}</span>
      </div>
      <div className="shortcut-list">
        {groups.map(([g, list]) => (
          <div key={g} className="shortcut-group">
            <div className="form-section">{g}</div>
            {list.map((c) => {
              const keys = keysFor(c.id)
              const changed = JSON.stringify(keys) !== JSON.stringify(defaultKeysFor(c.id))
              return (
                <div key={c.id} className={`shortcut-row${recording === c.id ? ' recording' : ''}`} data-command={c.id}>
                  <span>{c.label}</span>
                  <span className="keys">
                    {keys.map((k) => (
                      <span key={k} className="kbd-cap">
                        {k}
                        <button className="kbd-x" title={`Remove ${k}`} onClick={() => setKeysFor(c.id, keys.filter((x) => x !== k))}>
                          ×
                        </button>
                      </span>
                    ))}
                    <button className="icon-btn small" title="Add a shortcut" onClick={() => setRecording(recording === c.id ? null : c.id)}>
                      {recording === c.id ? '…' : '+'}
                    </button>
                    <button className="icon-btn small" title="Restore the default" disabled={!changed} onClick={() => setKeysFor(c.id, null)}>
                      ↺
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Modal>
  )
}
