# Cadence+

A Photoshop-style image editor for Windows, and the sibling of the Cadence video editor. It shares Cadence's stack (Electron, React, dockview, Zustand + Immer) and its graphite & ice-blue design.

## Run

```
npm install
npm run dev
```

If `node_modules/electron/dist` is missing after install, run `node node_modules/electron/install.js`.

## Verify

```
npm test            # core unit tests
npm run build
npm run e2e         # drives the real app, checks pixels
npm run perf        # compositor frame times
npm run shot        # screenshots into test-output/
```

## Docs

- [docs/FEATURES.md](docs/FEATURES.md): what works, what is limited, what is planned
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it is built
- [docs/DESIGN.md](docs/DESIGN.md): the design system
- [CADENCE_OVERVIEW.md](CADENCE_OVERVIEW.md): the original brief from Cadence
