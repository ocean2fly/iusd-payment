/**
 * Network Configuration (env-driven, mainnet-first)
 */

export type Network = 'mainnet' | 'custom'

export const NETWORK: Network =
  (import.meta.env.VITE_NETWORK as Network) ?? 'mainnet'

export const CHAIN_ID = import.meta.env.VITE_CHAIN_ID ?? 'interwoven-1'
export const REST_URL = import.meta.env.VITE_REST_URL ?? 'https://rest.initia.xyz'
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://rpc.initia.xyz'
export const INIT_DENOM = import.meta.env.VITE_INIT_DENOM ?? 'uinit'
export const EXPLORER = import.meta.env.VITE_EXPLORER_TX_BASE ?? 'https://scan.initia.xyz/interwoven-1/txs'
export const NET_LABEL = CHAIN_ID === 'interwoven-1' ? 'Mainnet' : 'Custom'

export const IUSD_FA = (import.meta.env.VITE_IUSD_FA ?? '').toLowerCase()
export const IUSD_DENOM = `move/${IUSD_FA.replace(/^0x/, '')}`
