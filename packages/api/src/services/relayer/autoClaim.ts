/**
 * autoClaim.ts - Auto claim scheduler
 *
 * 当支付确认后，立即自动代收款方执行 sponsor_claim()，无需手动操作。
 * 扫描间隔：每 2 分钟
 */
import { getDb } from '../../db'
import { decryptPayloadForRecipient } from '../security/encryption'
import { sponsorClaim } from './payRelayer'
import { IPAY_POOL_ADDRESS, MODULE_ADDRESS, REST_URL } from '../../shared/config'
import { hashPaymentId } from '../../lib/payKeyHash'

// ── 可配置常量 ──────────────────────────────────────────────
export const AUTO_CLAIM_SCAN_INTERVAL_MS = 30 * 1000   // 30 秒
export const AUTO_CLAIM_MAX_RETRIES = 3  // 最大重试次数（超过后进 dead_letter）
// ────────────────────────────────────────────────────────────

/** 计算 auto_claim_at — 立即 claim */
export function calcAutoClaimAt(): string {
  return new Date().toISOString()
}

/** BCS encode vector<u8> with uleb128 length prefix → base64 */
function toVecB64(hex: string): string {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex')
  const len = bytes.length
  const prefix: number[] = []
  let v = len
  do {
    let byte = v & 0x7f
    v >>= 7
    if (v > 0) byte |= 0x80
    prefix.push(byte)
  } while (v > 0)
  return Buffer.concat([Buffer.from(prefix), bytes]).toString('base64')
}

