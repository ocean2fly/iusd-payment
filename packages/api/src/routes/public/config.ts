/**
 * Config Routes - /v1/config
 * 
 * CONTRACT ADDRESS: Always from environment variables.
 */
import type { FastifyInstance } from 'fastify'
import { getPoolAddress, getGiftPoolAddress } from '../../shared/contract-config'
import { getRelayerServiceAddress } from '../../services/relayer'
import {
  CHAIN_ID,
  RPC_URL,
  REST_URL,
  IUSD_FA,
  MODULE_ADDRESS,
  RELAYER_MNEMONIC,
} from '../../shared/config'

// Re-export from shared/config so existing consumers don't break
export { CHAIN_ID, RPC_URL, REST_URL, IUSD_FA, MODULE_ADDRESS }

// iUSD Fungible Asset (derived)
export const IUSD_DENOM = `move/${IUSD_FA.replace(/^0x/, '').toLowerCase()}`
export const IUSD_DECIMALS = parseInt(process.env.IUSD_DECIMALS || '6', 10)

// Fee config
export const FEE_BPS = 5
export const FEE_CAP = 5_000_000
export const MIN_FEE = 1_000

// Timeouts (in seconds)
export const TIMEOUTS = {
  PAYMENT: 86400,      // 24h
  CLAIM: 604800,       // 7d
  CONFIRM: 86400,      // 24h
  REFUND: 259200,      // 3d
}

// Order state names
export const ORDER_STATE_NAMES: Record<number, string> = {
  0: 'Created',
  1: 'Pending Payment',
  2: 'Funded',
  3: 'Pending Claim',
  4: 'Claimed',
  5: 'Confirmed',
  6: 'Refund Requested',
  7: 'Refunded',
  8: 'Intervened',
}

// Order types
export const PAYMENT_TYPES = {
  TRANSFER: 1,
  REQUEST: 2,
  SUBSCRIPTION: 3,
  GIFT: 4,
  MULTI_APPROVAL: 5,
}


// Admin public key for encryption
export const ADMIN_PUBKEY = process.env.ADMIN_PUBKEY || '04ebf3e2af893b442e3823acb290c76d90c00e3956c7ff336b603aa3b800bb179270977bc8ecf59a3a17d76da8574031ba336554ff1547925b7a3fc6d1b6b2b2ba'

// ═══════════════════════════════════════════════════════════════════════════
// Dynamic Config Getters (from environment)
// ═══════════════════════════════════════════════════════════════════════════

// Re-export for other modules
export { getPoolAddress }

// ═══════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════

export default async function configRoutes(app: FastifyInstance) {
  /**
   * GET /v1/config
   * Returns current configuration including contract address
   */
  app.get('/', async () => {
    const payPool = getPoolAddress()
    const giftPool = getGiftPoolAddress()
    const moduleAddr = MODULE_ADDRESS

    return {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      restUrl: REST_URL,
      contract: {
        moduleAddress: moduleAddr,
        payPool,
        giftPool,
        moduleName: { pay: 'pay_v3', gift: 'gift_v3' },
      },
      iusd: {
        fa: IUSD_FA,
        denom: IUSD_DENOM,
        decimals: IUSD_DECIMALS,
      },
      fee: {
        bps: FEE_BPS,
        cap: FEE_CAP,
        min: MIN_FEE,
      },
      timeouts: TIMEOUTS,
      orderStates: ORDER_STATE_NAMES,
      paymentTypes: PAYMENT_TYPES,
      adminPubKey: ADMIN_PUBKEY,
      relayer: getRelayerServiceAddress() || undefined,
    }
  })

  /**
   * GET /v1/config/contract
   * Returns just the contract address (for quick checks)
   */
  app.get('/contract', async () => {
    const addr = await getPoolAddress()
    return { address: addr }
  })

}

// ═══════════════════════════════════════════════════════════════════════════
// Relayer Config (from environment)
// ═══════════════════════════════════════════════════════════════════════════

export const CHAIN_REST_URL = REST_URL
export { RELAYER_MNEMONIC }
export const RELAYER_POLL_INTERVAL = parseInt(process.env.RELAYER_POLL_INTERVAL || '30000', 10)

// INS Contract
export const INS_CONTRACT_ADDRESS = '0x42cd8467b1c86e59bf319e5664a09b6b5840bb3fac64f5ce690b5041c530565a'
