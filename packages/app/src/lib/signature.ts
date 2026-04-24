/**
 * iPay Signature Library
 * 
 * Builds and signs messages for relay operations.
 * Uses keccak256 for Ethereum-compatible message hashing.
 */

import { keccak256, toBytes, concat, numberToBytes, pad } from 'viem'

/**
 * Build claim authorization message
 * Format: keccak256("ipay_claim" || claim_key_hash || destination || deadline || nonce)
 */
export function buildClaimMessage(
  claimKeyHash: `0x${string}`,
  destination: `0x${string}`,
  deadline: bigint,
  nonce: bigint
): `0x${string}` {
  const prefix = toBytes('ipay_claim')
  const keyHashBytes = toBytes(claimKeyHash)
  const destBytes = pad(toBytes(destination), { size: 32 })
  const deadlineBytes = pad(numberToBytes(deadline), { size: 8 })
  const nonceBytes = pad(numberToBytes(nonce), { size: 8 })
  
  return keccak256(concat([prefix, keyHashBytes, destBytes, deadlineBytes, nonceBytes]))
}

/**
 * Build cancel order authorization message
 * Format: keccak256("ipay_cancel" || order_id_hash || deadline || nonce)
 */
export function buildCancelMessage(
  idHash: `0x${string}`,
  deadline: bigint,
  nonce: bigint
): `0x${string}` {
  const prefix = toBytes('ipay_cancel')
  const hashBytes = toBytes(idHash)
  const deadlineBytes = pad(numberToBytes(deadline), { size: 8 })
  const nonceBytes = pad(numberToBytes(nonce), { size: 8 })
  
  return keccak256(concat([prefix, hashBytes, deadlineBytes, nonceBytes]))
}

/**
 * Generate a random nonce
 */
export function generateNonce(): bigint {
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  return BigInt('0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''))
}

/**
 * Get deadline (current time + duration in seconds)
 */
export function getDeadline(durationSeconds: number = 300): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + durationSeconds)
}

/**
 * Parse signature into r, s, v components
 * Input: 65-byte signature (r[32] || s[32] || v[1])
 * Output: { signature: 64-byte (r || s), recoveryId: 0 or 1 }
 */
export function parseSignature(sig: `0x${string}`): {
  signature: `0x${string}`
  recoveryId: number
} {
  // Remove 0x prefix
  const sigHex = sig.slice(2)
  
  // r (32 bytes) + s (32 bytes) = 64 bytes
  const signature = `0x${sigHex.slice(0, 128)}` as `0x${string}`
  
  // v is last byte
  const v = parseInt(sigHex.slice(128, 130), 16)
  
  // Convert v to recovery_id (0 or 1)
  // v = 27 or 28 for legacy, or 0/1 for EIP-155
  const recoveryId = v >= 27 ? v - 27 : v
  
  return { signature, recoveryId }
}
