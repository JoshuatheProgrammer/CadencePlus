/**
 * Keeps the engine's pixel format in step with the active document, so all
 * canvases created while working on it use its bit depth and colour space.
 */
import { docColor } from '@core/model'
import { formatKey, setPipelineFormat } from '../engine/format'
import { useEditor } from './store'

export function startFormatSync(): () => void {
  const apply = () => {
    const s = useEditor.getState()
    const d = s.docs.find((x) => x.id === s.activeId)?.history.present
    const f = d ? docColor(d) : { depth: 8 as const, space: 'srgb' as const }
    if (formatKey(f) !== formatKey()) setPipelineFormat(f)
  }
  apply()
  return useEditor.subscribe(apply)
}
