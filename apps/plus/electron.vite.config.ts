import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const alias = {
  '@core': resolve(__dirname, 'src/core'),
  '@shared': resolve(__dirname, 'src/shared')
}

/** Lists the npm packages bundled into the renderer (for scripts/notices.mjs). */
function bundledPackages(): Plugin {
  return {
    name: 'cadence-bundled-packages',
    apply: 'build',
    generateBundle() {
      const names = new Set<string>()
      for (const id of this.getModuleIds()) {
        const m = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)
        if (m) names.add(m[1].replace('\\', '/'))
      }
      this.emitFile({ type: 'asset', fileName: 'bundled-packages.json', source: JSON.stringify([...names].sort(), null, 2) })
    }
  }
}

// Where releases live (one file for the whole suite; see release.config.json).
const release = JSON.parse(readFileSync(resolve(__dirname, '../../release.config.json'), 'utf8')) as { owner: string; repo: string }

export default defineConfig({
  main: {
    resolve: { alias },
    define: { __RELEASE__: JSON.stringify({ owner: release.owner, repo: release.repo }) },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { ...alias, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), bundledPackages()],
    worker: { format: 'es' },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
