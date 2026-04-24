/**
 * Pay v3 payment_id hashing.
 *
 * The chain-side "payment_id" argument to pay_v3::deposit / claim / refund /
 * revoke / expire_and_refund / get_payment* is NOT the same value that appears
 * in user-facing claim links anymore. To prevent on-chain event observers from
 * correlating a claim link to its originating deposit TX, we pass
 * `sha256(plainPaymentId)` to the contract as the payment_id. The plain value
 * still lives in the DB and in the claim link so the intended recipient can
 * prove possession, but anyone reading PaymentCreatedEvent will only see the
 * hashed form and cannot reverse it to find the link.
 *
 * Use `hashPaymentId()` anywhere you're about to call a pay_v3 chain function
 * with a payment_id. Never pass the raw DB plain id to the chain directly.
 */

import { createHash } from 'crypto'

/**
 * Hash a plaintext payment_id (hex, with or without 0x prefix) with SHA-256.
 * Returns the lowercased hex string (64 chars, no 0x prefix) — ready to be
 * BCS-encoded as a `vector<u8>` in a Move TX argument.
 */
export function hashPaymentId(plainHex: string): string {
  const buf = Buffer.from(plainHex.replace(/^0x/i, ''), 'hex')
  return createHash('sha256').update(buf).digest('hex')
}
