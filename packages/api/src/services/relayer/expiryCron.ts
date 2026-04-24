/**
 * Expiry Cron — DB-based timeout check only.
 *
 * Job 1: Processing timeout (every 5 min):
 *   payments stuck in 'processing' > 10min → failed
 *
 * Jobs 2 & 3 (D+28 expiry, reject_pending retry) were removed —
 * they relied on V1 CLI-based chain calls (initiad tx) which are no longer available.
 */
import cron from 'node-cron'
import { getDb } from '../../db'
import { PAYMENT_STATUS, transition } from '../../shared/paymentStateMachine'

// ── Job 1: Processing timeout ────────────────────────────────────────────────
async function checkProcessingTimeout() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 minutes ago
  const rows = getDb().prepare(`
    SELECT payment_id FROM payments
    WHERE status = 'processing' AND updated_at < ?
  `).all(cutoff) as any[]

  if (rows.length === 0) return
  console.log(`[expiryCron] Processing timeout: ${rows.length} payment(s) to fail`)

  for (const row of rows) {
    try {
      transition(row.payment_id, PAYMENT_STATUS.PROCESSING, PAYMENT_STATUS.FAILED, {
        actor: 'cron',
        note:  '10min processing timeout',
      })
      console.log(`[expiryCron] timed out -> failed: ${row.payment_id}`)
    } catch (err: any) {
      console.warn(`[expiryCron] timeout transition failed for ${row.payment_id}: ${err.message}`)
    }
  }
}

// ── Cron registration ────────────────────────────────────────────────────────

export function startExpiryCron() {
  // Job 1: Processing timeout — every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    checkProcessingTimeout().catch(e => console.error('[expiryCron] processingTimeout error:', e))
  }, { timezone: 'UTC' })

  console.log('[expiryCron] Scheduled: processing-timeout(5m)')
}
