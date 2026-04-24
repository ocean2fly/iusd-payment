/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_CHAIN_ID?: string
  readonly VITE_EXPLORER_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
