# Cadence+ Architecture

Cadence+ is an Electron image editor for Windows, built on the same stack and principles as Cadence (see `CADENCE_OVERVIEW.md`).

## Processes

- **Main** (`src/main`): window, file dialogs, atomic file writes (`.tmp` + rename, `.bak`), clipboard, settings, single-instance file opening, unsaved-changes close handshake. Electron's default menu is removed so its accelerators can't reload the page.
- **Preload** (`src/preload`): the typed `window.cadencePlus` API (contract: `src/shared/ipc.ts`).
- **Renderer** (`src/renderer/src`): UI, compositing, all pixel work.

## Layers of the code

```
packages/ui/         @cadence/ui — the design system shared with Cadence (see docs/MONOREPO.md)
  base.css             Tokens, global rules, form controls, focus ring, scrollbars, docking,
                       menus, tooltips, buttons, scrub numbers, toasts
  components.tsx       Context menu, ScrubNumber, SliderField, NumberInput, Modal
  Tooltip.tsx, tokens.ts  Styled tooltips; CSS tokens for canvas drawing
packages/core/       @cadence/core — framework-free logic shared with Cadence
  history.ts           Snapshot undo/redo (generic) with coalescing and a step limit
  color.ts             Hex / RGB / HSV
src/core/            Pure TypeScript, no DOM. Unit-tested (tests/core.test.ts).
  model.ts             Document, layers, tile maps (pixels referenced by id)
  edit.ts              Every edit as a function on an Immer draft; EditError
  selection.ts         Selections as data: ordered add/subtract/intersect/invert/feather steps
  adjustments.ts       Adjustment definitions → filter strings
  flood.ts             Magic wand / bucket colour masks
  view.ts              Zoom steps, fit/fill, screen ↔ document maths
  icc.ts, png.ts       ICC profile parsing and conversion; own PNG decoder (16-bit)
  format.ts            The .cadenceimg container
  filters.ts           Shader filter ops as plain data
  color-range.ts       Select → Color Range selection functions
  effects.ts           Layer style data, defaults, offsets
  export-presets.ts    Export presets: sizes, file names, clash detection
src/renderer/src/engine/
  tiles.ts             Immutable tile store (ImageBitmap), slicing, GC
  render.ts            The compositor (viewport, thumbnails, navigator, export)
  mips.ts              Per-layer mip levels for zoomed-out views
  pixels.ts            applyToLayer (paint/erase/replace in a selection), merge, filters, transforms, sampling
  brush.ts             Round brush engine with stroke buffer
  selection.ts         Selection → mask, bounds, marching-ants edges
  io.ts                Decode, .cadenceimg save/load, export
  formats.ts           PSD (ag-psd), TIFF (UTIF + own writer), camera RAW (libraw-wasm)
  shaders.ts           GPU filters (WebGL2): Unsharp Mask, High Pass, Add Noise, Motion Blur, Dodge/Burn/Sponge
  retouch.ts           Retouching brushes (processed copy painted through coverage), Smudge, History Brush source
  effects.ts           Layer styles drawn by the compositor (shadow/glow beneath; overlay, inner glow, stroke on top)
src/renderer/src/state/  Zustand store, edit()/history actions, commands + keymap, tools
src/renderer/src/ui/     App frame, canvas (viewport, rulers, overlay, tool handlers), panels, dialogs;
                         theme.css holds only image-editor surfaces on top of @cadence/ui/base.css
```

## Key decisions

- **Pixels are immutable tiles.** A raster layer is a map of `"tx,ty" → tile id`. Any pixel edit draws only the touched 256×256 tiles into new bitmaps and swaps their ids in a single `edit()`. The undo history therefore stays plain Immer snapshots (Cadence's model). Each step costs only the changed tiles, and a white background is one shared tile. A garbage collector frees tiles no history step references.
- **One compositor.** `renderDocument()` draws any document through a scale and offset. The viewport, layer thumbnails, the navigator, the eyedropper/wand sampling and export all use it, so the screen and the exported file agree. Blend modes and adjustment layers composite on a transparent target, never against the checkerboard.
- **Culling and mips.** At ≥ 50% zoom only visible tiles are drawn. Below that, each layer draws one cached mip at 1/2^L, patched per tile when the layer changes. Tile edges are snapped to whole pixels so scaled tiles never seam.
- **Selections are data.** Steps rasterize to a document-sized mask on demand (cached per selection object). Painting, filling, filters and copy all clip through `applyToLayer`, which mixes `old × (1 − mask) + new × mask` exactly.
- **Brush.** Dabs accumulate at *flow* into a stroke buffer, which is previewed live through the compositor and committed at *opacity*, so one stroke never exceeds its opacity.
- **Adjustments** map onto Canvas filter functions, evaluated on the GPU in 8-bit sRGB. They serve both adjustment layers and destructive Image → Adjustments, and the dialogs preview live without touching pixels.
- **File format.** `.cadenceimg` holds the magic, a JSON header (versioned document model plus a blob table) and PNG-encoded tiles and masks. Newer versions are refused; `migrate()` is the upgrade hook.

## Testing

- `npm test`: core unit tests (history, edits, selections, view maths, colour, flood fill, file format).
- `npm run build && npm run e2e`: 32 checks that drive the real app with mouse and keyboard and measure composite pixels. They cover painting, undo, eraser, opacity caps, blend modes, merges, wand, bucket, gradient, adjustments, blur, crop, transforms, copy/paste, move, eyedropper, lasso, the Layers panel, shortcuts, save/reopen, export, tile GC, and the absence of renderer errors.
- `npm run perf`: compositor frame times at 1920×1200, 6000×4000 and 12000×8000.
- `npm run shot`: screenshots of the main states into `test-output/`.
