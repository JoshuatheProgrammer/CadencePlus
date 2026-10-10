import { useEffect, useState } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react'
import { formatZoom } from '@core/view'
import { storeStats } from '../engine/tiles'
import { command, handleKeydown, keysFor, run } from '../state/commands'
import { confirmQuit, displayName, formatBytes, newDocument, openDialog, openPaths, setZoom, titleFor } from '../state/doc-actions'
import * as A from '../state/image-actions'
import { activeDocState, get, isDirty, set, useEditor, type PanelId } from '../state/store'
import { TOOLS } from '../state/tools'
import { CanvasPanel } from './canvas/CanvasPanel'
import { ContextMenuHost } from './components'
import { Dialogs, PRESETS } from './dialogs/Dialogs'
import { IconDefaultColors, IconImage, IconNewDoc, IconSwap, Logo, Wordmark } from './icons'
import { OptionsBar } from './OptionsBar'
import { ColorPanel, SwatchesPanel } from './panels/ColorPanel'
import { HistoryPanel } from './panels/HistoryPanel'
import { LayersPanel } from './panels/LayersPanel'
import { NavigatorPanel } from './panels/NavigatorPanel'
import { PropertiesPanel } from './panels/PropertiesPanel'
import { offerRecovery, startAutosave } from '../state/recovery'
import { installTestHooks } from '../test-hooks'
import { TooltipHost } from './Tooltip'
import { defaultLayout, isPanelOpen, PANEL_TITLES, resetWorkspace, setDockApi, togglePanel } from './workspace'

const theme: DockviewTheme = { name: 'cadence', className: 'dockview-theme-cadence', colorScheme: 'dark', gap: 3 }

const PANELS: Record<PanelId, React.FunctionComponent<IDockviewPanelProps>> = {
  canvas: () => <CanvasPanel />,
  layers: () => <LayersPanel />,
  properties: () => <PropertiesPanel />,
  history: () => <HistoryPanel />,
  color: () => <ColorPanel />,
  swatches: () => <SwatchesPanel />,
  navigator: () => <NavigatorPanel />
}

const LAYOUT_KEY = 'workspace.v1'

function hideCanvasHeader(a: DockviewApi): void {
  const g = a.getPanel('canvas')?.group
  if (g) g.header.hidden = true
}

