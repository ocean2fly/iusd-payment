/**
 * Gift Claim Worker — processes queued gift claims via the gift RelayerPool.
 *
 * Scans gift_claim_queue for 'queued' or retryable 'failed' entries,
 * derives secrets, and submits sponsored claim transactions.
 *
 * Uses PostgreSQL FOR UPDATE SKIP LOCKED to prevent multiple workers
 * from processing the same claim.
 */

import { getPgPool } from '../../db/postgres'
import { getDb } from '../../db'
import { deriveSlotSecret, deriveProof } from '../../lib/giftCrypto'
import { sponsorClaimSlot, sponsorClaimDirect } from './giftRelayer'
import { fetchSlotsSummary, fetchPacket, fetchRecipientBlob } from '../../lib/giftChainQuery'
import { decryptPayloadForRecipient } from '../security/encryption'

// ── Recipient blob TLV (must mirror routes/user/gift.ts) ─────────────
function deserializeRecipientBlob(blob: Buffer): {
  keyForUser: Buffer
  keyForAdmin: Buffer
  ciphertext: Buffer
} {
  let off = 0
  const version = blob.readUInt8(off); off += 1
  if (version !== 0x01) {
    throw new Error(`unsupported recipient blob version: ${version}`)
  }
  const readLP = (): Buffer => {
    const len = blob.readUInt16BE(off); off += 2
    const out = Buffer.from(blob.subarray(off, off + len)); off += len
    return out
  }
  return { keyForUser: readLP(), keyForAdmin: readLP(), ciphertext: readLP() }
}

const SCAN_INTERVAL_MS = 1_500  // 1.5 seconds — faster pickup of new claims
const MAX_RETRIES = 3

/**
 * Fire-and-forget trigger used by the claim routes to kick the worker
 * immediately after inserting a new queue row. Without this, newly
 * queued claims had to wait for the next SCAN_INTERVAL_MS tick (up to
 * 3s previously). The worker's FOR UPDATE SKIP LOCKED transaction
 * makes it safe for the passive scan and this immediate call to race
 * — at most one of them actually processes each row.
 */
export function triggerGiftClaimNow(): void {
  processNextClaim().catch(err => {
    console.error('[GiftClaimWorker] triggerGiftClaimNow error:', err?.message ?? err)
  })
}

/**
 * Recover stuck 'processing' rows on worker startup.
 *
 * A row can get stuck in 'processing' if the API process crashes or
 * pm2 restarts between `UPDATE status='processing'` and the final
 * `UPDATE status='claimed'/'failed'`. We reset any row that's been
 * sitting in 'processing' for longer than a typical claim (~5 min)
 * back to 'queued' so the next scan picks it up and retries.
 *
 * gift_claim_queue has no `updated_at` column, so we use `created_at`
 * as a proxy. That's fine because the queued → processing transition
 * happens within milliseconds of row creation; a 5-minute window is
 * well past the happy-path latency.
 */
function recoverStuckProcessing(): void {
  try {
    const db = getDb()
    const res = db.prepare(`
      UPDATE gift_claim_queue
         SET status = 'queued'
       WHERE status = 'processing'
         AND created_at::timestamp < (now() - interval '5 minutes')
    `).run()
    if (res.changes > 0) {
      console.warn(`[GiftClaimWorker] Recovered ${res.changes} stuck 'processing' row(s) → 'queued'`)
    }
  } catch (err: any) {
    console.error('[GiftClaimWorker] Startup recovery failed:', err?.message)
  }
}

export function startGiftClaimWorker(): void {
  console.log('[GiftClaimWorker] Started (interval: 3s)')

  const run = async () => {
    try {
      await processNextClaim()
    } catch (err) {
      console.error('[GiftClaimWorker] Error:', err)
    }
  }

  // Initial delay to let relayer pools initialize
  setTimeout(() => {
    recoverStuckProcessing()
    run()
    setInterval(run, SCAN_INTERVAL_MS)
    // Periodically retry recovery in case of mid-run crashes
    setInterval(recoverStuckProcessing, 5 * 60_000)
  }, 5_000)
}

