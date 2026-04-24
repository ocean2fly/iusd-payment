/**
 * iPay API — Central Configuration.
 * Single source of truth for all env vars. Import from here, don't read process.env directly.
 */

// Chain
export const CHAIN_ID = process.env.CHAIN_ID || 'interwoven-1'
export const RPC_URL  = process.env.RPC_URL || ''
export const REST_URL = process.env.REST_URL || ''

// Addresses
export const MODULE_ADDRESS    = process.env.MODULE_ADDRESS || ''
export const IPAY_POOL_ADDRESS = process.env.IPAY_POOL_ADDRESS || ''
export const GIFT_POOL_ADDRESS = process.env.GIFT_POOL_ADDRESS || ''
export const RELAYER_ADDRESS   = process.env.RELAYER_ADDRESS || ''
export const TREASURY_ADDRESS  = process.env.TREASURY_ADDRESS || ''
export const DEPLOYER_ADDRESS  = process.env.DEPLOYER_ADDRESS || ''

// Assets
export const IUSD_FA = process.env.IUSD_FA || ''

// Relayer
export const RELAYER_MNEMONIC = process.env.RELAYER_MNEMONIC || ''
export const RELAYER_PAY_COUNT = parseInt(process.env.RELAYER_PAY_COUNT || '1', 10)
export const RELAYER_GIFT_COUNT = parseInt(process.env.RELAYER_GIFT_COUNT || '1', 10)
export const RELAYER_SWEEP_COUNT = parseInt(process.env.RELAYER_SWEEP_COUNT || '1', 10)
export const RELAYER_MNEMONICS_PAY = process.env.RELAYER_MNEMONICS_PAY || ''
export const RELAYER_MNEMONICS_GIFT = process.env.RELAYER_MNEMONICS_GIFT || ''
export const RELAYER_MNEMONIC_SWEEP = process.env.RELAYER_MNEMONIC_SWEEP || ''

// Security
export const SERVER_SECRET = process.env.SERVER_SECRET || ''
export const JWT_SECRET    = process.env.JWT_SECRET || process.env.ADMIN_KEY || ''
export const ADMIN_KEY     = process.env.ADMIN_KEY || ''

// App
export const APP_URL = process.env.APP_URL || 'https://iusd-pay.xyz'
export const PORT    = parseInt(process.env.PORT || '3001', 10)