function Workspace() {
  const onReady = (e: DockviewReadyEvent) => {
    setDockApi(e.api)
    void window.cadencePlus.getSettings().then((s) => {
      let ok = false
      const saved = s[LAYOUT_KEY]
      if (saved) {
        try {
          e.api.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0])
          ok = !!e.api.getPanel('canvas')
        } catch {
          ok = false
        }
      }
      if (!ok) defaultLayout(e.api)
      hideCanvasHeader(e.api)
    })
    let t = 0
    e.api.onDidLayoutChange(() => {
      clearTimeout(t)
      t = window.setTimeout(() => void window.cadencePlus.setSetting(LAYOUT_KEY, e.api.toJSON()), 600)
    })
  }
  return (
    <div className="workspace">
      <DockviewReact components={PANELS} onReady={onReady} theme={theme} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

type MenuEntry =
  | { cmd: string; label?: string; checked?: boolean }
  | { label: string; action: () => void; disabled?: boolean; checked?: boolean; kbd?: string }
  | { sep: true }
  | { label: string; submenu: () => MenuEntry[] }

function menus(): Record<string, MenuEntry[]> {
  const s = get()
  const h = activeDocState(s)?.history
  return {
    File: [
      { cmd: 'file.new' },
      { cmd: 'file.open' },
      {
        label: 'Open Recent',
        submenu: () =>
          s.recent.length
            ? [...s.recent.map((p) => ({ label: p, action: () => void openPaths([p]) })), { sep: true as const }, { label: 'Clear Recent', action: () => (set({ recent: [] }), void window.cadencePlus.setSetting('recentFiles', [])) }]
            : [{ label: 'No recent files', action: () => {}, disabled: true }]
      },
      { sep: true },
      { cmd: 'file.close' },
      { cmd: 'file.closeAll' },
      { sep: true },
      { cmd: 'file.save' },
      { cmd: 'file.saveAs' },
      { cmd: 'file.export' },
      { sep: true },
      { label: 'Exit', action: () => window.close() }
    ],
    Edit: [
      { cmd: 'edit.undo', label: h?.past.length ? `Undo ${h.presentLabel}` : 'Undo' },
      { cmd: 'edit.redo', label: h?.future.length ? `Redo ${h.future[0].label}` : 'Redo' },
      { sep: true },
      { cmd: 'edit.cut' },
      { cmd: 'edit.copy' },
      { cmd: 'edit.copyMerged' },
      { cmd: 'edit.paste' },
      { cmd: 'edit.clear' },
      { sep: true },
      { cmd: 'edit.fillFg' },
      { cmd: 'edit.fillBg' },
      { sep: true },
      { cmd: 'help.shortcuts', label: 'Keyboard Shortcuts…' }
    ],
    Image: [
      {
        label: 'Adjustments',
        submenu: () => [
          { cmd: 'image.brightnessContrast' },
          { cmd: 'image.hueSaturation' },
          { cmd: 'image.blackWhite' },
          { cmd: 'image.sepia' },
          { sep: true },
          { cmd: 'image.invert' },
          { cmd: 'image.desaturate' }
        ]
      },
      { sep: true },
      { cmd: 'image.imageSize' },
      { cmd: 'image.canvasSize' },
      {
        label: 'Image Rotation',
        submenu: () => [{ cmd: 'image.rotate180' }, { cmd: 'image.rotateCw' }, { cmd: 'image.rotateCcw' }, { sep: true }, { cmd: 'image.flipH' }, { cmd: 'image.flipV' }]
      },
      { cmd: 'image.crop' }
    ],
    Layer: [
      { cmd: 'layer.new' },
      { cmd: 'layer.newFill' },
      {
        label: 'New Adjustment Layer',
        submenu: () => [{ cmd: 'layer.adj.brightnessContrast' }, { cmd: 'layer.adj.hueSaturation' }, { cmd: 'layer.adj.blackWhite' }, { cmd: 'layer.adj.sepia' }, { cmd: 'layer.adj.invert' }]
      },
      { cmd: 'layer.duplicate' },
      { cmd: 'layer.delete' },
      {
        label: 'Layer Mask',
        submenu: () => [
          { cmd: 'layer.mask.revealAll' },
          { cmd: 'layer.mask.hideAll' },
          { cmd: 'layer.mask.revealSelection' },
          { cmd: 'layer.mask.hideSelection' },
          { sep: true },
          { cmd: 'layer.mask.toggle' },
          { cmd: 'layer.mask.target' },
          { cmd: 'layer.mask.apply' },
          { cmd: 'layer.mask.delete' }
        ]
      },
      { sep: true },
      { cmd: 'layer.viaCopy' },
      { cmd: 'layer.viaCut' },
      { sep: true },
      { cmd: 'layer.rasterize' },
      { label: 'Arrange', submenu: () => [{ cmd: 'layer.forward' }, { cmd: 'layer.backward' }] },
      { sep: true },
      { cmd: 'layer.mergeDown' },
      { cmd: 'layer.mergeVisible' },
      { cmd: 'layer.flatten' }
    ],
    Select: [{ cmd: 'select.all' }, { cmd: 'select.deselect' }, { cmd: 'select.inverse' }, { sep: true }, { cmd: 'select.feather' }],
    Filter: [{ label: 'Blur', submenu: () => [{ cmd: 'filter.blur' }] }],
    View: [
      { cmd: 'view.zoomIn' },
      { cmd: 'view.zoomOut' },
      { cmd: 'view.fit' },
      { cmd: 'view.fill' },
      { cmd: 'view.actual' },
      { sep: true },
      { cmd: 'view.rulers', checked: s.showRulers },
      { cmd: 'view.pixelGrid', checked: s.showPixelGrid }
    ],
    Window: [
      ...(['layers', 'properties', 'history', 'color', 'swatches', 'navigator'] as PanelId[]).map((id) => ({ label: PANEL_TITLES[id], action: () => togglePanel(id), checked: isPanelOpen(id) })),
      { sep: true },
      { label: 'Reset Workspace', action: resetWorkspace }
    ],
    Help: [{ cmd: 'help.shortcuts', label: 'Keyboard Shortcuts…' }, { cmd: 'help.about' }]
  }
}

function MenuList({ entries, x, y, onClose }: { entries: MenuEntry[]; x: number; y: number; onClose: () => void }) {
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null)
  return (
    <div className="menu-pop" style={{ left: x, top: y }} role="menu">
      {entries.map((e, i) => {
        if ('sep' in e) return <div key={i} className="menu-sep" />
        if ('submenu' in e) {
          return (
            <div
              key={i}
              className="menu-item"
              role="menuitem"
              onMouseEnter={(ev) => {
                const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                setSub({ i, x: r.right - 2, y: r.top - 4 })
              }}
            >
              <span className="check" />
              <span className="label">{e.label}</span>
              <span className="kbd">▸</span>
              {sub?.i === i && <MenuList entries={e.submenu()} x={sub.x} y={sub.y} onClose={onClose} />}
            </div>
          )
        }
        if ('cmd' in e) {
          const c = command(e.cmd)!
          const enabled = c.enabled?.() ?? true
          return (
            <div
              key={i}
              role="menuitem"
              aria-disabled={!enabled}
              className={`menu-item${enabled ? '' : ' disabled'}`}
              onMouseEnter={() => setSub(null)}
              onClick={() => {
                if (!enabled) return
                onClose()
                c.run()
              }}
            >
              <span className="check">{e.checked ? '✓' : ''}</span>
              <span className="label">{e.label ?? c.label}</span>
              <span className="kbd">{keysFor(c.id)[0] ?? ''}</span>
            </div>
          )
        }
        return (
          <div
            key={i}
            role="menuitem"
            className={`menu-item${e.disabled ? ' disabled' : ''}`}
            onMouseEnter={() => setSub(null)}
            onClick={() => {
              if (e.disabled) return
              onClose()
              e.action()
            }}
          >
            <span className="check">{e.checked ? '✓' : ''}</span>
            <span className="label">{e.label}</span>
            <span className="kbd">{e.kbd ?? ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function TitleBar() {
  const [open, setOpen] = useState<{ name: string; x: number; y: number } | null>(null)
  const title = useEditor((s) => titleFor(activeDocState(s)))
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu-pop, .menu-btn')) setOpen(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  const names = Object.keys(menus())
  return (
    <div className="titlebar">
      <div className="brand">
        <Logo size={18} />
        <Wordmark />
      </div>
      <div className="menus" role="menubar">
        {names.map((n) => (
          <button
            key={n}
            className={`menu-btn${open?.name === n ? ' open' : ''}`}
            onMouseDown={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setOpen(open?.name === n ? null : { name: n, x: r.left, y: r.bottom + 2 })
            }}
            onMouseEnter={(e) => {
              if (open && open.name !== n) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setOpen({ name: n, x: r.left, y: r.bottom + 2 })
              }
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="center">{title}</div>
      {open && <MenuList entries={menus()[open.name]} x={open.x} y={open.y} onClose={() => setOpen(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool rail
// ---------------------------------------------------------------------------

function ToolRail() {
  const tool = useEditor((s) => s.tool)
  const fg = useEditor((s) => s.fg)
  const bg = useEditor((s) => s.bg)
  const target = useEditor((s) => s.colorTarget)
  return (
    <div className="toolrail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <div className="grip" />
      {TOOLS.map((t, i) =>
        t ? (
          <button
            key={t.id}
            className={`tool-btn${tool === t.id ? ' active' : ''}`}
            disabled={!!t.unavailable}
            aria-pressed={tool === t.id}
            title={t.unavailable ? `${t.label} (${t.key}) — unavailable\n${t.unavailable}` : `${t.label} (${t.key})`}
            onClick={() => run(`tool.${t.id}`)}
          >
            <t.icon size={17} />
          </button>
        ) : (
          <div key={`sep${i}`} className="rail-sep" />
        )
      )}
      <div className="color-chips">
        <button className={`color-chip bg${target === 'bg' ? ' editing' : ''}`} style={{ background: bg }} title="Background colour — click to edit in the Color panel" onClick={() => set({ colorTarget: 'bg' })} />
        <button className={`color-chip fg${target === 'fg' ? ' editing' : ''}`} style={{ background: fg }} title="Foreground colour — click to edit in the Color panel" onClick={() => set({ colorTarget: 'fg' })} />
      </div>
      <div className="chip-mini">
        <button title="Default colours (D)" onClick={A.defaultColors}>
          <IconDefaultColors size={11} />
        </button>
        <button title="Swap colours (X)" onClick={A.swapColors}>
          <IconSwap size={11} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function ZoomField() {
  const zoom = useEditor((s) => activeDocState(s)?.view?.zoom ?? null)
  const [text, setText] = useState<string | null>(null)
  if (zoom === null) return null
  return (
    <input
      className="zoom-field"
      aria-label="Zoom"
      value={text ?? formatZoom(zoom)}
      onFocus={(e) => (setText(formatZoom(zoom)), requestAnimationFrame(() => e.target.select()))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseFloat(text ?? '')
        if (Number.isFinite(v) && v > 0) setZoom(v / 100)
        setText(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(null)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

function StatusBar() {
  const ds = useEditor((s) => activeDocState(s))
  const cursor = useEditor((s) => s.cursor)
  const busy = useEditor((s) => s.busy)
  const [mem, setMem] = useState('')
  useEffect(() => {
    const t = setInterval(() => {
      const st = storeStats()
      setMem(`${formatBytes(st.bytes)} in ${st.tiles} tiles`)
    }, 2000)
    return () => clearInterval(t)
  }, [])
  const doc = ds?.history.present
  const inside = doc && cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < doc.width && cursor.y < doc.height
  return (
    <div className="statusbar">
      {doc && (
        <>
          <ZoomField />
          <span>
            <span className="val">
              {doc.width} × {doc.height}
            </span>{' '}
            px · RGB/8 · sRGB
          </span>
          <span>
            X/Y{' '}
            <span className="val">{inside ? `${Math.floor(cursor!.x)}, ${Math.floor(cursor!.y)}` : '—'}</span>
          </span>
        </>
      )}
      <span className="grow" />
      {mem && <span title="Pixel memory held for open documents and their undo history">{mem}</span>}
      <span>{busy ?? 'Ready'}</span>
    </div>
  )
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function Home() {
  const recent = useEditor((s) => s.recent)
  const [drop, setDrop] = useState(false)
  return (
    <div
      className={`home${drop ? ' drop' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDrop(true)
        }
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrop(false)
        const paths = [...e.dataTransfer.files].map((f) => window.cadencePlus.pathForFile(f)).filter(Boolean)
        if (paths.length) void openPaths(paths)
      }}
    >
      <div className="home-inner">
        <div>
          <Logo size={56} />
          <h1>
            <Wordmark />
          </h1>
          <div className="sub">Image editor</div>
          <div className="actions">
            <button className="btn primary" onClick={() => run('file.new')}>
              New…
            </button>
            <button className="btn" onClick={() => void openDialog()}>
              Open…
            </button>
            <button className="btn" onClick={() => void A.paste()} title="Create a document from the image on the clipboard">
              New from Clipboard
            </button>
          </div>
          <p className="note" style={{ marginTop: 18, lineHeight: 1.6 }}>
            Opens PNG, JPEG, WebP, AVIF, GIF, BMP and Cadence+ documents. Drop files here to open them.
          </p>
        </div>
        <div>
          <div className="block">
            <h3>Start a new document</h3>
            <div className="home-presets">
              {PRESETS.slice(0, 8).map((p) => {
                const s = 58 / Math.max(p.w, p.h)
                return (
                  <button key={p.name} className="home-preset" onClick={() => newDocument({ name: `${p.name}`, width: p.w, height: p.h, resolution: p.ppi, background: 'white' })}>
                    <div className="frame">
                      <div style={{ width: Math.round(p.w * s), height: Math.round(p.h * s) }} />
                    </div>
                    <span className="n">{p.name}</span>
                    <span className="d">
                      {p.w} × {p.h} · {p.ppi} ppi
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="block">
            <h3>Recent</h3>
            {recent.length === 0 ? (
              <div className="note">Files you open or save appear here.</div>
            ) : (
              <div className="recent-list">
                {recent.map((p) => (
                  <div key={p} className="recent-item" onClick={() => void openPaths([p])} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && void openPaths([p])}>
                    {/\.cadenceimg$/i.test(p) ? <IconNewDoc /> : <IconImage />}
                    <div className="t">
                      <div>{p.replace(/^.*[\\/]/, '')}</div>
                      <div className="p">{p}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function App() {
  const hasDocs = useEditor((s) => s.docs.length > 0)
  useEffect(() => {
    void window.cadencePlus.getSettings().then((s) => {
      set({
        recent: (s.recentFiles as string[]) ?? [],
        ...(Array.isArray(s.swatches) ? { swatches: s.swatches as string[] } : {})
      })
    })
    const stopAutosave = startAutosave()
    void offerRecovery()
    const onKey = (e: KeyboardEvent) => void handleKeydown(e)
    window.addEventListener('keydown', onKey)
    const offClose = window.cadencePlus.onCloseRequested(async () => {
      if (await confirmQuit()) window.cadencePlus.confirmClose()
    })
    const offOpen = window.cadencePlus.onOpenPaths((paths) => void openPaths(paths))
    // Native title and the unsaved-changes flag follow the store.
    let lastTitle = ''
    let lastDirty = false
    const unsub = useEditor.subscribe((s) => {
      const ds = activeDocState(s)
      const t = ds ? `${displayName(ds)}${isDirty(ds) ? ' •' : ''} — Cadence+` : 'Cadence+'
      if (t !== lastTitle) window.cadencePlus.setTitle((lastTitle = t))
      const dirty = s.docs.some(isDirty)
      if (dirty !== lastDirty) window.cadencePlus.setDirty((lastDirty = dirty))
    })
    // Prevent Chromium from navigating to files dropped outside a drop target.
    const stop = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    installTestHooks()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
      offClose()
      offOpen()
      unsub()
      stopAutosave()
    }
  }, [])
  return (
    <div className="app">
      <TitleBar />
      {hasDocs && <OptionsBar />}
      <div className="app-main">
        <ToolRail />
        <Workspace />
        {!hasDocs && <Home />}
      </div>
      <StatusBar />
      <Toasts />
      <Dialogs />
      <ContextMenuHost />
      <TooltipHost />
    </div>
  )
}

