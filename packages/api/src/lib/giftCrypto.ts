/**
 * Gift V3 cryptography — secret generation and derivation.
 *
 * Group gift claim flow:
 *   1. Server generates random claim_key (32 bytes) + allocation_seed (32 bytes)
 *   2. For each slot i: slot_hash[i] = SHA256(SHA256(claim_key || LE(i)))
 *   3. slot_hashes are stored on-chain during send_gift_group
 *   4. Claim link contains claim_key + slot_index
 *   5. Claimer derives:
 *        slot_secret = SHA256(claim_key || LE(slot_index))
 *        proof = SHA256(slot_secret || BCS(claimer_address))
 *   6. Contract verifies SHA256(slot_secret) == slot_hash[i] AND proof matches
 */

import { randomBytes, createHash } from 'crypto'
import { bech32 } from 'bech32'

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

/** Encode u64 as 8-byte little-endian */
function leU64(n: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(n))
  return buf
}

/**
 * Convert address to 32-byte BCS format (matching Move's std::bcs::to_bytes(&address)).
 * Supports both 0x hex and bech32 (init1...) formats.
 * Address is zero-padded on the left to 32 bytes.
 */
function bcsAddress(addr: string): Buffer {
  let addrBytes: Buffer
  if (addr.startsWith('init1')) {
    const decoded = bech32.decode(addr)
    addrBytes = Buffer.from(bech32.fromWords(decoded.words))
  } else {
    addrBytes = Buffer.from(addr.replace(/^0x/i, '').toLowerCase(), 'hex')
  }
  const buf = Buffer.alloc(32)
  addrBytes.copy(buf, 32 - addrBytes.length)
  return buf
}

/** Generate a random 32-byte claim key */
export function generateClaimKey(): Buffer {
  return randomBytes(32)
}

/** Generate a random 32-byte allocation seed */
export function generateAllocationSeed(): Buffer {
  return randomBytes(32)
}

/** Generate a random 16-byte packet ID */
export function generatePacketId(): Buffer {
  return randomBytes(16)
}

/**
 * Derive slot_secret for a given slot index.
 * slot_secret = SHA256(claim_key || LE_bytes(slot_index))
 */
export function deriveSlotSecret(claimKey: Buffer, slotIndex: number): Buffer {
  return sha256(Buffer.concat([claimKey, leU64(slotIndex)]))
}

/**
 * Derive slot_hash (stored on-chain for verification).
 * slot_hash = SHA256(slot_secret)
 */
export function deriveSlotHash(slotSecret: Buffer): Buffer {
  return sha256(slotSecret)
}

/**
 * Derive address-bound proof (MEV protection).
 * proof = SHA256(slot_secret || BCS_bytes(claimer_address))
 */
export function deriveProof(slotSecret: Buffer, claimerAddress: string): Buffer {
  return sha256(Buffer.concat([slotSecret, bcsAddress(claimerAddress)]))
}

/**
 * Generate all slot_hashes for a group gift.
 * Returns array of 32-byte hashes, one per slot.
 */
export function generateSlotHashes(claimKey: Buffer, numSlots: number): Buffer[] {
  const hashes: Buffer[] = []
  for (let i = 0; i < numSlots; i++) {
    const secret = deriveSlotSecret(claimKey, i)
    hashes.push(deriveSlotHash(secret))
  }
  return hashes
}

/**
 * Generate complete group gift secrets package.
 * Returns everything needed for send_gift_group TX and claim links.
 */
export function generateGroupGiftSecrets(numSlots: number) {
  const packetId = generatePacketId()
  const claimKey = generateClaimKey()
  const allocationSeed = generateAllocationSeed()
  const slotHashes = generateSlotHashes(claimKey, numSlots)

  return {
    packetId,
    claimKey,
    allocationSeed,
    slotHashes,
    packetIdHex: packetId.toString('hex'),
    claimKeyHex: claimKey.toString('hex'),
    allocationSeedHex: allocationSeed.toString('hex'),
    slotHashesHex: slotHashes.map(h => h.toString('hex')),
  }
}

/**
 * Encode gift claim params into a base64url short code (legacy per-slot URL).
 * Layout: packetId (16 bytes) + claimKey (32 bytes) + slotIndex (1 byte u8) = 49 bytes
 * Result: ~66 char base64url string (no padding)
 */
export function encodeGiftShortCode(packetIdHex: string, claimKeyHex: string, slotIndex: number): string {
  const buf = Buffer.alloc(49)
  Buffer.from(packetIdHex, 'hex').copy(buf, 0)
  Buffer.from(claimKeyHex, 'hex').copy(buf, 16)
  buf[48] = slotIndex & 0xff
  return buf.toString('base64url')
}

/**
 * Encode single-URL gift claim code (no slotIndex — server assigns slot).
 * Layout: packetId (16 bytes) + claimKey (32 bytes) = 48 bytes
 * Result: ~64 char base64url string (no padding)
 */
export function encodeGiftGroupCode(packetIdHex: string, claimKeyHex: string): string {
  const buf = Buffer.alloc(48)
  Buffer.from(packetIdHex, 'hex').copy(buf, 0)
  Buffer.from(claimKeyHex, 'hex').copy(buf, 16)
  return buf.toString('base64url')
}
