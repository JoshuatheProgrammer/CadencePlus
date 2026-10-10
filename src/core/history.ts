/**
 * Undo/redo over immutable Immer snapshots (same model as Cadence).
 * Rapid edits that share a `coalesce` key (e.g. scrubbing an opacity value)
 * merge into one step.
 */
import { produce, type Draft } from 'immer'

export const MAX_HISTORY = 300

export interface Step<T> {
  label: string
  state: T
}

export interface History<T> {
  past: Step<T>[]
  present: T
  presentLabel: string
  future: Step<T>[]
  /** Bumps on every change, including undo/redo. */
  revision: number
  coalesceKey: string | null
  /** Maximum undo steps kept. */
  limit: number
}

export function createHistory<T>(initial: T, label = 'Open', limit = MAX_HISTORY): History<T> {
  return { past: [], present: initial, presentLabel: label, future: [], revision: 0, coalesceKey: null, limit }
}

/**
 * Applies `recipe` and records a step. Errors thrown by the recipe propagate
 * and the history is returned unchanged by the caller.
 */
export function apply<T>(h: History<T>, label: string, recipe: (draft: Draft<T>) => void, coalesce?: string): History<T> {
  const next = produce(h.present, recipe)
  if (next === h.present) return h
  if (coalesce && h.coalesceKey === coalesce) {
    return { ...h, present: next, revision: h.revision + 1, future: [] }
  }
  const past = [...h.past, { label: h.presentLabel, state: h.present }]
  if (past.length > h.limit) past.splice(0, past.length - h.limit)
  return { past, present: next, presentLabel: label, future: [], revision: h.revision + 1, coalesceKey: coalesce ?? null, limit: h.limit }
}

/** Changes the present state without creating an undo step (e.g. layer selection). */
export function replace<T>(h: History<T>, recipe: (draft: Draft<T>) => void): History<T> {
  const next = produce(h.present, recipe)
  return next === h.present ? h : { ...h, present: next, revision: h.revision + 1, coalesceKey: null }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (!prev) return h
  return {
    past: h.past.slice(0, -1),
    present: prev.state,
    presentLabel: prev.label,
    future: [{ label: h.presentLabel, state: h.present }, ...h.future],
    revision: h.revision + 1,
    coalesceKey: null,
    limit: h.limit
  }
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0]
  if (!next) return h
  return {
    past: [...h.past, { label: h.presentLabel, state: h.present }],
    present: next.state,
    presentLabel: next.label,
    future: h.future.slice(1),
    revision: h.revision + 1,
    coalesceKey: null,
    limit: h.limit
  }
}

/** Jumps to a step: index into [...past, present]. */
export function jumpTo<T>(h: History<T>, index: number): History<T> {
  let out = h
  while (out.past.length > index) out = undo(out)
  while (out.past.length < index && out.future.length) out = redo(out)
  return out
}
