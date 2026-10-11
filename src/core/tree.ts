/**
 * Layer groups. The document keeps one flat, bottom→top list; a layer's
 * `parent` names its group. Siblings are ordered by their position in the
 * flat list, so code that only cares about order keeps working.
 */
import type { ImageDocument, Layer } from './model'

export const isGroup = (l: Layer | undefined): boolean => l?.content.type === 'group'

/** Children of `parentId` (null = top level), bottom → top. */
export function childrenOf(layers: readonly Layer[], parentId: string | null): Layer[] {
  const ids = new Set(layers.map((l) => l.id))
  return layers.filter((l) => (l.parent && ids.has(l.parent) ? l.parent : null) === parentId)
}

const treeCache = new WeakMap<readonly Layer[], Map<string | null, Layer[]>>()

/**
 * Parent id → children (bottom → top). Cached only for frozen (committed)
 * layer lists: drafts mutate their array in place, so caching them would go stale.
 */
export function tree(layers: readonly Layer[]): Map<string | null, Layer[]> {
  const frozen = Object.isFrozen(layers)
  let t = frozen ? treeCache.get(layers) : undefined
  if (t) return t
  t = new Map()
  const ids = new Set(layers.map((l) => l.id))
  for (const l of layers) {
    const p = l.parent && ids.has(l.parent) ? l.parent : null
    if (!t.has(p)) t.set(p, [])
    t.get(p)!.push(l)
  }
  if (frozen) treeCache.set(layers, t)
  return t
}

/** Every layer inside `id` (any depth). */
export function descendants(layers: readonly Layer[], id: string): Layer[] {
  const t = tree(layers)
  const out: Layer[] = []
  const walk = (pid: string) => {
    for (const c of t.get(pid) ?? []) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

/** Groups containing `l`, innermost first. */
export function ancestors(layers: readonly Layer[], l: Layer): Layer[] {
  const out: Layer[] = []
  let p = l.parent
  const seen = new Set<string>()
  while (p && !seen.has(p)) {
    seen.add(p)
    const g = layers.find((x) => x.id === p)
    if (!g) break
    out.push(g)
    p = g.parent
  }
  return out
}

/** Visible, counting hidden groups. */
export function effectivelyVisible(doc: ImageDocument, l: Layer): boolean {
  return l.visible && ancestors(doc.layers, l).every((g) => g.visible)
}

/** The locked layer or group that blocks editing `l`, if any. */
export function lockedBy(doc: ImageDocument, l: Layer): Layer | null {
  if (l.locked) return l
  return ancestors(doc.layers, l).find((g) => g.locked) ?? null
}

export function depthOf(layers: readonly Layer[], l: Layer): number {
  return ancestors(layers, l).length
}

/** Rows for the Layers panel: top → bottom, children under their group unless collapsed. */
export function displayRows(layers: readonly Layer[]): { layer: Layer; depth: number }[] {
  const t = tree(layers)
  const out: { layer: Layer; depth: number }[] = []
  const walk = (pid: string | null, depth: number) => {
    const kids = t.get(pid) ?? []
    for (let i = kids.length - 1; i >= 0; i--) {
      const l = kids[i]
      out.push({ layer: l, depth })
      if (l.content.type === 'group' && !l.content.collapsed) walk(l.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
