/**
 * On-canvas type editing. A transparent textarea sits exactly over the type
 * layer (same transform, font, tracking and baselines), so what you see is
 * the real canvas rendering, with the textarea providing the caret,
 * selection and keyboard handling.
 */
import { useEffect, useRef } from 'react'
import { paramsToMatrix } from '@core/affine'
import { fontString, layoutText } from '../../engine/vector'
import { cancelText, commitText, updateText } from '../../state/vector-actions'
import { useEditor } from '../../state/store'

export function TextEditor({ w, h }: { w: number; h: number }) {
  const te = useEditor((s) => s.textEdit)
  const ds = useEditor((s) => (s.textEdit ? s.docs.find((d) => d.id === s.textEdit!.docId) ?? null : null))
  const active = useEditor((s) => s.activeId)
  const ref = useRef<HTMLTextAreaElement>(null)
  const l = ds?.history.present.layers.find((x) => x.id === te?.layerId)
  const view = ds?.view

  useEffect(() => {
    const t = ref.current
    if (!t) return
    const raf = requestAnimationFrame(() => {
      t.focus()
      t.setSelectionRange(t.value.length, t.value.length)
    })
    return () => cancelAnimationFrame(raf)
  }, [te?.key])

  if (!te || !l || l.content.type !== 'text' || !view || te.docId !== active) return null
  const c = l.content
  const L = layoutText(c.text)
  const m = paramsToMatrix(c.params, L.w, L.h)
  // Screen = viewport (zoom about the view centre) ∘ layer placement.
  const z = view.zoom
  const ox = w / 2 - view.cx * z
  const oy = h / 2 - view.cy * z
  const extra = Math.max(8, c.text.size)
  const shiftX = c.text.align === 'left' ? 0 : c.text.align === 'center' ? -extra / 2 : -extra
  // CSS puts half the leading above each line; the canvas puts the baseline at the ascent.
  const descent = L.h - (L.lines.length - 1) * L.lineHeight - L.ascent
  const halfLeading = (L.lineHeight - (L.ascent + descent)) / 2
  const transform = `matrix(${m.a * z}, ${m.b * z}, ${m.c * z}, ${m.d * z}, ${m.e * z + ox}, ${m.f * z + oy}) translate(${shiftX}px, ${-halfLeading}px)`
  return (
    <textarea
      ref={ref}
      className="text-edit"
      spellCheck={false}
      value={c.text.text}
      style={{
        transform,
        width: L.w + extra,
        height: L.lines.length * L.lineHeight,
        font: fontString(c.text),
        letterSpacing: `${c.text.tracking}px`,
        lineHeight: `${L.lineHeight}px`,
        textAlign: c.text.align
      }}
      onChange={(e) => updateText(e.target.value)}
      onBlur={() => commitText()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelText()
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          commitText()
        }
      }}
      aria-label="Type layer text"
    />
  )
}
