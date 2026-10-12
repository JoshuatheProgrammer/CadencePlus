/**
 * Packaging for Cadence Hub (Windows installer, NSIS) — the suite's front
 * door: its installer offers Cadence+ and Cadence Video, which the hub then
 * installs from their GitHub releases.
 *
 *   npm run dist -w cadence-hub      → dist/Cadence-Hub-Setup-<version>.exe + latest.yml
 *
 * Releases are tagged "hub-v<version>" (see docs/RELEASING.md).
 */
const release = require('../../release.config.json')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'org.cadence.hub',
  electronVersion: require('electron/package.json').version,
  productName: 'Cadence Hub',
  executableName: 'CadenceHub',
  copyright: 'Copyright © 2026 spoti and the Cadence contributors. MIT licence.',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['out/**', 'package.json', '!out/renderer/bundled-packages.json'],
  extraResources: [{ from: '../../LICENSE', to: 'LICENSE.txt' }, { from: 'out/THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'Cadence-Hub-Setup-${version}.${ext}',
    signAndEditExecutable: true,
    ...(process.env.CADENCE_PUBLISHER_NAME ? { signtoolOptions: { publisherName: [process.env.CADENCE_PUBLISHER_NAME] } } : {})
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Cadence Hub',
    menuCategory: 'Cadence',
    uninstallDisplayName: 'Cadence Hub',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerSidebar: 'build/installer-sidebar.bmp',
    uninstallerSidebar: 'build/installer-sidebar.bmp',
    installerHeader: 'build/installer-header.bmp',
    license: '../../LICENSE',
    include: 'build/installer.nsh',
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: false
  },
  publish: [{ provider: 'generic', url: `https://github.com/${release.owner}/${release.repo}/releases/download/hub-v\${version}` }]
}
