# Cadence: Overview and Brief for a Sibling App

This document explains what Cadence is, how it is built, and which of its decisions carry over to a companion image editor (a Photoshop-style app). Use it as the starting brief for that project.

---

## 1. What Cadence is

Cadence is a professional non-linear video editor for **Windows desktop**, inspired by Adobe Premiere Pro but with its own name, look and interface. It is meant to be a tool you can actually use for real editing, not a mockup.

**Core workflow (working and verified):** import real footage → arrange it on a multitrack timeline → trim, split, ripple, roll, slip and slide → add titles, transitions, keyframes, speed changes and nested sequences → preview in real time with audio in sync → save and reopen the project → export a playable file (H.264, HEVC, AV1, ProRes or DNxHR).

**Product principles** (these should carry over to the image editor):

1. **No fake controls.** Every visible control works. Unfinished features are left out or clearly labelled "unavailable".
2. **Honest reporting.** Progress bars show real work, errors are specific, and the feature checklist separates what is verified, limited, planned and blocked.
3. **Sources are never modified.** Projects store editing decisions. Derived files (caches, converted copies) live in a separate cache folder.
4. **One authoritative model.** Preview, save and export all read the same data, so they cannot disagree.
5. **Verify with real media.** Every phase is checked by automated tests that run the real app on real files and measure the output, such as frame-number barcodes and A/V sync offsets.
6. **Phased delivery.** Make one workflow reliable before expanding.

**User and hardware:** Windows 11, NVIDIA RTX 5070 Ti (NVENC/NVDEC), Intel i7-14700F, 32 GB RAM. This is personal use, so a GPL FFmpeg build is acceptable. Licensing must be revisited before any distribution.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron 44** (Chromium + Node) | Desktop file access; GPU decode/composite through Chromium; fast UI development |
| UI | **React 19**, TypeScript | Dense, dockable professional UI |
| Docking | **dockview-react 8** (MIT) | Resizable/tabbed/floating panels; layouts serialise to JSON |
| State | **Zustand 5** + **Immer 11** | Small global store; Immer gives immutable snapshots for undo |
| Build | **electron-vite 5** on **Vite 7** | Separate builds for main, preload and renderer; workers and worklets bundle cleanly |
| GPU | **WebGL2** compositor | Layers, transforms, crop, opacity, render-to-texture |
| Video decode | **WebCodecs** + a custom MP4/MOV demuxer | Hardware decode with frame-exact seeking |
| Heavy media | **FFmpeg 9.0** (GPL, in `vendor/ffmpeg`, not committed) run as child processes | Probing, audio decode, thumbnails, format conversion, final encoding |
| Tests | **Vitest** (unit), **Playwright** driving Electron (end-to-end) | Real-app verification |

Note: `npm install` does not always fetch Electron's binary. If `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js`.

---

## 3. Architecture

Three processes:

- **Main process (Node):** windows, file dialogs, FFmpeg job queue, media cache, project file I/O, autosave, and export orchestration.
- **Editor renderer (Chromium):** the UI, playback and compositing.
- **Hidden export renderer:** a second window that renders frames with exactly the same code as the preview and streams raw RGBA pixels to FFmpeg over stdin.

```
src/core/       Pure TypeScript: no DOM, no Node. Fully unit-tested.
  model.ts        The project model: plain serialisable data
  edit.ts         Every edit operation as a function on the model
  history.ts      Undo/redo over immutable Immer snapshots
  evaluate.ts     "What is visible at frame N": the single evaluator
  mix.ts          Deterministic audio mixer (preview AND export)
  effects.ts      Effect/parameter definitions + keyframe evaluation
  serialize.ts    Versioned project format + migrations
src/main/       Electron main: ffmpeg.ts, jobs.ts, media.ts (cache),
                protocol.ts (cmedia:// with HTTP Range), project-io.ts,
                settings.ts, export.ts
src/preload/    The typed window.cadence API (contract: src/shared/ipc.ts)
src/renderer/src/
  engine/         Demuxer, GPU video reader, compositor, layer resolver,
                  playback controller, audio worklet + mixer worker
  state/          Zustand store, command registry/keymap, actions
  ui/             Panels, timeline, dialogs, theme, tokens, tooltips
```

