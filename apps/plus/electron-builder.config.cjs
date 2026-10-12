/**
 * Packaging for Cadence+ (Windows installer, NSIS).
 *
 *   npm run dist -w cadence-plus      → dist/Cadence-Plus-Setup-<version>.exe + latest.yml
 *
 * Releases are tagged "plus-v<version>" in the suite repository named in
 * release.config.json; the app's updater (src/main/updater.ts) finds them there.
 * Code signing happens in CI (.github/workflows/release.yml, SignPath).
 */
const release = require('../../release.config.json')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'org.cadence.plus',
  // The Electron that is installed (the workspace hoists it), so builds match what was tested.
  electronVersion: require('electron/package.json').version,
  productName: 'Cadence+',
  executableName: 'CadencePlus',
  copyright: 'Copyright © 2026 spoti and the Cadence contributors. MIT licence.',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['out/**', 'package.json', '!out/renderer/bundled-packages.json'],
  // LibRaw (LGPL-2.1) stays outside the archive so it can be replaced (see THIRD_PARTY_NOTICES.txt).
  asarUnpack: ['out/renderer/assets/libraw-*', 'out/renderer/assets/worker-*'],
  extraResources: [{ from: '../../LICENSE', to: 'LICENSE.txt' }, { from: 'out/THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }],
  fileAssociations: [{ ext: 'cadenceimg', name: 'Cadence+ Document', description: 'Cadence+ document', icon: 'build/icon.ico', role: 'Editor' }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'Cadence-Plus-Setup-${version}.${ext}',
    // Signed in CI by SignPath; local builds are unsigned.
    signAndEditExecutable: true,
    // Once releases are signed, installed copies accept updates only from this publisher.
    ...(process.env.CADENCE_PUBLISHER_NAME ? { signtoolOptions: { publisherName: [process.env.CADENCE_PUBLISHER_NAME] } } : {})
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Cadence+',
    // What Windows lists under Apps (and what Cadence Hub looks for).
    uninstallDisplayName: 'Cadence+',
    menuCategory: 'Cadence',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerSidebar: 'build/installer-sidebar.bmp',
    uninstallerSidebar: 'build/installer-sidebar.bmp',
    installerHeader: 'build/installer-header.bmp',
    license: '../../LICENSE',
    deleteAppDataOnUninstall: false,
    // Signing in CI changes the installer after it is built, so no block map (full downloads only).
    differentialPackage: false
  },
  // Generates latest.yml; the updater points at the release folder itself.
  publish: [{ provider: 'generic', url: `https://github.com/${release.owner}/${release.repo}/releases/download/plus-v\${version}` }]
}
