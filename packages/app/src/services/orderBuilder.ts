/**
 * Order Builder Service
 * 
 * Builds Move transaction messages for:
 * - deposit() - Create a new order
 * - claim() - Claim funds
 * - revoke() - Revoke an unclaimed order
 * - refund() - Return claimed funds to sender
 */

import { API_BASE } from '../config'
import { getPayPoolAddress, getModuleAddress } from './contractConfig'
import {
  generateOrderId,
  generateClaimKey,
  generateRefundKey,
  encryptOrderPayload,
  hexToBytes,
  bytesToHex,
  bcsEncodeVecU8,
  bcsEncodeAddress,
  bcsEncodeU64,
  sha256,
  type OrderPayload,
} from './orderCrypto'

// ═════════════════════════════════════════════════════════════════════════
// Chain-side payment_id hashing
//
// The value we pass to pay_v3 as `payment_id` is NOT the plain order ID
// that goes into the claim link. It's sha256(plainId). This prevents
// PaymentCreatedEvent observers from correlating a claim link to the
// originating deposit TX. The mirror helper on the backend is
// packages/api/src/lib/payKeyHash.ts — must stay in sync.
// ═════════════════════════════════════════════════════════════════════════

async function hashPaymentIdBytes(plain: Uint8Array): Promise<Uint8Array> {
  return sha256(plain)
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface DepositParams {
  sender: string            // Sender address
  recipient: string         // Recipient address
  amount: bigint            // Amount in micro units
  memo?: string             // Optional memo
  expiresInDays?: number    // Expiry (default: 7 days)
  senderViewingPubKey: Uint8Array     // Sender's viewing public key
  recipientViewingPubKey: Uint8Array  // Recipient's viewing public key
  // Pre-generated keys (for invoice payments — ensures idempotent deposit)
  preGeneratedId?: string        // Hex encoded order ID
  preGeneratedClaimKey?: string  // Hex encoded claim key
  preGeneratedRefundKey?: string // Hex encoded refund key
}

export interface DepositResult {
  id: string           // Hex encoded order ID
  claimKey: string          // Hex encoded claim key (send to recipient)
  refundKey: string         // Hex encoded refund key (keep for sender)
  txMsg: any                // Transaction message for InterwovenKit
}

export interface ClaimParams {
  claimKey: string          // Hex encoded claim key
}

export interface ClaimResult {
  txMsg: any                // Transaction message for InterwovenKit
}

// ═══════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════

// Default TTL for pay_v3 deposit (relative seconds, NOT absolute timestamp)
const TTL_SECONDS = 7 * 24 * 3600  // 7 days in seconds
const DEFAULT_EXPIRY_DAYS = 7

// Fetch admin public key from API
let cachedAdminPubKey: Uint8Array | null = null

async function getAdminPubKey(): Promise<Uint8Array> {
  if (cachedAdminPubKey) return cachedAdminPubKey
  
  try {
    const res = await fetch(`${API_BASE}/config`)
    if (!res.ok) throw new Error('Failed to fetch config')
    const config = await res.json()
    
    // Admin pubkey should be in config (hex encoded)
    if (config.adminPubKey) {
      cachedAdminPubKey = hexToBytes(config.adminPubKey)
      return cachedAdminPubKey
    }
  } catch (e) {
    console.warn('[orderBuilder] Failed to fetch admin pubkey:', e)
  }
  
  // Fallback: hardcoded admin pubkey
  // TODO: Remove this fallback in production
  cachedAdminPubKey = hexToBytes(
    '04ebf3e2af893b442e3823acb290c76d90c00e3956c7ff336b603aa3b800bb179270977bc8ecf59a3a17d76da8574031ba336554ff1547925b7a3fc6d1b6b2b2ba'
  )
  return cachedAdminPubKey
}

// ═══════════════════════════════════════════════════════════════════════════
// Build Deposit Transaction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a deposit transaction
 * 
 * This creates a new payment order:
 * 1. Generate order_id, claim_key, refund_key
 * 2. Encrypt order details
 * 3. Build the Move execute message
 * 
 * @returns DepositResult with id, claimKey, refundKey, and txMsg
 */
export async function buildDepositTx(params: DepositParams): Promise<DepositResult> {
  const {
    sender,
    recipient,
    amount,
    memo = '',
    expiresInDays = DEFAULT_EXPIRY_DAYS,
    senderViewingPubKey,
    recipientViewingPubKey,
    preGeneratedId,
    preGeneratedClaimKey,
    preGeneratedRefundKey,
  } = params

  console.log('[buildDepositTx] params:', { sender, recipient, amount: amount?.toString(), memo, expiresInDays, preGenerated: !!preGeneratedId })

  // Use pre-generated keys if provided (invoice payments), otherwise generate new ones
  const id       = preGeneratedId ? hexToBytes(preGeneratedId) : generateOrderId()
  const claimKey = preGeneratedClaimKey ? hexToBytes(preGeneratedClaimKey) : generateClaimKey()
  const refundKey = preGeneratedRefundKey ? hexToBytes(preGeneratedRefundKey) : generateRefundKey()
  
  
  // Create payload
  const payload: OrderPayload = {
    amount: amount.toString(),
    memo,
    sender,
    recipient,
    claimKey: bytesToHex(claimKey),
    refundKey: bytesToHex(refundKey),
    createdAt: Math.floor(Date.now() / 1000),
  }
  
  // Get config (contract address)
  const CONTRACT = getPayPoolAddress()
  const MODULE_ADDRESS = getModuleAddress()
  
  // Get admin public key
  const adminPubKey = await getAdminPubKey()
  
  // Encrypt with both sender and recipient keys
  const encrypted = await encryptOrderPayload(payload, senderViewingPubKey, recipientViewingPubKey, adminPubKey)

  // Compute the chain-side payment_id (sha256 of the plain id). Plain id
  // continues to live in DB + claim link; only the hash goes on chain.
  const chainPaymentId = await hashPaymentIdBytes(id)

  // Build Move execute message (InterwovenKit format: typeUrl + value)
  // pay_v3::deposit(sender, pool, payment_id, amount, ciphertext,
  //                  key_for_sender, key_for_recipient, claim_key_hash, ttl_seconds)
  // Note: InterwovenKit expects Uint8Array for args, not base64 strings
  const txMsg = {
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      sender,
      moduleAddress: MODULE_ADDRESS,
      moduleName: 'pay_v3',
      functionName: 'deposit',
      typeArgs: [],
      args: [
        // pool: Object<PayPoolV2>
        bcsEncodeAddress(CONTRACT),
        // payment_id: vector<u8>  ← sha256(plainId), NOT the plain id
        bcsEncodeVecU8(chainPaymentId),
        // amount: u64
        bcsEncodeU64(amount),
        // ciphertext: vector<u8>
        bcsEncodeVecU8(encrypted.ciphertext),
        // key_for_sender: vector<u8>
        bcsEncodeVecU8(encrypted.keyForSender),
        // key_for_recipient: vector<u8>
        bcsEncodeVecU8(encrypted.keyForRecipient),
        // claim_key_hash: vector<u8>
        bcsEncodeVecU8(encrypted.claimKeyHash),
        // ttl_seconds: u64 (relative, not absolute)
        bcsEncodeU64(BigInt(TTL_SECONDS)),
      ],
    },
  }
  
  console.log('[buildDepositTx] txMsg:', JSON.stringify(txMsg, null, 2))
  
  return {
    id: bytesToHex(id),
    claimKey: bytesToHex(claimKey),
    refundKey: bytesToHex(refundKey),
    txMsg,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Build Claim Transaction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a claim transaction
 * 
 * @param claimer - Address of the claimer
 * @param claimKey - Hex encoded claim key
 */
export async function buildClaimTx(claimer: string, paymentId: string, claimKey: string): Promise<ClaimResult> {
  const CONTRACT = getPayPoolAddress()
  const MODULE_ADDRESS = getModuleAddress()
  // payment_id: chain-side key is sha256(plain) for post-hash deposits,
  // but pre-hash legacy entries are stored under the plain id. Probe the
  // chain with the hashed key first; if that misses, fall back to plain.
  const plainIdBytes = hexToBytes(paymentId.replace(/^0x/i, ''))
  const hashedBytes = await hashPaymentIdBytes(plainIdBytes)
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')

  let chainIdBytes: Uint8Array = hashedBytes
  try {
    const { queryPaymentFullByRawKey } = await import('../lib/payChainStatus')
    const hitHashed = await queryPaymentFullByRawKey(toHex(hashedBytes))
    if (!hitHashed) {
      const hitPlain = await queryPaymentFullByRawKey(toHex(plainIdBytes))
      if (hitPlain) chainIdBytes = plainIdBytes
    }
  } catch { /* keep hashed default on any probe error */ }
  const claimKeyBytes = hexToBytes(claimKey.replace(/^0x/i, ''))

  const txMsg = {
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      sender: claimer,
      moduleAddress: MODULE_ADDRESS,
      moduleName: 'pay_v3',
      functionName: 'claim',
      typeArgs: [],
      args: [
        bcsEncodeAddress(CONTRACT),     // pool: Object<PoolV2>
        bcsEncodeVecU8(chainIdBytes),   // payment_id: vector<u8> ← hash
        bcsEncodeVecU8(claimKeyBytes),  // claim_key: vector<u8>
      ],
    },
  }

  return { txMsg }
}

// ═══════════════════════════════════════════════════════════════════════════
// Build Revoke Transaction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a revoke transaction
 * 
 * @param revoker - Address of the revoker (sender/owner)
 * @param id - Hex encoded order ID
 */
export async function buildRevokeTx(revoker: string, id: string): Promise<{ txMsg: any }> {
  const CONTRACT = getPayPoolAddress()
  const MODULE_ADDRESS = getModuleAddress()
  // Chain-side key is sha256(plain id)
  const plainBytes = hexToBytes(id.replace(/^0x/i, ''))
  const chainBytes = await hashPaymentIdBytes(plainBytes)

  const txMsg = {
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      sender: revoker,
      moduleAddress: MODULE_ADDRESS,
      moduleName: 'pay_v3',
      functionName: 'revoke',
      typeArgs: [],
      args: [
        bcsEncodeAddress(CONTRACT),
        bcsEncodeVecU8(chainBytes),
      ],
    },
  }

  return { txMsg }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Convert amount to micro units
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert iUSD amount (string with decimals) to micro units (bigint)
 * e.g., "1.5" -> 1500000n
 */
export function toMicroUnits(amount: string): bigint {
  const [int, frac = ''] = amount.split('.')
  const fracPadded = frac.padEnd(6, '0').slice(0, 6)
  return BigInt(int || '0') * 1_000_000n + BigInt(fracPadded)
}

/**
 * Convert micro units (bigint) to display amount (string)
 * e.g., 1500000n -> "1.5"
 */
export function fromMicroUnits(micro: bigint): string {
  const microStr = micro.toString().padStart(7, '0')
  const int = microStr.slice(0, -6) || '0'
  const frac = microStr.slice(-6).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/**
 * Build a refund transaction (recipient returns funds to sender).
 * Requires: payment is CONFIRMED and caller is the claimer (claimed_by address).
 * pay_v3::refund(recipient, pool, payment_id)
 *
 * @param recipient - Address of the claimer who received funds
 * @param id        - Hex encoded order ID (from invoice_payments.payment_id)
 */
export async function buildRefundTx(recipient: string, id: string): Promise<{ txMsg: any }> {
  const CONTRACT = getPayPoolAddress()
  const MODULE_ADDRESS = getModuleAddress()
  // Chain-side key is sha256(plain id)
  const plainBytes = hexToBytes(id.replace(/^0x/i, ''))
  const chainBytes = await hashPaymentIdBytes(plainBytes)

  const txMsg = {
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      sender: recipient,
      moduleAddress: MODULE_ADDRESS,
      moduleName: 'pay_v3',
      functionName: 'refund',
      typeArgs: [],
      args: [
        bcsEncodeAddress(CONTRACT),   // pool: Object<PayPoolV2>
        bcsEncodeVecU8(chainBytes),   // payment_id: vector<u8>
      ],
    },
  }

  return { txMsg }
}