async function processNextClaim(): Promise<void> {
  const pool = getPgPool()

  // Atomically pick one queued claim using FOR UPDATE SKIP LOCKED
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(`
      SELECT id, packet_id, slot_index, claimer_address, retry_count
      FROM gift_claim_queue
      WHERE status = 'queued'
         OR (status = 'failed' AND retry_count < $1)
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [MAX_RETRIES])

    if (rows.length === 0) {
      await client.query('COMMIT')
      return
    }

    const job = rows[0]

    // Mark as processing
    await client.query(
      `UPDATE gift_claim_queue SET status = 'processing' WHERE id = $1`,
      [job.id]
    )
    await client.query('COMMIT')

    // Process outside the transaction lock. Wrap in a final safety net
    // so ANY uncaught exception from executeClaimJob (DB errors during
    // lookup, null pointer bugs, RelayerPool throwing, etc.) falls
    // through to markFailed instead of leaving the row stuck in
    // 'processing'. Without this, the row orphans until either the
    // startup recovery picks it up or a human intervenes.
    try {
      await executeClaimJob(job)
    } catch (err: any) {
      console.error(`[GiftClaimWorker] 💥 uncaught in executeClaimJob(${job.id}):`, err?.message)
      try {
        markFailed(job, `uncaught: ${err?.message ?? String(err)}`)
      } catch (markErr: any) {
        console.error('[GiftClaimWorker] markFailed also threw:', markErr?.message)
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function executeClaimJob(job: {
  id: number
  packet_id: string
  slot_index: number
  claimer_address: string
  retry_count: number
}): Promise<void> {
  const db = getDb()

  // Get packet info
  const packet = db.prepare(
    'SELECT claim_key_hex, mode, recipient_address FROM gift_v3_packets WHERE packet_id = ?'
  ).get(job.packet_id) as any

  const isDirect = packet?.mode === 0

  // Direct gift — fetch recipient_blob from chain, decrypt with the
  // *intended recipient's* viewing privkey (server-custodial), extract
  // the bearer claim_key, then call sponsor_claim_direct.
  if (isDirect) {
    console.log(`[GiftClaimWorker] Processing direct ${job.packet_id.slice(0, 16)} for ${job.claimer_address.slice(0, 10)}`)

    // 1. Pull recipient_blob from chain
    let blobHex: string
    try {
      const onchain = await fetchRecipientBlob(job.packet_id)
      blobHex = onchain.blobHex
      if (!blobHex) {
        markFailed(job, 'recipient_blob is empty on chain (Group packet?)')
        return
      }
    } catch (err: any) {
      markFailed(job, `fetchRecipientBlob failed: ${err.message}`)
      return
    }

    // 2. Look up the intended recipient's viewing_privkey_enc.
    //    The DB row was written by /gift/send and holds the plaintext
    //    recipient address (DB-side only; on chain it's encrypted).
    if (!packet?.recipient_address) {
      markFailed(job, 'gift_v3_packets row missing recipient_address')
      return
    }
    const recipientRow = db.prepare(
      'SELECT viewing_privkey_enc FROM accounts WHERE lower(address) = lower(?)'
    ).get(packet.recipient_address) as any
    if (!recipientRow?.viewing_privkey_enc) {
      markFailed(job, `recipient ${packet.recipient_address.slice(0, 12)} has no viewing key`)
      return
    }

    // 3. Decrypt blob → recover claim_key
    let claimKeyHex: string
    try {
      const parts = deserializeRecipientBlob(Buffer.from(blobHex, 'hex'))
      const payload = decryptPayloadForRecipient(
        parts.ciphertext,
        parts.keyForUser,
        recipientRow.viewing_privkey_enc,
      )
      claimKeyHex = payload.claimKey
      if (!claimKeyHex) {
        markFailed(job, 'decrypted payload missing claimKey')
        return
      }
    } catch (err: any) {
      markFailed(job, `recipient blob decrypt failed: ${err.message}`)
      return
    }

    // 4. Submit sponsor_claim_direct with bearer claim_key.
    //    The chain verifies sha2_256(claim_key) == claim_key_hash and
    //    transfers funds to job.claimer_address.
    const result = await sponsorClaimDirect(job.packet_id, claimKeyHex, job.claimer_address)

    if (result.success) {
      let amount: number | null = null
      try { const p = await fetchPacket(job.packet_id); amount = p.amount } catch {}

      db.prepare(`UPDATE gift_claim_queue SET status = 'claimed', tx_hash = ?, amount = ?, claimed_at = now()::text WHERE id = ?`)
        .run(result.txHash, amount, job.id)
      try {
        db.prepare(`INSERT INTO gift_v3_claims (packet_id, slot_index, claimer_address, amount, claim_tx_hash) VALUES (?, 0, ?, ?, ?) ON CONFLICT DO NOTHING`)
          .run(job.packet_id, job.claimer_address, amount, result.txHash)
      } catch {}
      try { db.prepare(`UPDATE gift_v3_packets SET status = 'completed' WHERE packet_id = ?`).run(job.packet_id) } catch {}
      console.log(`[GiftClaimWorker] ✅ direct ${job.packet_id.slice(0, 16)} claimed → tx=${result.txHash}`)
    } else {
      markFailed(job, result.error || 'Unknown error')
    }
    return
  }

  // Group gift — derive secrets
  if (!packet?.claim_key_hex) {
    console.error(`[GiftClaimWorker] No claim_key for packet ${job.packet_id.slice(0, 16)}`)
    markFailed(job, 'Missing claim key in DB')
    return
  }

  const claimKeyBuf = Buffer.from(packet.claim_key_hex, 'hex')
  const slotSecret = deriveSlotSecret(claimKeyBuf, job.slot_index)
  const proof = deriveProof(slotSecret, job.claimer_address)

  console.log(`[GiftClaimWorker] Processing ${job.packet_id.slice(0, 16)} slot=${job.slot_index} for ${job.claimer_address.slice(0, 10)}`)

  const result = await sponsorClaimSlot(
    job.packet_id,
    job.slot_index,
    slotSecret.toString('hex'),
    proof.toString('hex'),
    job.claimer_address,
  )

  if (result.success) {
    // Fetch amount from chain
    let amount: number | null = null
    let packetStatus: 'active' | 'completed' = 'active'
    try {
      const slots = await fetchSlotsSummary(job.packet_id)
      amount = slots.amounts?.[job.slot_index] ?? null
      const chainPacket = await fetchPacket(job.packet_id)
      packetStatus = chainPacket.claimed_slots >= chainPacket.total_slots ? 'completed' : 'active'
    } catch {}

    // Update queue entry
    db.prepare(`
      UPDATE gift_claim_queue
      SET status = 'claimed', tx_hash = ?, amount = ?, claimed_at = now()::text
      WHERE id = ?
    `).run(result.txHash, amount, job.id)

    // Write to legacy claims table for backward compat
    try {
      db.prepare(`
        INSERT INTO gift_v3_claims (packet_id, slot_index, claimer_address, amount, claim_tx_hash)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `).run(job.packet_id, job.slot_index, job.claimer_address, amount, result.txHash)
    } catch {}

    // Update packet status
    try {
      db.prepare(`UPDATE gift_v3_packets SET status = ? WHERE packet_id = ?`).run(packetStatus, job.packet_id)
    } catch {}

    console.log(`[GiftClaimWorker] ✅ ${job.packet_id.slice(0, 16)} slot=${job.slot_index} claimed → tx=${result.txHash}`)
  } else {
    markFailed(job, result.error || 'Unknown error')
  }
}

function markFailed(job: { id: number; packet_id: string; slot_index: number; retry_count: number }, error: string): void {
  const db = getDb()
  const newRetry = job.retry_count + 1

  if (newRetry >= MAX_RETRIES) {
    db.prepare(`
      UPDATE gift_claim_queue SET status = 'dead_letter', retry_count = ?, last_error = ? WHERE id = ?
    `).run(newRetry, error, job.id)
    console.error(`[GiftClaimWorker] 💀 ${job.packet_id.slice(0, 16)} slot=${job.slot_index} dead_letter after ${newRetry} tries: ${error}`)
  } else {
    db.prepare(`
      UPDATE gift_claim_queue SET status = 'failed', retry_count = ?, last_error = ? WHERE id = ?
    `).run(newRetry, error, job.id)
    console.warn(`[GiftClaimWorker] ↩ ${job.packet_id.slice(0, 16)} slot=${job.slot_index} retry ${newRetry}/${MAX_RETRIES}: ${error}`)
  }
}
