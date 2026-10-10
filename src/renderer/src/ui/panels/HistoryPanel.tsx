import { useEffect, useRef } from 'react'
import { DOC_HISTORY_STEPS, jumpToStep } from '../../state/doc-actions'
import { useEditor } from '../../state/store'

export function HistoryPanel() {
  const h = useEditor((s) => s.docs.find((d) => d.id === s.activeId)?.history ?? null)
  const cur = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void cur.current?.scrollIntoView({ block: 'nearest' })
  }, [h?.revision])
  if (!h) return <div className="panel"><div className="empty-hint">No document open.</div></div>
  const rows = [...h.past.map((p) => p.label), h.presentLabel, ...h.future.map((f) => f.label)]
  const current = h.past.length
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
