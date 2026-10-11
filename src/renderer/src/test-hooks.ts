/**
 * Exposes the store and actions to Playwright scripts (CADENCE_PLUS_TEST=1 only).
 */
import * as D from './state/doc-actions'
import * as A from './state/image-actions'
import * as R from './state/recovery'
import * as TF from './state/transform-actions'
import * as VA from './state/vector-actions'
import { COMMANDS, run } from './state/commands'
import { get, set } from './state/store'
import { storeStats } from './engine/tiles'
import { renderComposite, renderDocument } from './engine/render'
import { poolCanvas } from './engine/tiles'

export function installTestHooks(): void {
  if (!window.cadencePlus.isTest) return
  ;(window as unknown as Record<string, unknown>).__cadencePlus = {
    get,
    set,
    run,
    D,
    A,
    R,
    TF,
    VA,
    COMMANDS,
    storeStats,
    /** Average ms per viewport-sized composite of the active document (GPU flushed). */
    bench(n = 20, withStroke = false): number {
      const s = get()
      const ds = s.docs.find((d) => d.id === s.activeId)
      if (!ds?.view) return -1
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(s.viewport.w * dpr)
      const H = Math.round(s.viewport.h * dpr)
      const v = ds.view
      const doc = ds.history.present
      const xf = { scale: v.zoom * dpr, ox: (s.viewport.w / 2 - v.cx * v.zoom) * dpr, oy: (s.viewport.h / 2 - v.cy * v.zoom) * dpr }
      const target = poolCanvas('bench', W, H)
      const stroke = withStroke ? { layerId: doc.activeLayerId!, canvas: poolCanvas('bench.stroke', doc.width, doc.height), opacity: 1, erase: false, rev: 0 } : null
      const t0 = performance.now()
      for (let i = 0; i < n; i++) {
        renderDocument(target, doc, { xf, width: W, height: H, stroke })
        target.getContext('2d')!.getImageData(0, 0, 1, 1)
      }
      return (performance.now() - t0) / n
    },
    /** Pixels in a rect of the composite darker than `t` (luminance). */
    darkCount(x: number, y: number, w: number, h: number, t = 128): number {
      const doc = get().docs.find((d) => d.id === get().activeId)?.history.present
      if (!doc) return -1
      const d = renderComposite(doc, 'test').getContext('2d')!.getImageData(x, y, w, h).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128 && 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < t) n++
      return n
    },
    /** RGBA of the flattened active document at (x, y). */
    pixel(x: number, y: number): number[] {
      const doc = get().docs.find((d) => d.id === get().activeId)?.history.present
      if (!doc) return []
      return Array.from(renderComposite(doc, 'test').getContext('2d')!.getImageData(x, y, 1, 1).data)
    }
  }
}
