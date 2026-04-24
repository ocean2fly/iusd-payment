const rawApiUrl = (import.meta.env.VITE_API_URL ?? 'https://api.iusd-pay.xyz').replace(/\/$/, '')

export const API_ORIGIN = rawApiUrl.replace(/\/v1$/, '')
export const API_V1 = `${API_ORIGIN}/v1`
export const CHAIN_ID = import.meta.env.VITE_CHAIN_ID ?? 'interwoven-1'
export const EXPLORER_BASE = (import.meta.env.VITE_EXPLORER_BASE ?? `https://scan.initia.xyz/${CHAIN_ID}`).replace(/\/$/, '')
