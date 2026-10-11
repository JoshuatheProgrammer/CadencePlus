# Cadence+ — Feature Checklist

Status legend:

- ✅ **Verified**: implemented and checked by automated tests that drive the real app and measure the output pixels (`npm test`, `npm run e2e`).
- 🟡 **Limited**: implemented, with the limitation noted.
- 📋 **Planned**: not in the interface yet, or shown disabled with an explanation.

Last verified: 2026-10-10 on Windows 11, Electron 44.7.
Suites: 49 unit (`npm test`) · 61 end-to-end (`npm run e2e`), all passing.

## Phase 1: core image-editing workflow

### Workspace and UI
| Feature | Status | Notes |
|---|---|---|
| Graphite & ice-blue theme shared with Cadence | ✅ | Same tokens, plus hue-free canvas tokens (pasteboard, checkerboard, pixel grid, rulers). See `docs/DESIGN.md`. |
| Custom title bar, menus, options bar, tool rail, status bar | ✅ | Menus are excluded from the window drag region. Electron's default menu is removed so Ctrl+R / Ctrl+Shift+I reach the app (tested). |
| Dockable panels: Layers, Properties, History, Color, Swatches, Navigator | ✅ | dockview. Layout persists; Window → Reset Workspace. |
| Multiple documents as tabs | ✅ | Ctrl+Tab cycles; middle-click closes. |
| Home screen with presets and recent files | ✅ | |
| Keyboard shortcuts (Photoshop-style), rebindable | ✅ | Help → Keyboard Shortcuts (Ctrl+/): search, record new keys, remove, reset one or all. A key already in use moves to the new command and the dialog names the previous owner. Saved in settings; menus and tooltips follow. |
| Styled tooltips, toasts, focus states | ✅ | |
| Unavailable tools shown disabled with a reason | ✅ | (Every tool in the rail now works.) |

### Documents and files
| Feature | Status | Notes |
|---|---|---|
| New document (presets, size, resolution, background) | ✅ | Max 16,384 px per side (Chromium canvas limit). |
| Open PNG, JPEG, WebP, AVIF, GIF, BMP | ✅ | Dialog, drag-and-drop, recent files, command line. GIF opens the first frame. |
| PSD, TIFF, camera RAW | 📋 | Needs libraries (e.g. ag-psd, LibRaw); licences to check. |
| `.cadenceimg` document format | ✅ | Versioned header + PNG tiles. Save/reopen is pixel-identical with layers, blend modes, opacity, fill and adjustment layers, and the selection. Atomic writes with a `.bak`. Newer formats are refused with a clear message. |
| Export PNG / JPEG / WebP | ✅ | PNG export matches the composite exactly. JPEG gets a white matte. Size estimate shown before export. |
| Unsaved-changes prompt (close document, close window) | 🟡 | Implemented. The window-close path is not covered by an automated test. |
| Autosave and crash recovery | ✅ | Every 60 s and on window blur, unsaved documents are copied to the recovery folder (never over your file). Copies are removed on save, close or discard; leftovers are offered at start-up and reopen as unsaved. Tested by killing the process tree and relaunching. |
| Colour management (ICC, Display P3, soft-proofing), 16-bit/float | 📋 | Pixels are 8-bit and treated as sRGB; the Properties panel says so. |

### Viewing
| Feature | Status | Notes |
|---|---|---|
| Zoom 1%–6400% (steps, Ctrl+wheel at pointer, Fit, Fill, 100%, zoom field) | ✅ | |
| Pan (Hand tool, Space+drag, middle-drag, wheel, Navigator) | ✅ | |
| Rulers with cursor tracking | ✅ | Ctrl+R toggles. |
| Pixel grid at ≥ 800% | ✅ | View → Pixel Grid. |
| Transparency checkerboard and neutral pasteboard | ✅ | |
| Tile rendering with viewport culling and mip levels | ✅ | Measured frame times, 5 layers including an adjustment layer: 1920×1200 1.4 ms, 6000×4000 0.4 ms, 12000×8000 0.3 ms at fit. Painting at 100%: about 1.1–1.3 ms. The first zoomed-out frame of a huge document builds mips once (about 1 s at 12000×8000). |

