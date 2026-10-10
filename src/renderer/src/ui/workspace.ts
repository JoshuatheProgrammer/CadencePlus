/**
 * The dockview workspace: panel registry, default layout, persistence.
 * Kept separate from App so commands can toggle panels without cycles.
 */
import type { DockviewApi } from 'dockview-react'
import type { PanelId } from '../state/store'

export const PANEL_TITLES: Record<PanelId, string> = {
  canvas: 'Documents',
  layers: 'Layers',
  properties: 'Properties',
  history: 'History',
  color: 'Color',
  swatches: 'Swatches',
  navigator: 'Navigator'
}

let api: DockviewApi | null = null

export function setDockApi(a: DockviewApi | null): void {
  api = a
}

export function dockApi(): DockviewApi | null {
  return api
}

export function defaultLayout(a: DockviewApi): void {
  a.clear()
  a.addPanel({ id: 'canvas', component: 'canvas', title: PANEL_TITLES.canvas })
  a.addPanel({ id: 'color', component: 'color', title: 'Color', position: { referencePanel: 'canvas', direction: 'right' } })
  a.addPanel({ id: 'swatches', component: 'swatches', title: 'Swatches', position: { referencePanel: 'color', direction: 'within' } })
  a.addPanel({ id: 'navigator', component: 'navigator', title: 'Navigator', position: { referencePanel: 'color', direction: 'within' } })
  a.addPanel({ id: 'properties', component: 'properties', title: 'Properties', position: { referencePanel: 'color', direction: 'below' } })
  a.addPanel({ id: 'history', component: 'history', title: 'History', position: { referencePanel: 'properties', direction: 'within' } })
  a.addPanel({ id: 'layers', component: 'layers', title: 'Layers', position: { referencePanel: 'properties', direction: 'below' } })
  a.getPanel('color')?.api.setActive()
  a.getPanel('properties')?.api.setActive()
  a.getPanel('layers')?.api.setActive()
  try {
    a.getPanel('color')?.group.api.setSize({ width: 312 })
    a.getPanel('color')?.group.api.setSize({ height: 300 })
    a.getPanel('properties')?.group.api.setSize({ height: 250 })
  } catch {
    /* sizing is best-effort */
  }
  // The document area has no tab strip of its own: it shows document tabs instead.
  const g = a.getPanel('canvas')?.group
  if (g) g.header.hidden = true
}

export function resetWorkspace(): void {
  if (api) defaultLayout(api)
}

export function togglePanel(id: PanelId): void {
  if (!api) return
  const p = api.getPanel(id)
  if (p) {
    if (id === 'canvas') return
    if (p.api.isActive || p.group.panels.length === 1) api.removePanel(p)
    else p.api.setActive()
    return
  }
  api.addPanel({ id, component: id, title: PANEL_TITLES[id], floating: { width: 320, height: 380 } })
}

export function isPanelOpen(id: PanelId): boolean {
  return !!api?.getPanel(id)
}