### Key design decisions

- **Pure core.** Everything that defines the edit is plain data plus pure functions in `src/core`. The UI calls `edit(label, recipe)`. The recipe mutates an Immer draft, and history stores the resulting immutable snapshot. A failed edit (an `EditError`) leaves history untouched and becomes a friendly message.
- **Undo for free.** Snapshot-based history (up to 300 steps) means no per-command undo code. Rapid edits such as dragging a slider merge into one step through a `coalesce` key.
- **One evaluator, one compositor.** `videoLayersAt(project, seq, frame)` produces layers. `LayerResolver` turns them into pixels. `Compositor` draws them. The monitors and the exporter run this same path.
- **Integer time.** Timeline positions are integer frames, and source positions are seconds mapped to real frame timestamps. This makes variable-frame-rate footage correct.
- **Media protocol.** The `cmedia://local/<encoded path>` scheme serves local files with Range support, so renderers and workers read only the bytes they need.
- **Background jobs** run in a queue with lanes and cancellation (thumbnails, audio analysis, conversions, filmstrips). Results are cached by **content fingerprint** (size plus the first and last 256 KB), so moved or renamed files reuse their cache.
- **Project file:** versioned JSON (`.cadence`, format v1) with a migration hook, atomic writes with a `.bak` copy, autosave every 60 s and on blur, crash recovery on start, project-relative paths, and fingerprint-checked relinking.

---

## 4. Design system (reuse this for the image editor)

The look is **graphite and ice blue**. All colours are tokens in `src/renderer/src/ui/theme.css`. Canvas-drawn UI reads the same tokens through `src/renderer/src/ui/tokens.ts`.

| Token | Value | Use |
|---|---|---|
| `--c-app` | `#101114` | App background, gutters |
| `--c-panel` | `#191B20` | Panels |
| `--c-raised` | `#23262D` | Menus, buttons, raised surfaces |
| `--c-border` | `#30343D` | Borders, dividers |
| `--c-text` | `#E8ECF2` | Primary text |
| `--c-text-2` | `#929BAA` | Secondary text |
| `--c-accent` | `#69B7FF` | Active tools, selected tabs, focus, sliders, playhead |
| `--c-select` | `#203B55` | Selected rows/items, menu hover |
| `--c-monitor` | `#1F1F1F` | **Neutral grey around images**, so it doesn't bias colour judgement |

Derived tokens: `--c-inset`, `--c-panel-2`, `--c-raised-hover`, `--c-raised-press`, `--c-border-strong`, `--c-text-3`, `--c-text-disabled`, `--c-accent-hover`, `--c-accent-press`, `--c-accent-ink`, and the status colours `--c-danger`, `--c-warn`, `--c-ok`.

**Style rules:**
- Compact and precise: 12 px UI text, 24 px controls, radii of 3–5 px.
- Thin 1.25 px line icons, drawn for the app (`ui/icons.tsx`).
- Hover is a subtle brightness change. No glow, glass effects or decorative gradients.
- Every interactive element has hover, pressed, selected, disabled and keyboard-focus states (focus = 1 px ice-blue ring).
- Styled tooltips: `ui/Tooltip.tsx` converts any `title` attribute into a themed tooltip.
- **Gotcha:** the custom title bar is a window-drag region. Popups opened from it need `-webkit-app-region: no-drag`, or Windows swallows their hover and clicks.

**Brand:** the logo is a rounded square with three ice-blue bars of different lengths (stacked tracks). A sibling app should share the frame and palette but have its own mark.

---

## 5. Reusable building blocks for a Photoshop-style app

These parts transfer almost directly:

| Cadence piece | Reuse in the image editor |
|---|---|
| Electron shell, preload API, `cmedia://` protocol | Same. Large PSD/TIFF/RAW reads benefit from Range access |
| Theme tokens, icons, tooltips, `components.tsx` (ScrubNumber, Modal, context menu) | Same |
| Dockview workspace + saved layouts | Same panels concept (Layers, Properties, History, Swatches, Navigator) |
| Command registry + configurable keymap (`state/commands.ts`) | Same, with new commands (brush sizes, tools, layer ops) |
| `edit()` + Immer history + History panel | Works for layer/adjustment edits. Pixel painting needs **tile-based deltas** instead of whole-document snapshots (see below) |
| Versioned project format, autosave, recovery, relink | Same pattern for a `.cadence-image`-style document |
| WebGL2 compositor (layers, transforms, opacity, crop, render-to-texture, adjustment layers) | The starting point for a layer compositor. Extend with blend modes, masks and colour adjustments |
| FFmpeg job queue | Useful for import/export of odd formats and thumbnails; image libraries cover most needs |
| Playwright + real-file verification approach | Same: assert exported pixels against expected results |