### Layers
| Feature | Status | Notes |
|---|---|---|
| Pixel layers stored as immutable 256 px tiles | ✅ | Undo stores only the changed tiles; closing documents frees their tiles (tested). |
| New, duplicate, delete, rename, reorder (drag in panel, Ctrl+[ / ]) | ✅ | |
| Visibility, lock, opacity | ✅ | Locked layers refuse edits with a message. |
| 16 blend modes | ✅ | Normal through Luminosity. Multiply verified numerically. |
| Fill layers | ✅ | Editable colour; can be rasterized. |
| Adjustment layers: Brightness/Contrast, Levels, Curves, Hue/Saturation, Black & White, Invert, Sepia | ✅ | Non-destructive; verified on/off. Settings edited live in the Properties panel. |
| Merge Down, Merge Visible, Flatten | ✅ | Composite preserved (tested). Like Photoshop, Merge Down bakes the upper layer's blend mode against the lower layer only. Flatten fills transparency with white and drops hidden layers. |
| New Layer via Copy / Cut (Ctrl+J / Ctrl+Shift+J) | ✅ | |
| Ctrl+click thumbnail to select layer pixels | ✅ | |
| Layer masks | ✅ | On any layer type, including adjustment layers. Reveal/Hide All, Reveal/Hide Selection. Paint with black/grey/white (grey half-hides, measured), gradient, fill, blur, invert (Ctrl+I). Disable (Shift+click), view (Alt+click), load as selection (Ctrl+click), Ctrl+\ switches mask/pixels, Apply, Delete. The mask moves with its layer and survives save, merge, crop and transforms. The Paint Bucket and colour adjustments refuse masks with an explanation. |
| Layer groups | ✅ | Ctrl+G groups the active layer, Ctrl+Shift+G ungroups, New Group, nesting, collapse/expand, drag layers into and out of groups. Pass Through (default) lets children blend with what is below; any other mode isolates the group (verified with Multiply). Group opacity and masks apply to the whole group; hiding or locking a group covers its children. Move tool and arrow keys move the whole group; Ctrl+E merges it; duplicate/delete include the contents; saved in documents. A Pass Through group below 100% opacity (or with a mask) is composited in isolation. Free Transform of a whole group is not supported yet. |
| Layer styles (drop shadow, stroke…), smart objects, multi-layer selection | 📋 | |

### Selections
| Feature | Status | Notes |
|---|---|---|
| Rectangular and elliptical marquee | ✅ | Shift = square, Alt = from centre. |
| Lasso (freehand) | ✅ | Filled even-odd. |
| Magic wand (tolerance, contiguous, all layers) | ✅ | Hard-edged (no anti-alias option yet). |
| New / Add / Subtract / Intersect (options bar or Shift / Alt / Shift+Alt) | ✅ | |
| Select All, Deselect, Inverse, Feather | ✅ | |
| Marching ants | ✅ | Computed at screen resolution. |
| Quick Mask, Select and Mask, polygonal lasso, transform selection | 📋 | |

