/**
 * Network Configuration (mainnet-focused)
 *
 * Runtime values come from environment variables.
 */

import {
  CHAIN_ID,
  RPC_URL,
  REST_URL,
  IUSD_FA,
} from './config'

export interface NetworkConfig {
  name: string
  chainId: string
  rpcUrl: string
  restUrl: string
  insContract: string
  iusdFa: string
  iusdDenom: string
  iusdDecimals: number
}

const iusdFa = IUSD_FA.toLowerCase()

export const NETWORK: NetworkConfig = {
  name: CHAIN_ID === 'interwoven-1' ? 'Initia Mainnet' : 'Initia',
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  restUrl: REST_URL,
  insContract: process.env.INS_CONTRACT ?? '',
  iusdFa,
  iusdDenom: `move/${iusdFa.replace(/^0x/, '')}`,
  iusdDecimals: parseInt(process.env.IUSD_DECIMALS ?? '6', 10),
}

// Re-export from config for consumers that import from networks.ts
export { CHAIN_ID, RPC_URL, REST_URL, IUSD_FA }
export const INS_CONTRACT = NETWORK.insContract
export const IUSD_DENOM = NETWORK.iusdDenom
export const IUSD_DECIMALS = NETWORK.iusdDecimals
