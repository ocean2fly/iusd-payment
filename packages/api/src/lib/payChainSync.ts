/**
 * Payment chain sync — reads on-chain payment status and updates DB cache.
 *
 * Called when frontend detects DB status is stale vs chain state.
 * Only syncs non-terminal payments (not REVOKED/REFUNDED/EXPIRED).
 */

import { getDb } from '../db'
import { MODULE_ADDRESS, REST_URL, IPAY_POOL_ADDRESS } from '../shared/config'
import { hashPaymentId } from './payKeyHash'

// Chain status codes from pay_v3 contract
const CHAIN_STATUS = {
  PENDING_CLAIM: 2,
  CONFIRMED: 3,
  REVOKED: 5,
  REFUNDED: 6,
  EXPIRED: 7,
} as const

const TERMINAL_STATUSES = new Set([CHAIN_STATUS.REVOKED, CHAIN_STATUS.REFUNDED, CHAIN_STATUS.EXPIRED])

function uleb128(value: number): Buffer {
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>= 7
    if (value > 0) byte |= 0x80
    bytes.push(byte)
  } while (value > 0)
  return Buffer.from(bytes)
}

async function fetchChainPaymentStatus(paymentId: string): Promise<number | null> {
  try {
    const pool = IPAY_POOL_ADDRESS.replace(/^0x/i, '').toLowerCase()
    // Chain-side payment_id is sha256(plain) — see lib/payKeyHash.ts
    const pid = hashPaymentId(paymentId)

    const poolB64 = Buffer.from(pool.padStart(64, '0'), 'hex').toString('base64')
    const pidBytes = Buffer.from(pid, 'hex')
    const pidBcs = Buffer.concat([uleb128(pidBytes.length), pidBytes])
    const pidB64 = pidBcs.toString('base64')

    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/pay_v3/view_functions/get_payment_full`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [poolB64, pidB64] }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: string }
    if (!json.data) return null
    const parsed = JSON.parse(json.data)
    return Number(parsed[0])
  } catch {
    return null
  }
}

/**
 * Sync a single payment's chain status to DB.
 * Returns the chain status if synced, or null if no update needed.
 */
export async function syncPaymentFromChain(paymentId: string): Promise<{ synced: boolean; chainStatus?: number }> {
  const pid = paymentId.replace(/^0x/i, '').toLowerCase()
  const chainStatus = await fetchChainPaymentStatus(pid)
  if (chainStatus === null) return { synced: false }

  const db = getDb()

  // Update payment_intents auto_claim_status based on chain status
  if (chainStatus === CHAIN_STATUS.CONFIRMED) {
    // Claimed on chain — mark as claimed in DB
    db.prepare(`
      UPDATE payment_intents
      SET auto_claim_status = CASE
            WHEN auto_claim_status IN ('pending', 'failed', 'processing') THEN 'claimed'
            ELSE auto_claim_status
          END,
          auto_claimed_at = COALESCE(auto_claimed_at, now()::text)
      WHERE payment_id = ?
    `).run(pid)
  } else if (chainStatus === CHAIN_STATUS.REVOKED) {
    db.prepare(`
      UPDATE payment_intents SET auto_claim_status = 'skipped', last_error = 'Revoked on-chain'
      WHERE payment_id = ? AND auto_claim_status IN ('pending', 'failed', 'processing')
    `).run(pid)
  } else if (chainStatus === CHAIN_STATUS.REFUNDED) {
    db.prepare(`
      UPDATE payment_intents SET auto_claim_status = 'skipped', last_error = 'Refunded on-chain'
      WHERE payment_id = ? AND auto_claim_status IN ('pending', 'failed', 'processing')
    `).run(pid)
  } else if (chainStatus === CHAIN_STATUS.EXPIRED) {
    db.prepare(`
      UPDATE payment_intents SET auto_claim_status = 'skipped', last_error = 'Expired on-chain'
      WHERE payment_id = ? AND auto_claim_status IN ('pending', 'failed', 'processing')
    `).run(pid)
  }

  // Update invoice_transactions chain_status
  try {
    db.prepare(`
      UPDATE invoice_transactions SET chain_status = ?
      WHERE lower(replace(payment_id, '0x', '')) = ?
        AND (chain_status IS NULL OR chain_status != ?)
    `).run(chainStatus, pid, chainStatus)
  } catch {}

  // If claimed, also update invoice status
  if (chainStatus === CHAIN_STATUS.CONFIRMED) {
    try {
      db.prepare(`
        UPDATE invoice_tokens SET status = 'paid'
        WHERE token IN (SELECT invoice_token FROM invoice_transactions WHERE lower(replace(payment_id, '0x', '')) = ?)
          AND status != 'paid'
      `).run(pid)
    } catch {}
  }

  return { synced: true, chainStatus }
}
