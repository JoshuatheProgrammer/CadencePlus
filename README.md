# Cadence

A free, open-source creative suite for Windows. No accounts, no
subscriptions, no payments.

| App | What it is | Folder |
|---|---|---|
| **Cadence Hub** | Installs, updates, opens and removes the apps (like Creative Cloud, free) | [`apps/hub`](apps/hub) |
| **Cadence+** | Image editor: layers, masks, retouching, layer styles, 16-bit and wide-gamut colour, camera RAW, PSD | [`apps/plus`](apps/plus) |
| **Cadence Video** | Video editor: timeline, keyframes, colour grading, audio mixing | joining as `apps/video` (see [docs/MONOREPO.md](docs/MONOREPO.md)) |

Shared code lives in [`packages/`](packages): `@cadence/ui` (design system),
`@cadence/core` (undo history, colour maths) and `@cadence/release` (GitHub
releases and self-update).

## Install

Download **Cadence-Hub-Setup** from the Releases page, run it, and tick the
apps you want; the hub installs them and keeps everything up to date. Each
app also has its own installer on the Releases page.

## Develop

```
npm install
npm run plus:dev                 # Cadence+ with hot reload
npm run dev -w cadence-hub       # Cadence Hub
```

Checks:

```
npm run typecheck && npm test               # all workspaces
npm run plus:build && npm run plus:e2e      # Cadence+ end to end (drives the real app, checks pixels)
npm run build -w cadence-hub && npm run e2e -w cadence-hub
npm run dist -w cadence-plus                # an installer in apps/plus/dist
```

Contributions are welcome: open an issue or a pull request. CI runs the
type-check, unit tests and builds on every pull request.

## Docs

- [docs/RELEASING.md](docs/RELEASING.md): publishing releases, code signing, auto-update
- [docs/MONOREPO.md](docs/MONOREPO.md): repository layout and bringing in Cadence Video
- [apps/plus/docs/FEATURES.md](apps/plus/docs/FEATURES.md): what Cadence+ does, honestly marked
- [apps/plus/docs/ARCHITECTURE.md](apps/plus/docs/ARCHITECTURE.md) and [DESIGN.md](apps/plus/docs/DESIGN.md)
- [CADENCE_OVERVIEW.md](CADENCE_OVERVIEW.md): the original brief

## Licence

[MIT](LICENSE). Third-party components keep their own licences; each app
lists them under Help → About → Licences (and in `THIRD_PARTY_NOTICES.txt`
beside the installed app). Camera RAW support uses LibRaw under the LGPL-2.1
([licenses/LGPL-2.1.txt](licenses/LGPL-2.1.txt)).
