import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'
import fs from 'fs'

// Resolve cosmjs-types deep imports that end with .js
// These are CJS files without an exports map, so Vite can't strip .js automatically
function cosmjsTypesPlugin() {
  return {
    name: 'cosmjs-types-cjs-fix',
    resolveId(id: string) {
      if (id.startsWith('cosmjs-types/') && id.endsWith('.js')) {
        const withoutJs = id.slice(0, -3)
        const candidates = [
          path.join(process.cwd(), 'node_modules', withoutJs),
          path.join(process.cwd(), '../../node_modules/.pnpm', `cosmjs-types@0.9.0/node_modules/${withoutJs}`),
        ]
        for (const c of candidates) {
          if (fs.existsSync(c + '.js')) return c + '.js'
          if (fs.existsSync(c + '/index.js')) return c + '/index.js'
        }
        return withoutJs
      }
    },
  }
}

const env = process.env
const envDefines: Record<string, string> = {}
const mapping: Record<string, string> = {
  VITE_NETWORK: 'NETWORK',
  VITE_CHAIN_ID: 'CHAIN_ID',
  VITE_RPC_URL: 'RPC_URL',
  VITE_REST_URL: 'REST_URL',
  VITE_API_URL: 'API_URL',
  VITE_API_BASE: 'API_URL',
  VITE_APP_URL: 'APP_URL',
  VITE_IPAY_POOL_ADDRESS: 'IPAY_POOL_ADDRESS',
  VITE_MODULE_ADDRESS: 'MODULE_ADDRESS',
  VITE_GIFT_POOL_ADDRESS: 'GIFT_POOL_ADDRESS',
  VITE_IUSD_FA: 'IUSD_FA',
  VITE_IUSD_DECIMALS: 'IUSD_DECIMALS',
  VITE_EXPLORER_BASE: 'EXPLORER_BASE',
  VITE_EXPLORER_TX_BASE: 'EXPLORER_TX_BASE',
  VITE_INS_CONTRACT: 'INS_CONTRACT',
  VITE_INIT_DENOM: 'INIT_DENOM',
  VITE_WC_PROJECT_ID: 'WC_PROJECT_ID',
  VITE_WC_CHAIN_ID: 'WC_CHAIN_ID',
}
for (const [viteKey, envKey] of Object.entries(mapping)) {
  if (env[envKey] && !env[viteKey]) {
    let value = env[envKey]!
    if ((viteKey === 'VITE_API_URL' || viteKey === 'VITE_API_BASE') && !value.endsWith('/v1')) {
      value = value.replace(/\/$/, '') + '/v1'
    }
    envDefines[`import.meta.env.${viteKey}`] = JSON.stringify(value)
  }
}

export default defineConfig({
  define: envDefines,
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util', 'process'],
    }),
    cosmjsTypesPlugin(),
  ],
  build: {
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('/node_modules/')) return 'vendor-kit'
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['snarkjs'],
  },
  server: {
    proxy: {
      '/v1': {
        target: 'https://api.iusd-pay.xyz',
        changeOrigin: true,
      },
    },
  },
})
