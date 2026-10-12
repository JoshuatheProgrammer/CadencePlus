# Releasing Cadence

Every app in the suite (Cadence+, the Cadence hub, and Cadence Video once it
joins this repository) is released from one GitHub repository. Each app's
releases carry its own tag prefix, and the apps update themselves from them.

| App | Folder | Tag | Installer |
|---|---|---|---|
| Cadence+ | `apps/plus` | `plus-v1.2.3` | `Cadence-Plus-Setup-1.2.3.exe` |
| Cadence (hub) | `apps/hub` | `hub-v1.2.3` | `Cadence-Setup-1.2.3.exe` |
| Cadence Video | `apps/video` | `video-v1.2.3` | `Cadence-Video-Setup-1.2.3.exe` |

## One-time setup

1. **Create the repository** on GitHub (public, so the updater and SignPath can
   read it), e.g. `YOUR_GITHUB/cadence`, and push this folder to it:
   ```
   git remote add origin https://github.com/YOUR_GITHUB/cadence.git
   git push -u origin main
   ```
2. **Point the apps at it:** in `release.config.json`, set `owner` to your
   GitHub user or organisation (and `repo` if you named it differently).
   Commit and push. Builds made before this change have updates switched off.
3. **Code signing (SignPath Foundation, free for open source).**
   1. Apply at https://signpath.org with the public repository. Approval
      can take days to weeks; until then releases are published unsigned and
      Windows SmartScreen shows a warning on first run.
   2. When approved, in SignPath: create a project (e.g. `cadence`), link it
      to the GitHub repository as a trusted build system, and add two
      artifact configurations with the slugs **`executable`** and
      **`installer`** — their contents are in `.signpath/artifact-configurations/`.
      Note the signing policy slug (usually `release-signing`).
   3. In GitHub → Settings → Secrets and variables → Actions:
      - secret `SIGNPATH_API_TOKEN` — a CI user's API token from SignPath;
      - variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
        `SIGNPATH_POLICY_SLUG`;
      - variable `SIGNPATH_PUBLISHER_NAME` — the certificate's subject name
        (shown in SignPath, e.g. `SignPath Foundation`). With it, installed
        apps only accept updates signed by that publisher.

   The release workflow signs as soon as `SIGNPATH_ORGANIZATION_ID` exists.

## Releasing a version

1. Bump `version` in the app's `package.json` (e.g. `apps/plus/package.json`
   → `0.2.0`), commit.
2. Tag and push: `git tag plus-v0.2.0 && git push origin main plus-v0.2.0`.
3. GitHub Actions (`.github/workflows/release.yml`) type-checks, tests,
   builds, signs (when configured) and publishes the release with the
   installer and `latest.yml`. Installed copies find it within six hours
   (or immediately with Help → Check for Updates), download it in the
   background and install it on restart.

The tag must match the version in `package.json`, or the workflow stops.

## Building locally

```
npm ci
npm run dist -w cadence-plus        # apps/plus/dist/Cadence-Plus-Setup-<version>.exe (unsigned)
node apps/plus/scripts/e2e-packaged.mjs   # after: npm run pack -w cadence-plus
```

`npm run pack -w cadence-plus` makes an unpacked build for testing; the
packaged-app test checks startup, camera RAW, the licence texts and an update
from a local stand-in for GitHub.

## What the release contains

- The installer, per user (no administrator rights), with a choice of
  folder, Start-menu and desktop shortcuts, and the MIT licence page.
- `resources/LICENSE.txt` and `resources/THIRD_PARTY_NOTICES.txt` (also under
  Help → About → Licences…), with LibRaw's LGPL-2.1 notice; LibRaw's files
  sit in `resources/app.asar.unpacked` so they can be replaced.
- `latest.yml` beside it on the release, which the updater reads.
