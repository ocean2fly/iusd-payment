/**
 * Database — iPay V3 (PostgreSQL)
 *
 * Tables:
 *   accounts             — user accounts
 *   auth_challenges      — login nonce challenges
 *   auth_sessions        — JWT sessions
 *   contacts             — user contacts
 *   payment_intents      — payment intents (auto claim tracking)
 *   claim_job_traces     — auto claim audit trail
 *   gift_v3_packets      — gift send records
 *   gift_v3_claims       — gift claim records
 *   invoice_tokens       — invoice tokens
 *   invoice_transactions — invoice lifecycle
 *   invoice_payments     — invoice-payment links
 *   pending_notifications — notification queue
 */
import { closePgCompatDb, getPgCompatDb } from './postgres'

export function getDb(): any {
  return getPgCompatDb()
}

export function closeDb() {
  closePgCompatDb()
}
