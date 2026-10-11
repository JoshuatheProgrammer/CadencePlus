import { useEffect, useRef } from 'react'
import { DOC_HISTORY_STEPS, jumpToStep } from '../../state/doc-actions'
import { get, set, useEditor } from '../../state/store'
import { IconHistoryBrush } from '../icons'

export function HistoryPanel() {
  const h = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.history ?? null)
  const source = useEditor((s) => s.historySource)
  const cur = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void cur.current?.scrollIntoView({ block: 'nearest' })
  }, [h?.revision])
  if (!h) return <div className="panel"><div className="empty-hint">No document open.</div></div>
  const rows = [...h.past.map((p) => p.label), h.presentLabel, ...h.future.map((f) => f.label)]
  const states = [...h.past.map((p) => p.state), h.present, ...h.future.map((f) => f.state)]
  const current = h.past.length
  // History Brush source: the chosen state, else the oldest one kept.
  const docId = get().activeId!
  const srcIdx = source?.docId === docId ? states.indexOf(source.state) : 0
  return (
    <div className="panel">
      <div className="panel-body">
        {rows.map((label, i) => (
          <div
            key={i}
            ref={i === current ? cur : undefined}
            className={`history-row${i === current ? ' current' : ''}${i > current ? ' future' : ''}`}
            onClick={() => jumpToStep(i)}
          >
            <button
              className={`history-src${i === srcIdx ? ' on' : ''}`}
              title={i === srcIdx ? 'History Brush paints from this state' : 'Paint from this state with the History Brush'}
              onClick={(e) => {
                e.stopPropagation()
                set({ historySource: { docId, state: states[i] } })
              }}
            >
              <IconHistoryBrush size={12} />
            </button>
            <span className="idx">{i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="panel-footer" style={{ justifyContent: 'flex-start' }}>
        <span className="note">
          {h.past.length} of {DOC_HISTORY_STEPS} undo steps
        </span>
      </div>
    </div>
  )
}
