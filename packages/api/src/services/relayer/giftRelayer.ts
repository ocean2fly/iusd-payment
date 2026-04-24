/**
 * Gift V3 Relayer — gas sponsorship for claims + expiry sweep.
 * Uses the gift RelayerPool for claims and sweep RelayerPool for expiry.
 */

import { getGiftPoolAddress, getModuleAddress } from '../../shared/contract-config'
import { getGiftPool, getSweepPool } from './index'
import { getDb } from '../../db'
import type { MoveArg } from '../../lib/RelayerInstance'
import { bech32 } from 'bech32'

const SWEEP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function poolArg(): MoveArg {
  return { type: 'object', value: getGiftPoolAddress() }
}

function toHex(addr: string): string {
  if (addr.startsWith('0x')) return addr.toLowerCase()
  const decoded = bech32.decode(addr)
  return '0x' + Buffer.from(bech32.fromWords(decoded.words)).toString('hex')
}

// ── Sponsored Operations ──────────────────────────────────────────

export async function sponsorClaimDirect(
  packetIdHex: string,
  claimKeyHex: string,
  recipientAddress: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const pool = getGiftPool()
  const pid = packetIdHex.replace(/^0x/i, '').toLowerCase()
  const ck = claimKeyHex.replace(/^0x/i, '').toLowerCase()
  console.log(`[GiftRelayer] sponsor_claim_direct ${pid.slice(0, 16)}`)

  return pool.submit(
    {
      moduleAddress: getModuleAddress(),
      moduleName: 'gift_v3',
      functionName: 'sponsor_claim_direct',
      args: [
        poolArg(),
        { type: 'raw_hex', value: pid },
        { type: 'raw_hex', value: ck },
        { type: 'address', value: toHex(recipientAddress) },
      ],
    },
    'iPay gift claim',
  )
}

export async function sponsorClaimSlot(
  packetIdHex: string,
  slotIndex: number,
  slotSecretHex: string,
  proofHex: string,
  recipientAddress: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const pool = getGiftPool()
  const pid = packetIdHex.replace(/^0x/i, '').toLowerCase()
  console.log(`[GiftRelayer] sponsor_claim_slot ${pid.slice(0, 16)} slot=${slotIndex}`)

  return pool.submit(
    {
      moduleAddress: getModuleAddress(),
      moduleName: 'gift_v3',
      functionName: 'sponsor_claim_slot',
      args: [
        poolArg(),
        { type: 'raw_hex', value: pid },
        { type: 'u64', value: slotIndex },
        { type: 'raw_hex', value: slotSecretHex.replace(/^0x/, '') },
        { type: 'raw_hex', value: proofHex.replace(/^0x/, '') },
        { type: 'address', value: toHex(recipientAddress) },
      ],
    },
    'iPay gift slot claim',
  )
}

export async function expireAndRefund(
  packetIdHex: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const pool = getSweepPool()
  const pid = packetIdHex.replace(/^0x/i, '').toLowerCase()
  console.log(`[GiftRelayer] expire_and_refund ${pid.slice(0, 16)}`)

  return pool.submit(
    {
      moduleAddress: getModuleAddress(),
      moduleName: 'gift_v3',
      functionName: 'expire_and_refund',
      args: [
        poolArg(),
        { type: 'raw_hex', value: pid },
      ],
    },
    'iPay gift expire',
  )
}

// ── Expiry Sweep ──────────────────────────────────────────────────

async function sweepExpiredGifts() {
  try {
    const db = getDb()
    const now = new Date().toISOString()
    const expired = db.prepare(
      `SELECT packet_id FROM gift_v3_packets WHERE status = 'active' AND expires_at < ? LIMIT 10`
    ).all(now) as any[]

    for (const row of expired) {
      console.log(`[GiftRelayer] Expiring packet ${row.packet_id.slice(0, 16)}...`)
      const result = await expireAndRefund(row.packet_id)
      if (result.success) {
        db.prepare(`UPDATE gift_v3_packets SET status = 'expired' WHERE packet_id = ?`)
          .run(row.packet_id)
      }
    }
  } catch (err) {
    console.error('[GiftRelayer] Sweep error:', err)
  }
}

export function startGiftRelayer(): void {
  console.log('[GiftRelayer] Starting expiry sweep (interval: 5min)')
  setInterval(sweepExpiredGifts, SWEEP_INTERVAL_MS)
  sweepExpiredGifts().catch(() => {})
}
