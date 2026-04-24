import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'
import fs from 'fs'

/**
 * Vite plugin: resolve deep sub-path imports from CJS packages that lack
 * proper "exports" maps (e.g. @cosmjs/*, @noble/hashes, cosmjs-types).
 * Falls back to the file on disk when Vite's resolver throws.
 */
function cjsDeepImportPlugin() {
  return {
    name: 'cjs-deep-import-fix',
    enforce: 'pre' as const,
    resolveId(id: string) {
      // Only handle scoped or bare deep imports (e.g. @cosmjs/amino/build/signdoc.js)
      if (!id.includes('/') || id.startsWith('.') || id.startsWith('/')) return
      const parts = id.startsWith('@') ? id.split('/').slice(0, 2) : [id.split('/')[0]]
      const pkgName = parts.join('/')
      const subPath = id.slice(pkgName.length + 1)
      if (!subPath) return

      // Try to resolve via require.resolve to handle pnpm's strict hoisting
      try {
        const pkgJson = pkgName + '/package.json'
        const resolved = require.resolve(pkgJson, { paths: [process.cwd()] })
        const pkgDir = path.dirname(resolved)
        const candidates = [
          path.join(pkgDir, subPath),
          path.join(pkgDir, subPath.replace(/\.js$/, '')),
          path.join(pkgDir, subPath) + '.js',
          path.join(pkgDir, subPath, 'index.js'),
        ]
        for (const c of candidates) {
          if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
        }
      } catch {}
    },
  }
}

// Map generic env vars → VITE_* so frontend code works without VITE_ prefix in CI
const env = process.env
const envDefines: Record<string, string> = {}
const mapping: Record<string, string> = {
  VITE_API_URL:        'API_URL',
  VITE_CHAIN_ID:       'CHAIN_ID',
  VITE_EXPLORER_BASE:  'EXPLORER_BASE',
}
for (const [viteKey, envKey] of Object.entries(mapping)) {
  if (env[envKey] && !env[viteKey]) {
    envDefines[`import.meta.env.${viteKey}`] = JSON.stringify(env[envKey])
  }
}

export default defineConfig({
  define: envDefines,
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util', 'process'],
    }),
    cjsDeepImportPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/v1': {
        target: 'https://api.iusd-pay.xyz',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
