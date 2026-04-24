/**
 * Network Configuration (mainnet-focused)
 *
 * Frontend runtime values come from VITE_* envs.
 */

export interface NetworkConfig {
  name: string
  chainId: string
  rpcUrl: string
  restUrl: string
  explorerUrl: string
  insContract: string
  iusdFa: string
  iusdDenom: string
  iusdDecimals: number
}

const chainId = import.meta.env.VITE_CHAIN_ID || 'interwoven-1'
const rpcUrl = import.meta.env.VITE_RPC_URL || 'https://rpc.initia.xyz'
const restUrl = import.meta.env.VITE_REST_URL || 'https://rest.initia.xyz'
const explorerUrl = import.meta.env.VITE_EXPLORER_BASE || 'https://scan.initia.xyz/interwoven-1'
const iusdFa = (import.meta.env.VITE_IUSD_FA || '').toLowerCase()

export const NETWORK: NetworkConfig = {
  name: chainId === 'interwoven-1' ? 'Initia Mainnet' : 'Initia',
  chainId,
  rpcUrl,
  restUrl,
  explorerUrl,
  insContract: import.meta.env.VITE_INS_CONTRACT || '',
  iusdFa,
  iusdDenom: `move/${iusdFa.replace(/^0x/, '')}`,
  iusdDecimals: parseInt(import.meta.env.VITE_IUSD_DECIMALS || '6', 10),
}

export const CHAIN_ID = NETWORK.chainId
export const RPC_URL = NETWORK.rpcUrl
export const REST_URL = NETWORK.restUrl
export const INS_CONTRACT = NETWORK.insContract
export const IUSD_FA = NETWORK.iusdFa
export const IUSD_DENOM = NETWORK.iusdDenom
export const IUSD_DECIMALS = NETWORK.iusdDecimals