### Differences an image editor must address

- **Pixel data and undo.** Video edits are lightweight data, so whole-project snapshots are cheap. Painting changes pixels, so store layer pixels as **GPU/CPU tiles** (for example 256×256) and record only the changed tiles per undo step.
- **Precision and colour.** Work at 16-bit or float per channel with an ICC-aware pipeline (sRGB, Display P3, Adobe RGB), plus soft-proofing. Cadence's video path is 8-bit Rec.709.
- **Brush engine.** Pressure-sensitive input (Pointer Events report pressure and tilt), stamp/spacing dynamics, and GPU accumulation into the active layer tile.
- **Selections and masks.** A selection is an 8-bit (or float) mask. Each layer can have a mask. Needed tools: marquee, lasso, magic wand, feathering, and quick mask.
- **Formats.** PNG/JPEG/WebP/AVIF in-browser; TIFF/PSD/RAW need libraries (for example `ag-psd` for PSD layers, LibRaw via WASM or a native addon for RAW). Check licences per library, as Cadence did with FFmpeg.
- **Large canvases.** Tile-based rendering with viewport culling and mip levels for zoomed-out views. Never upload a whole 100-megapixel image as a single texture.
- **Non-destructive editing.** Adjustment layers, smart filters and layer styles. Cadence's adjustment-layer pass (render what's below to a texture, then process it) is the right model.

---

## 6. Hard-won lessons from Cadence

- **Electron drag regions** swallow events in child popups. Mark popups `no-drag`.
- **Pointer capture retargets** `click`/`dblclick` to the capturing element. Use `document.elementFromPoint` to find what's under the cursor.
- **WebCodecs** requires a key frame after `configure()`/`flush()`. Guard asynchronous feeds with a token so a stale feed can't decode a delta frame.
- **Hidden windows pause** `requestAnimationFrame`. Run real-time tests with a visible window.
- **Heredoc quoting:** in this environment, write patch scripts to files rather than inline shell heredocs (triple quotes break them).
- **Colour checks:** compare exported pixels against the source numerically (mean error in flat areas versus at edges). The GPU YUV↔RGB round trip in Cadence costs about 0.5/255 in flat areas; the fix is planned for the colour phase.
- **Test isolation:** give each test its own settings folder, or saved workspace layouts make UI tests flaky.

---

## 7. Status and where to look

- Feature checklist: [`docs/FEATURES.md`](FEATURES.md)
- Architecture notes: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- Run: `npm install`, then `npm run dev`
- Verify: `npm test`, `npm run build`, `npm run e2e`, `node scripts/e2e-ui.mjs`, `node scripts/e2e-phase2.mjs`, `node scripts/e2e-ui-phase2.mjs`

**Done:** Phase 1 (core editing workflow) and Phase 2 (keyframes, transitions, speed/reverse, nesting, adjustment layers, filmstrips), plus the graphite/ice-blue redesign.

**Next for Cadence:**
- Phase 3: colour correction and scopes
- Phase 4: audio mixer and effects
- Phase 5: captions
- Phase 6: proxies, export queue, multicam, masks and keying

### Suggested first questions for the image-editor project

1. Should it be a separate app or share one repository with Cadence (a monorepo with shared `ui/` and `core/` packages)?
2. What working precision and colour management? 8-bit sRGB to start, or 16-bit/float with ICC from day one?
3. Which file formats matter first (PSD round-trip, camera RAW, layered TIFF)?
4. Does pen-tablet support matter (pressure and tilt)?
5. What is the first complete workflow to make reliable? For example: open photo → layers + adjustment layers → selection + mask → brush retouch → save project → export PNG/JPEG/TIFF.
