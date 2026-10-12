# Shared packages and the Cadence monorepo

Cadence (video) and Cadence+ (image) share one design system and some
framework-free logic. Phase 5 pulls that shared code into two npm workspace
packages:

| Package | Path | Contents |
|---|---|---|
| `@cadence/ui` | `packages/ui` | `base.css` (design tokens, global element rules, form controls, focus ring, scrollbars, dockview theme, menus, tooltips, buttons, scrub numbers, toasts), `components.tsx` (context menu, `ScrubNumber`, `SliderField`, `NumberInput`, `Modal`), `Tooltip.tsx`, `tokens.ts` (CSS tokens for canvas drawing) |
| `@cadence/core` | `packages/core` | `history.ts` (generic snapshot undo/redo over Immer with coalescing and a step limit), `color.ts` (hex / RGB / HSV) |
| `@cadence/release` | `packages/release` | Main-process release helpers: the newest GitHub release with an app's tag prefix, and self-update (electron-updater) |

The packages ship TypeScript sources (`exports` point at `.ts`/`.tsx`/`.css`);
each app's Vite build compiles them. React, Zustand, Immer and dockview are
peer dependencies, so there is one copy of each per app.

```ts
import '@cadence/ui/base.css'            // first; the app's own theme.css follows
import { Modal, ScrubNumber } from '@cadence/ui/components'
import { createHistory, apply, undo } from '@cadence/core/history'
```

## Status

- **Layout**: done — the repository root is the `cadence` workspace, with
  Cadence+ in `apps/plus` and Cadence Hub in `apps/hub`.
- **Cadence+**: built from the packages (verified: type-check, 58 unit tests,
  69 end-to-end checks, and a pixel comparison of 13 UI screenshots before and
  after the split, identical apart from animated marching ants and the live
  memory counter).
- **Cadence**: not moved in yet. Its repository (`Desktop\Video Editor`) was
  being changed by another working session at the time, and moving a live
  repository underneath it would break that work. Nothing in Cadence was
  modified.

## Moving Cadence in

Layout (steps 1 is done):

```
cadence/
  apps/plus/             Cadence+ (image editor)
  apps/hub/              Cadence Hub
  apps/video/            Cadence Video (to import)
  packages/ui/  packages/core/  packages/release/
  package.json           { "workspaces": ["apps/*", "packages/*"] }
```

Steps, in order (each leaves every app building):

1. ~~Move Cadence+ into `apps/plus/`~~ (done).
2. Once Cadence Video's working copy is committed, import it with history:
   `git subtree add --prefix apps/video <path-to-Video-Editor> main`.
   Rename its package to `cadence-video` and its `productName` to
   `Cadence Video` (Cadence Hub looks for that name), and give it the same
   packaging as Cadence+: `electron-builder.config.cjs` (appId
   `org.cadence.video`, executable `CadenceVideo`, artifact
   `Cadence-Video-Setup-${version}.exe`, `uninstallDisplayName: 'Cadence Video'`),
   `src/main/updater.ts` using `createSelfUpdater(__RELEASE__, 'video-v')`,
   the `bundledPackages` plugin and `scripts/notices.mjs` in its build, and
   icons from `packages/ui/assets/cadence-video-logo.svg`.
3. In Cadence, replace its copies with the shared ones:
   - `ui/Tooltip.tsx` — identical; delete and import `@cadence/ui/Tooltip`.
   - `ui/tokens.ts` — the shared one is a superset (adds `checkerTile`).
   - `ui/components.tsx` — `CtxItem`, `showContextMenu`, `ContextMenuHost`,
     `ScrubNumber` and `Modal` come from `@cadence/ui/components` (the shared
     `Modal` adds an optional `onSubmit`; `CtxItem` adds optional `checked`).
     `TimecodeField`, `formatBytes` and `formatDuration` stay in Cadence.
   - `ui/theme.css` — import `@cadence/ui/base.css` first and delete the
     sections it now provides. Keep in Cadence: the timeline and monitor
     tokens, the legacy `--bg-*`/`--line` aliases, `select { padding-right }`
     and the `input[type='color']` rule.
   - `core/history.ts` — Cadence's `History` is the same model specialised to
     `Project`; `applyEdit(h, label, recipe)` becomes
     `apply(h, label, recipe)` and `HISTORY_LIMIT` becomes the `limit`
     argument of `createHistory`.
4. Run Cadence's `typecheck`, `test` and `e2e`, and compare screenshots as
   above.
