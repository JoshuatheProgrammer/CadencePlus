# Cadence+ design base

Cadence+ is the image-editing sibling of Cadence. It uses the same stack (Electron 44, React 19, dockview 8, Zustand + Immer, electron-vite) and the same product principles: no fake controls, honest reporting, sources never modified, one authoritative model.

## Theme
- **Palette:** identical to Cadence (graphite + ice blue `#69B7FF`). These tokens live in the shared package `packages/ui/src/base.css` (`@cadence/ui`), with the widgets both apps use.
- **Image-editor tokens (new):** `--c-pasteboard` (`#1F1F1F`, neutral grey around the document), `--c-doc-edge`, `--checker-a/b/size` (the hue-free transparency checkerboard), `--pixel-grid` (shown at ≥ 800%), `--ruler-*`, `--guide` and `--bbox`. They are defined in `src/renderer/src/ui/theme.css`; canvas code reads them through `@cadence/ui/tokens` (`token()` and `checkerTile()`).
- **Style rules (shared):** 12 px text, 24 px controls, 3–5 px radii, 1.25 px line icons, hover is a brightness change, and the focus ring is 1 px ice blue. No glow, glass effects or decorative gradients.
- **Mark:** the same rounded-square frame as Cadence, with three stacked ice-blue layers at the 1 / 0.7 / 0.45 ramp in place of Cadence's three track bars. The wordmark is "Cadence" with an accent-coloured "+".

## Frame layout (Photoshop-style)
```
Title bar (logo, menus, document title)          [native window controls overlay]
Options bar (active tool badge + that tool's real options)
Tool rail | Workspace (dockview):  Document area (doc tabs, rulers, viewport) | Navigator · Color · Swatches
          |                                                                   | Properties · History
          |                                                                   | Layers
Status bar (zoom field, document size, RGB/8 · sRGB, cursor position, status)
```
Unbuilt tools stay in the rail, **disabled**, with a tooltip saying they are not built yet (the "clearly labelled unavailable" rule). Currently that is the Type and Shape tools.

## Components and patterns
- **Tool rail:** 32×30 px buttons; the active tool gets the select fill, an accent icon and a 2 px accent bar on the left. Unbuilt tools are disabled and their tooltip says why. Foreground/background chips sit at the bottom, with Default (D) and Swap (X).
- **Options bar:** a tool badge, then that tool's live settings (segmented controls, slider + scrub value pairs, checkboxes), then a one-line usage hint.
- **Document area:** document tabs in the Cadence timeline-tab style (accent top edge on the active tab, • for unsaved changes), 20 px rulers with an accent cursor tick, and the canvas on the neutral pasteboard with a 1 px dark edge.
- **Canvas overlays:** a black line with white dashes for marquees and marching ants; a white line on a soft dark halo for cursors and the gradient line. The crop shade is 55% black, with rule-of-thirds lines, white square handles and a size readout.
- **Layers panel:** 42 px rows with an eye toggle, a 34 px checkerboard thumbnail (the half-filled circle marks adjustment layers), the name, an opacity badge when below 100%, and a lock. The active row gets the select fill and an accent thumbnail border; an accent line marks the drop position while dragging.
- **Dialogs:** Cadence's modal, plus presets as selectable cards, slider rows, and a Preview checkbox for anything that changes pixels.

For what is built and verified, see `docs/FEATURES.md`; for the code, `docs/ARCHITECTURE.md`.
