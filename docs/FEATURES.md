# Cadence+ — Feature Checklist

Status legend:

- ✅ **Verified**: implemented and checked by automated tests that drive the real app and measure the output pixels (`npm test`, `npm run e2e`).
- 🟡 **Limited**: implemented, with the limitation noted.
- 📋 **Planned**: not in the interface yet, or shown disabled with an explanation.

Last verified: 2026-10-10 on Windows 11, Electron 44.7.
Suites: 58 unit (`npm test`) · 65 end-to-end (`npm run e2e`), all passing.

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
| Open Photoshop (PSD) | ✅ | Via ag-psd (MIT). Layers, groups (incl. Pass Through), layer masks, blend modes, opacity, visibility, and Brightness/Contrast, Levels, Curves, Hue/Saturation, Invert, Black & White adjustment layers. 16-bit PSDs open at 16 bits. Anything not carried over (layer styles, clipping masks, live type, smart objects, vector masks, other adjustments, CMYK/Lab) is named in a note when the file opens. |
| Export Photoshop (PSD) | ✅ | Layered: groups, masks, blend modes, opacity and the adjustment layers above; type, shapes and fill layers are written as pixels. 8 bits/channel sRGB (16-bit and P3 documents are converted, with a note). Verified by reading the file back with ag-psd and reopening it in Cadence+. |
| TIFF import / export | ✅ | Via UTIF (MIT) for reading: first page, 8 or 16 bits/channel, RGB or grey, alpha, embedded ICC profile (colour-managed like PNG). Export is our own uncompressed RGBA writer, 8 or 16 bits/channel, with an embedded profile for P3 documents. Verified: a 1024-level 16-bit ramp survives import → export → reopen. Compressed TIFFs (LZW, Deflate, PackBits) decode through UTIF but are not covered by tests. |
| Camera RAW | 🟡 | Developed with LibRaw (libraw-wasm; LibRaw is LGPL-2.1/CDDL, loaded as a separate replaceable WebAssembly file): camera white balance, AHD demosaic, no auto-brightening, 16 bits/channel, linear Adobe RGB converted by our CMM into Display P3. DNG, CR2/CR3, NEF, ARW, RAF, ORF, RW2, PEF and others. Verified exactly on a synthetic linear DNG (18% grey → 0.461 sRGB); no real camera files were available to test with. No develop controls yet (exposure, WB, etc. — use adjustment layers after opening). |
| `.cadenceimg` document format | ✅ | Versioned header + PNG tiles. Save/reopen is pixel-identical with layers, blend modes, opacity, fill and adjustment layers, and the selection. Atomic writes with a `.bak`. Newer formats are refused with a clear message. |
| Export PNG / JPEG / WebP / TIFF / PSD | ✅ | PNG export matches the composite exactly. JPEG gets a white matte. Size estimate shown before export. |
| Unsaved-changes prompt (close document, close window) | 🟡 | Implemented. The window-close path is not covered by an automated test. |
| Autosave and crash recovery | ✅ | Every 60 s and on window blur, unsaved documents are copied to the recovery folder (never over your file). Copies are removed on save, close or discard; leftovers are offered at start-up and reopen as unsaved. Tested by killing the process tree and relaunching. |
| 16 bits/channel | ✅ | Documents can be 16-bit (half-float) end to end: tiles, compositing, blend modes, filters, Levels/Curves (half-float GPU path) and export. Verified: a 1024-px gradient keeps 1024 levels (8-bit: 256). Image → Mode switches 8 ↔ 16. |
| Working colour spaces: sRGB and Display P3 | ✅ | Chosen at New Document or via Image → Convert to Profile (colour-managed, undoable). P3-only colours survive (P3 green stays 0,1,0); converting to sRGB clips them. The screen canvas uses the document's space. |
| ICC-aware import | ✅ | Own PNG decoder keeps 16-bit PNGs at 16 bits. Embedded matrix/curve ICC profiles (Adobe RGB, ProPhoto, P3, camera/monitor profiles) in PNG, JPEG and WebP are converted into sRGB, or Display P3 when the source gamut is wider; you get a note saying what happened. Lookup-table (A2B) profiles fall back to Chromium's own conversion to sRGB. |
| Profile-tagged export, 16-bit PNG | ✅ | P3 documents export with an embedded profile; 16-bit documents can export 16-bit PNGs; projects store 16-bit/P3 tiles losslessly. |
| Soft proofing and gamut warning | ✅ | View → Proof Setup (sRGB, grayscale, protanopia/deuteranopia/tritanopia), Proof Colors (Ctrl+Y), Gamut Warning (Ctrl+Shift+Y) for colours outside sRGB. Display only (verified the document is untouched). Redo is Ctrl+Shift+Z (Ctrl+Y is Proof Colors, as in Photoshop). |
| CMYK, Lab, 32-bit float/HDR | 📋 | |

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
| 3 ✅ | Colour management: 16-bit/float pipeline, ICC profiles, soft-proofing |
| 4 ✅ | PSD import/export, TIFF, camera RAW (RAW 🟡: verified on synthetic DNG only) |
| 5 | Monorepo with Cadence (shared `ui/` and `core/` packages) |
| 6 | Retouching tools and filters: dodge/burn, sponge, smudge, blur/sharpen tools, history brush, polygonal lasso, quick mask, Color Range, Unsharp Mask, noise, motion blur, high pass |
| 7 | Layer styles (drop shadow, stroke, glows, colour overlay), multi-layer selection, export presets (scale, format batches) |