### Painting and tools
| Feature | Status | Notes |
|---|---|---|
| Brush: size, hardness, opacity, flow, spacing | ✅ | Opacity caps overlapping dabs within one stroke (measured 127/255 at 50%). Shift+click draws lines; [ ] and 1–0 shortcuts. |
| Pen pressure → size / flow | 🟡 | Uses Pointer Events pressure. Not tested with a real tablet. |
| Eraser | ✅ | Erases to transparency. |
| Paint bucket | ✅ | Tolerance, contiguous, all layers. |
| Gradient (linear / radial, reverse, to transparent) | ✅ | Shift snaps to 45°. Midpoint measured 128/255. |
| Eyedropper (point, 3×3, 5×5, 11×11; all layers or current) | ✅ | Alt+click sets the background colour; Alt with the Brush samples. |
| Move tool (+ auto-select, arrow-key nudge) | ✅ | Moves the whole layer, or only the selected pixels when there is a selection (the selection follows). Whole-pixel moves are exact. |
| Free Transform (Ctrl+T) | ✅ | Scale (corners keep proportions; Shift frees them; Alt from the centre), rotate (Shift snaps 15°), move, typed X/Y/W/H/angle. Works on the layer or the selected pixels; a layer mask moves with its layer. Enter commits, Esc cancels; one undo step. |
| Edit → Transform: Flip, Rotate 90°/180° | ✅ | On the layer or selected pixels. 90° turns and flips are pixel-exact (verified). |
| Skew, distort, perspective, warp | 📋 | |
| Crop tool (drag, adjust handles, Enter / Esc / double-click) | ✅ | Pixels outside the canvas stay on their layers. |
| Fill / Clear selection (Alt+Backspace, Ctrl+Backspace, Delete) | ✅ | |
| Cut / Copy / Copy Merged / Paste (in place) | ✅ | Uses the system clipboard as PNG. Pasting images copied from other apps depends on them putting PNG on the clipboard; not tested with other apps. |
| Type tool (live type layers) | ✅ | Click to add point type, click type to edit it; edited on the canvas over the real rendering. Font (installed fonts from a curated list), weight, italic, size, alignment, colour, leading, tracking; multi-line. One undo step per editing session; Esc cancels; empty new type leaves no trace. Stays vector through Free Transform, save/reopen, Image Size and canvas rotation; Rasterize Layer converts it. |
| Shape tool (rectangle, rounded rectangle, ellipse, polygon, line) | ✅ | Vector shape layers: fill (foreground), stroke (background) and width, corner radius, sides, size; edited in Properties; transform without resampling. |
| Type on a path, paragraph (box) type, character/paragraph panels, pen paths | 📋 | |
| Clone Stamp (S) | ✅ | Alt+click sets the source; aligned or non-aligned offset; samples the current layer or all layers; live preview; brush size/hardness/opacity/flow. |
| Healing Brush (J) | ✅ | Clone with frequency-separation healing on release: the source's detail on the destination's own colour and light (verified: healing a light area from a dark source keeps the light tone). Spot healing (no source) is not built. |
| Dodge/burn, sponge, smudge | 📋 | Phase 6. |

### Image commands
| Feature | Status | Notes |
|---|---|---|
| Adjustments (destructive) with live preview | ✅ | Brightness/Contrast, Hue/Saturation, Black & White, Sepia, Invert, Desaturate. They use the standard Filter Effects formulas, not Photoshop's exact algorithms (e.g. Brightness is multiplicative). |
| Gaussian blur with live preview | 🟡 | Pixels past the layer edge count as transparent, so edges soften toward transparency. |
| Image Size (resample), Canvas Size (anchor) | ✅ | |
| Rotate 90° / 180°, Flip Horizontal / Vertical | ✅ | Pixel mapping verified. |
| Levels (Ctrl+L) and Curves (Ctrl+M) | ✅ | Destructive (dialog with histogram and live preview) and as adjustment layers (edited in Properties). Curves: RGB plus per-channel, monotone interpolation (never overshoots), click to add points, drag off to remove. Run as 256-entry lookup tables on the GPU (WebGL2) with a CPU fallback; values verified (e.g. gamma 2 on 128 → 181). |
| Sharpen, noise, other filters | 📋 | |
| Undo / redo with History panel (50 steps per document) | ✅ | Click a step to jump; failed edits never enter history. |

## Planned phases

| Phase | Scope |
|---|---|
| 2 ✅ | Layer masks and groups, Free Transform, move selected pixels, Type tool, shapes, clone stamp/healing, Levels/Curves (WebGL), autosave/recovery, rebindable shortcuts |
| 3 | Colour management: 16-bit/float pipeline, ICC profiles, soft-proofing |
| 4 | PSD import/export, TIFF, camera RAW |
| 5 | Monorepo with Cadence (shared `ui/` and `core/` packages) |
| 6 | Retouching tools and filters: dodge/burn, sponge, smudge, blur/sharpen tools, history brush, polygonal lasso, quick mask, Color Range, Unsharp Mask, noise, motion blur, high pass |
| 7 | Layer styles (drop shadow, stroke, glows, colour overlay), multi-layer selection, export presets (scale, format batches) |
