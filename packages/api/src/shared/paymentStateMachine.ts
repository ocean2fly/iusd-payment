/**
 * iPay Order State Machine — v2
 * ==============================
 *
 * 10 states, atomic transitions via database transactions.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │                         PAYMENT STATUS FLOW                                │
 * │                                                                          │
 * │                    ┌─────────┐                                           │
 * │      create ──────▶│ created │                                           │
 * │                    └────┬────┘                                           │
 * │                         │ spend_v2 submitted                             │
 * │                         ▼                                                │
 * │                  ┌────────────┐                                          │
 * │                  │ processing │                                          │
 * │                  └─────┬──────┘                                         │
 * │           ┌────────────┼──────────────┐                                 │
 * │     [Mode D]      [Mode C fail]   [spend_v2 fail]                       │
 * │  VK at send time  no VK at send       │                                 │
 * │           │                           ▼                                  │
 * │           ▼                       ┌────────┐                            │
 * │   ┌───────────────┐               │ failed │                            │
 * │   │ pending_claim │◀──────────────┤                                     │
 * │   └──────┬────────┘  recipient    │ requires_action │                   │
 * │          │           registers VK └────────┬─────────┘                  │
 * │          │           (server hook,          │ revoke only                │
 * │          │            no relay tx)          ▼ ───────────────────────▶  │
 * │                      │ claim (manual, from Inbox)                        │
 * │                      ▼                                                   │
 * │                ┌───────────┐                                             │
 * │                │ confirmed │  (terminal)                                 │
 * │                └───────────┘                                             │
 * │                                                                          │
 * │  Revoke path (sender):                                                   │
 * │    pending_claim / requires_action                                       │
 * │          │ reject_claim on-chain                                         │
 * │          ▼                                                               │
 * │   ┌──────────────┐                                                       │
 * │   │ reject_pending│                                                      │
 * │   └──────┬───────┘                                                       │
 * │          │ process_refund on-chain                                       │
 * │     ┌────┴──────┐                                                        │
 * │  [sender]  [recipient]                                                   │
 * │     ▼           ▼                                                        │
 * │  ┌───────┐  ┌──────────┐                                                │
 * │  │revoked│  │ refunded │  (both terminal)                               │
 * │  └───────┘  └──────────┘                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { getDb } from '../db/index'

// ── Status constants ─────────────────────────────────────────────────────────

export const PAYMENT_STATUS = {
  CREATED:         'created',
  PROCESSING:      'processing',
  PENDING_CLAIM:   'pending_claim',
  REQUIRES_ACTION: 'requires_action',
  CONFIRMED:       'confirmed',
  REJECT_PENDING:  'reject_pending',
  REVOKED:         'revoked',
  REFUNDED:        'refunded',
  EXPIRED:         'expired',
  FAILED:          'failed',
} as const

export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS]

// ── Transition rules ─────────────────────────────────────────────────────────

export const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  created:         ['processing', 'failed'],
  processing:      ['pending_claim', 'requires_action', 'failed'],
  pending_claim:   ['confirmed', 'reject_pending', 'refunded'],
  requires_action: ['pending_claim', 'confirmed', 'reject_pending', 'refunded', 'revoked'], // revoked: cancel before on-chain
  confirmed:       [],
  reject_pending:  ['revoked', 'refunded', 'failed'],
  revoked:         [],
  refunded:        [],
  expired:         [],
  failed:          [],
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  created:         '创建中',
  processing:      '链上确认中',
  pending_claim:   '待领取',
  requires_action: '等待注册',
  confirmed:       '已到账',
  reject_pending:  '撤回处理中',
  revoked:         '已撤回',
  refunded:        '已退款',
  expired:         '已过期',
  failed:          '失败',
}

export const TERMINAL_STATES = new Set<PaymentStatus>([
  'confirmed', 'revoked', 'refunded', 'expired', 'failed',
])

export const REVOCABLE_STATES = new Set<PaymentStatus>(['pending_claim', 'requires_action'])
export const CLAIMABLE_STATES = new Set<PaymentStatus>(['pending_claim'])

// ── Guard functions ──────────────────────────────────────────────────────────

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATES.has(status)
}

export function isRevocable(status: PaymentStatus): boolean {
  return REVOCABLE_STATES.has(status)
}

export function isClaimable(status: PaymentStatus): boolean {
  return CLAIMABLE_STATES.has(status)
}

// ── Atomic transition ────────────────────────────────────────────────────────

export interface TransitionOptions {
  actor: string
  txHash?: string | null
  note?: string | null
}

/**
 * Atomically transitions a payment from `from` → `to`, writing an event_log entry.
 * Uses a database transaction to guarantee consistency.
 * Throws if:
 *   - Transition is not allowed per ALLOWED_TRANSITIONS
 *   - Payment not found
 *   - Concurrent modification (payment.status !== from at time of update)
 */
export function transition(
  paymentId: string,
  from: PaymentStatus,
  to: PaymentStatus,
  opts: TransitionOptions,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to} for payment ${paymentId}`)
  }

  const db = getDb()
  const now = new Date().toISOString()

  const doTransition = db.transaction(() => {
    const result = db.prepare(
      `UPDATE payments SET status = ?, updated_at = ? WHERE payment_id = ? AND status = ?`
    ).run(to, now, paymentId, from)

    if (result.changes === 0) {
      const current = db.prepare(
        'SELECT status FROM payments WHERE payment_id = ?'
      ).get(paymentId) as { status: string } | undefined

      if (!current) throw new Error(`Payment not found: ${paymentId}`)
      throw new Error(`Concurrent modification: expected ${from}, found ${current.status}`)
    }

    db.prepare(`
      INSERT INTO event_log
        (entity_type, entity_id, from_status, to_status, actor, tx_hash, note, created_at)
      VALUES ('payment', ?, ?, ?, ?, ?, ?, ?)
    `).run(paymentId, from, to, opts.actor, opts.txHash ?? null, opts.note ?? null, now)
  })

  doTransition()
}