/** Low-level: query get_payment_full by a raw hex key (no hashing). */
async function fetchPaymentFullByRawKey(rawKeyHex: string): Promise<any[] | null> {
  try {
    const poolB64 = Buffer.from(IPAY_POOL_ADDRESS.replace(/^0x/, '').padStart(64, '0'), 'hex').toString('base64')
    const pidB64  = toVecB64(rawKeyHex)
    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/pay_v3/view_functions/get_payment_full`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [poolB64, pidB64] }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: string }
    if (!json.data) return null
    return JSON.parse(json.data)
  } catch { return null }
}

/**
 * 从链上读取支付的完整数据（含 key_for_recipient）
 *
 * Resilient to the pay hash rollout: tries sha256(plain) first (current
 * frontend's chain key) and falls back to plain (pre-hash legacy
 * entries). Mirrors the same fallback logic in routes/user/account.ts
 * getChainPayment + lib/payChainStatus.ts fetchPaymentFullFromChain.
 *
 * Also: when the legacy branch hits, we need sponsor_claim to pass
 * the plain payment_id too (not the hash) — see resolvePaymentOnChainKey
 * below.
 */
async function fetchPaymentFull(paymentId: string): Promise<any[] | null> {
  const plainHex = paymentId.replace(/^0x/i, '')
  const hashed = hashPaymentId(plainHex)
  const hit = await fetchPaymentFullByRawKey(hashed)
  if (Array.isArray(hit) && (Number(hit[0]) !== 0 || String(hit[1]) !== '0')) return hit
  return await fetchPaymentFullByRawKey(plainHex)
}

/**
 * Figure out which on-chain key was used for this payment. Returns the
 * hashed form for post-hash deposits, the plain form for pre-hash
 * legacy ones. Used to pick the right key for sponsor_claim.
 */
async function resolvePaymentOnChainKey(paymentId: string): Promise<string | null> {
  const plainHex = paymentId.replace(/^0x/i, '')
  const hashed = hashPaymentId(plainHex)
  const hit = await fetchPaymentFullByRawKey(hashed)
  if (Array.isArray(hit) && (Number(hit[0]) !== 0 || String(hit[1]) !== '0')) return hashed
  const plainHit = await fetchPaymentFullByRawKey(plainHex)
  if (Array.isArray(plainHit) && (Number(plainHit[0]) !== 0 || String(plainHit[1]) !== '0')) return plainHex
  return null
}

interface PendingIntent {
  payment_id:        string
  recipient_address: string
  auto_claim_at:     string
  retry_count?:      number
}

/** Write a trace entry for audit / observability */
function writeTrace(
  db: ReturnType<typeof getDb>,
  paymentId: string,
  attempt: number,
  outcome: 'claimed' | 'failed' | 'dead_letter' | 'skipped',
  error?: string | null,
  txHash?: string | null
) {
  try {
    db.prepare(`
      INSERT INTO claim_job_traces (payment_id, attempt, outcome, error, tx_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run(paymentId, attempt, outcome, error ?? null, txHash ?? null)
  } catch { /* non-critical */ }
}

export async function runAutoClaimV2(
  log = { info: console.log, warn: console.warn, error: console.error }
): Promise<void> {
  const db = getDb()

  // 查找所有已到期且还未 auto-claim 的支付意向（含重试：failed + retry_count < MAX）
  const pending = db.prepare(`
    SELECT payment_id, recipient_address, auto_claim_at, invoice_type, retry_count
    FROM payment_intents
    WHERE (
        auto_claim_status = 'pending'
        OR (auto_claim_status = 'failed' AND COALESCE(retry_count, 0) < ${AUTO_CLAIM_MAX_RETRIES})
      )
      AND recipient_address IS NOT NULL
      AND auto_claim_at IS NOT NULL
      AND auto_claim_at <= now()::text
    ORDER BY
      CASE WHEN invoice_type = 'merchant' THEN 0 ELSE 1 END,
      auto_claim_at ASC
    LIMIT 20
  `).all() as PendingIntent[]

  if (pending.length === 0) return
  log.info(`[auto-claim-v2] ${pending.length} payment(s) ready for auto-claim`)

  // Each sponsorClaim() call is routed to a RelayerPool instance with its own
  // serial queue, so multiple claims can be submitted concurrently without
  // nonce conflicts. The pool handles waiting for tx confirmation internally.
  for (const row of pending) {
    const { payment_id, recipient_address } = row

    try {
      // 1. 从链上读取支付数据
      const payData = await fetchPaymentFull(payment_id)
      if (!payData) {
        log.warn(`[auto-claim-v2] ${payment_id.slice(0,12)}: chain fetch failed, skip`)
        continue
      }

      // chain struct: [status, amount, fee, sender, recipient, createdAt, expiresAt, ciphertext, keyForSender, keyForRecipient, claimKeyHash]
      const [chainStatus, , , , onChainRecipient, , , ciphertextHex, , keyForRecipientHex] = payData

      // 只处理 PENDING_CLAIM (status=2)
      if (Number(chainStatus) !== 2) {
        log.info(`[auto-claim-v2] ${payment_id.slice(0,12)}: status=${chainStatus} (not PENDING), marking done`)
        db.prepare(`UPDATE payment_intents SET auto_claim_status='skipped' WHERE payment_id=?`).run(payment_id)
        writeTrace(db, payment_id, (row.retry_count ?? 0) + 1, 'skipped', `chain status=${chainStatus}`)
        continue
      }

      if (!keyForRecipientHex || !ciphertextHex) {
        log.warn(`[auto-claim-v2] ${payment_id.slice(0,12)}: missing keyForRecipient or ciphertext on chain`)
        continue
      }

      // ── Security note ──────────────────────────────────────────────────────
      // raw[4] = recipient_cooked (hash of recipient viewing pubkey), not the address.
      // Real security comes from decryption: if decryptPayloadForRecipient() succeeds,
      // we hold the correct viewing private key for the intended recipient.
      // No address comparison needed here; wrong key → decryption throws → skip.

      // 2. 从 DB 获取收款方的 viewing_privkey_enc
      const recipientRow = db.prepare(
        'SELECT viewing_privkey_enc, default_claim_address FROM accounts WHERE address = ?'
      ).get(recipient_address) as any

      if (!recipientRow?.viewing_privkey_enc) {
        log.warn(`[auto-claim-v2] ${payment_id.slice(0,12)}: recipient ${recipient_address.slice(0,10)} has no viewing key`)
        continue
      }

      // 3. 解密 payload → 取出 claimKey
      //    keyForRecipient = ECIES(randomKey, recipientViewingPubKey)
      //    ciphertext = iv(12) || AES-GCM(payload, randomKey) || tag(16)
      //    payload JSON contains { claimKey: "hex32bytes", ... }
      const payload = decryptPayloadForRecipient(
        Buffer.from(ciphertextHex, 'hex'),
        Buffer.from(keyForRecipientHex, 'hex'),
        recipientRow.viewing_privkey_enc
      )

      const claimKeyHex: string = payload.claimKey
      if (!claimKeyHex) {
        log.warn(`[auto-claim-v2] ${payment_id.slice(0,12)}: decrypted payload has no claimKey field`)
        continue
      }

      // 4. claim 目标地址：用户自定义 claim 地址，否则用收款方本身
      const claimToAddress = recipientRow.default_claim_address ?? recipient_address

      // 5. 标记为 processing，防止重复触发
      db.prepare(`UPDATE payment_intents SET auto_claim_status='processing' WHERE payment_id=?`).run(payment_id)

      log.info(`[auto-claim-v2] Claiming ${payment_id.slice(0,12)} → ${claimToAddress.slice(0,10)}`)

      // 6. 调用 relayer sponsor_claim
      //    For pre-hash legacy entries we resolve the actual on-chain
      //    key (plain) and pass it as rawChainKey so sponsor_claim
      //    doesn't hash it. Post-hash entries pass undefined and fall
      //    through to the normal hash path.
      const onChainKey = await resolvePaymentOnChainKey(payment_id)
      const hashedExpected = hashPaymentId(payment_id.replace(/^0x/i, ''))
      const rawOverride = onChainKey && onChainKey !== hashedExpected ? onChainKey : undefined
      const result = await sponsorClaim(payment_id, claimKeyHex, claimToAddress, rawOverride)

      if (result.success) {
        db.prepare(`
          UPDATE payment_intents
          SET auto_claim_status='claimed', auto_claim_tx=?, auto_claimed_at=now()::text, last_error=NULL
          WHERE payment_id=?
        `).run(result.txHash ?? null, payment_id)
        // Sync invoice_transactions so PayLink/History reflect paid state immediately
        db.prepare(`
          UPDATE invoice_transactions
          SET chain_status=3, status='paid', paid_at=COALESCE(paid_at, now()::text)
          WHERE payment_id=?
        `).run(payment_id)
        // Also update invoice_tokens status
        db.prepare(`
          UPDATE invoice_tokens SET status='paid'
          WHERE token IN (SELECT invoice_token FROM invoice_transactions WHERE payment_id=?)
            AND status != 'paid'
        `).run(payment_id)
        writeTrace(db, payment_id, (row.retry_count ?? 0) + 1, 'claimed', null, result.txHash)
        log.info(`[auto-claim-v2] ✅ ${payment_id.slice(0,12)} claimed → tx=${result.txHash}`)
      } else {
        const newRetry = (row.retry_count ?? 0) + 1
        if (newRetry >= AUTO_CLAIM_MAX_RETRIES) {
          db.prepare(`
            UPDATE payment_intents
            SET auto_claim_status='dead_letter', retry_count=?, last_error=?
            WHERE payment_id=?
          `).run(newRetry, result.error ?? 'unknown', payment_id)
          writeTrace(db, payment_id, newRetry, 'dead_letter', result.error)
          log.error(`[auto-claim-v2] 💀 ${payment_id.slice(0,12)} dead-letter after ${newRetry} tries: ${result.error}`)
        } else {
          const backoffSec = Math.pow(2, newRetry) * 5 * 60
          db.prepare(`
            UPDATE payment_intents
            SET auto_claim_status='failed', retry_count=?, last_error=?,
                auto_claim_at=(now() + (? || ' seconds')::interval)::text
            WHERE payment_id=?
          `).run(newRetry, result.error ?? 'unknown', String(Math.round(backoffSec)), payment_id)
          writeTrace(db, payment_id, newRetry, 'failed', result.error)
          log.warn(`[auto-claim-v2] ↩ ${payment_id.slice(0,12)} retry ${newRetry}/${AUTO_CLAIM_MAX_RETRIES} in ${backoffSec/60}min: ${result.error}`)
        }
      }

    } catch (e: any) {
      const newRetry = (row.retry_count ?? 0) + 1
      if (newRetry >= AUTO_CLAIM_MAX_RETRIES) {
        db.prepare(`
          UPDATE payment_intents
          SET auto_claim_status='dead_letter', retry_count=?, last_error=?
          WHERE payment_id=?
        `).run(newRetry, e.message, payment_id)
        writeTrace(db, payment_id, newRetry, 'dead_letter', e.message)
        log.error(`[auto-claim-v2] 💀 ${payment_id.slice(0,12)} dead-letter (exception): ${e.message}`)
      } else {
        const backoffSec = Math.pow(2, newRetry) * 5 * 60
        db.prepare(`
          UPDATE payment_intents
          SET auto_claim_status='failed', retry_count=?, last_error=?,
              auto_claim_at=(now() + (? || ' seconds')::interval)::text
          WHERE payment_id=?
        `).run(newRetry, e.message, String(Math.round(backoffSec)), payment_id)
        writeTrace(db, payment_id, newRetry, 'failed', e.message)
        log.warn(`[auto-claim-v2] ↩ ${payment_id.slice(0,12)} retry ${newRetry}/${AUTO_CLAIM_MAX_RETRIES} in ${backoffSec/60}min: ${e.message}`)
      }
    }
  }
}

/** 启动定时扫描（在 API 服务启动时调用） */
export function startAutoClaimScheduler(): void {
  console.log(`[auto-claim-v2] Scheduler started — immediate claim, scan every ${AUTO_CLAIM_SCAN_INTERVAL_MS/60000}min`)
  // 首次运行延迟 30 秒（等 DB 和 relayer 就绪）
  setTimeout(() => {
    runAutoClaimV2().catch(e => console.error('[auto-claim-v2] initial run error:', e))
    setInterval(() => {
      runAutoClaimV2().catch(e => console.error('[auto-claim-v2] cron error:', e))
    }, AUTO_CLAIM_SCAN_INTERVAL_MS)
  }, 30_000)
}

/** 立即触发单笔 claim（用户点击 "Claim Now" 或需要加急处理时调用） */
export async function triggerClaimNow(paymentId: string): Promise<{ ok: boolean; error?: string; status?: string }> {
  const db = getDb()
  // Look up the intent regardless of status so we can give the caller a
  // meaningful diagnostic instead of swallowing manual clicks when the row
  // already moved past 'pending' (e.g. 'failed' / 'dead_letter' from a
  // previous relayer attempt, or 'claimed' if it already succeeded).
  const intent = db.prepare(
    `SELECT * FROM payment_intents WHERE payment_id=?`
  ).get(paymentId) as any

  if (!intent) {
    return { ok: false, error: 'Payment intent not found' }
  }

  if (intent.auto_claim_status === 'claimed') {
    return { ok: true, status: 'already-claimed' }
  }

  if (intent.auto_claim_status === 'processing') {
    // Relayer is already working on it — nothing to do, just acknowledge.
    return { ok: true, status: 'in-progress' }
  }

  // For 'pending', 'failed', 'dead_letter', 'skipped' → reset to pending and
  // bump priority. The relayer scan will pick it up on the next tick.
  db.prepare(
    `UPDATE payment_intents
        SET auto_claim_at  = now()::text,
            invoice_type   = 'merchant',
            auto_claim_status = 'pending',
            retry_count    = 0,
            last_error     = NULL
      WHERE payment_id = ?`
  ).run(paymentId)

  return { ok: true, status: 'queued' }
}
