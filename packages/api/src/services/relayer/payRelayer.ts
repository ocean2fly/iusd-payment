/**
 * Pay Relayer — gas sponsorship for pay_v3 claims + fee grants.
 * Uses the pay RelayerPool for parallel processing.
 */

import { MODULE_ADDRESS, REST_URL } from '../../shared/config'
import { getPoolAddress } from '../../shared/contract-config'
import { getPayPool } from './index'
import type { MoveArg } from '../../lib/RelayerInstance'
import { bech32 } from 'bech32'
import { hashPaymentId } from '../../lib/payKeyHash'

// ═══════════════════════════════════════════════════════════════════════════
// Gas Sponsorship
// ═══════════════════════════════════════════════════════════════════════════

function bech32ToHex(addr: string): string {
  if (addr.startsWith('0x')) return addr.toLowerCase()
  const decoded = bech32.decode(addr)
  return '0x' + Buffer.from(bech32.fromWords(decoded.words)).toString('hex')
}

export async function sponsorClaim(
  paymentId: string,
  claimKey: string,
  recipientAddress: string,
  /**
   * Optional override for the on-chain key. When set, it's sent
   * verbatim as the contract's payment_id arg (no hashing). Used by
   * autoClaim for pre-hash legacy entries still keyed by plain.
   * Omit for the normal post-hash path.
   */
  rawChainKey?: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const pool = getPayPool()

  // Chain-side payment_id is sha256(plainPaymentId) for post-hash entries.
  // Caller may override with the plain id for legacy entries deposited
  // before the pay hash rollout.
  const pid = (rawChainKey ?? hashPaymentId(paymentId)).replace(/^0x/i, '').toLowerCase()
  const ck = claimKey.replace(/^0x/i, '').toLowerCase()
  const recipHex = bech32ToHex(recipientAddress)
  const poolAddr = getPoolAddress()

  console.log(`[PayRelayer] sponsor_claim ${pid.slice(0, 16)} (plain=${paymentId.replace(/^0x/i, '').slice(0, 12)}${rawChainKey ? ' LEGACY' : ''})`)

  return pool.submit(
    {
      moduleAddress: MODULE_ADDRESS,
      moduleName: 'pay_v3',
      functionName: 'sponsor_claim',
      args: [
        { type: 'object', value: poolAddr },
        { type: 'raw_hex', value: pid },
        { type: 'raw_hex', value: ck },
        { type: 'address', value: recipHex },
      ],
    },
    'iPay sponsor_claim',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Payment Notifications (WebSocket)
// ═══════════════════════════════════════════════════════════════════════════

const wsConnections = new Map<string, Set<any>>()

export function registerWsConnection(userAddress: string, ws: any): void {
  const addr = userAddress.toLowerCase()
  if (!wsConnections.has(addr)) wsConnections.set(addr, new Set())
  wsConnections.get(addr)!.add(ws)
  ws.on('close', () => { wsConnections.get(addr)?.delete(ws) })
}

export function notifyNewPayment(recipientAddress: string, payment: {
  paymentId: string; amount: string; senderShortId?: string; memo?: string
}): void {
  broadcast(recipientAddress, 'NEW_PAYMENT', payment)
}

export function notifyPaymentClaimed(senderAddress: string, payment: {
  paymentId: string; amount: string
}): void {
  broadcast(senderAddress, 'PAYMENT_CLAIMED', payment)
}

function broadcast(address: string, type: string, data: any): void {
  const conns = wsConnections.get(address.toLowerCase())
  if (!conns || conns.size === 0) return
  const msg = JSON.stringify({ type, data })
  conns.forEach(ws => { try { ws.send(msg) } catch {} })
}

// ═══════════════════════════════════════════════════════════════════════════
// Fee Grant
// ═══════════════════════════════════════════════════════════════════════════

export async function grantFeeAllowance(
  userBech32Address: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const pool = getPayPool()
  const granterAddr = pool.getAddresses()[0]
  if (!granterAddr) return { success: false, error: 'No pay relayer available' }

  try {
    // Check if grant already exists
    const checkUrl = `${REST_URL}/cosmos/feegrant/v1beta1/allowance/${granterAddr}/${userBech32Address}`
    try {
      const checkRes = await fetch(checkUrl)
      if (checkRes.ok) {
        const data = await checkRes.json() as any
        if (data.allowance) {
          console.log('[FeeGrant] Already exists for', userBech32Address)
          return { success: true, txHash: 'already-granted' }
        }
      }
    } catch {}

    console.log(`[FeeGrant] Granting to ${userBech32Address} from ${granterAddr}`)

    return pool.submitFeeGrant(
      userBech32Address,
      '1000000',
      ['/initia.move.v1.MsgExecute', '/initia.move.v1.MsgExecuteJSON'],
      'iPay fee grant',
    )
  } catch (e: any) {
    console.error('[FeeGrant] Error:', e.message)
    return { success: false, error: e.message }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Backward compat — getRelayerInfo
// ═══════════════════════════════════════════════════════════════════════════

export function getRelayerInfo(): { address: string; bech32: string } | null {
  try {
    const pool = getPayPool()
    const addr = pool.getAddresses()[0]
    return addr ? { address: '', bech32: addr } : null
  } catch {
    return null
  }
}
