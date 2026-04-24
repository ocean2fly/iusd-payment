/**
 * Encryption Service
 * 
 * Hybrid encryption scheme for payment privacy:
 * - AES-256-GCM for symmetric encryption of payment details
 * - ECIES (secp256k1) for asymmetric key wrapping
 * 
 * This service is used for:
 * 1. Admin decryption during audits
 * 2. Verifying encryption validity
 * 
 * Frontend handles user-side encryption/decryption.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import { ec as EC } from 'elliptic'

const secp256k1 = new EC('secp256k1')

// AES-256-GCM parameters
const AES_KEY_LENGTH = 32  // 256 bits
const AES_IV_LENGTH = 12   // 96 bits (GCM standard)
const AES_TAG_LENGTH = 16  // 128 bits

/**
 * Order payload structure (what gets encrypted)
 */
export interface OrderPayload {
  amount: string          // Amount in micro units
  memo?: string           // Optional memo
  sender: string          // Sender address
  recipient: string       // Recipient address
  claimKey: string        // 32 bytes hex - secret for claiming
  refundKey: string       // 32 bytes hex - secret for refunding
  createdAt: number       // Unix timestamp
}

/**
 * Encrypted payment data (stored on-chain)
 */
export interface EncryptedOrderData {
  ciphertext: Buffer      // AES-GCM encrypted payload
  keyForUser: Buffer      // ECIES wrapped key for recipient
  keyForAdmin: Buffer     // ECIES wrapped key for admin
  senderCooked: Buffer    // Hash of sender address
  recipientCooked: Buffer // Hash of recipient address
}

/**
 * Generate random bytes
 */
export function generateRandomBytes(length: number): Buffer {
  return randomBytes(length)
}

/**
 * Generate payment ID (32 bytes random)
 */
export function generateOrderId(): Buffer {
  return randomBytes(32)
}

/**
 * Generate claim/refund key (32 bytes random)
 */
export function generateSecretKey(): Buffer {
  return randomBytes(32)
}

/**
 * Cook (hash) an address for privacy-preserving indexing
 * cook(addr) = SHA256(addr || "ipay-cook")
 */
export function cookAddress(address: string): Buffer {
  return createHash('sha256')
    .update(address.toLowerCase())
    .update('ipay-cook')
    .digest()
}

/**
 * Hash a key for storage
 * keyHash = SHA256(key)
 */
export function hashKey(key: Buffer): Buffer {
  return createHash('sha256').update(key).digest()
}

/**
 * AES-256-GCM encryption
 */
export function aesEncrypt(plaintext: Buffer, key: Buffer): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(AES_IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ])
  
  const tag = cipher.getAuthTag()
  
  return { ciphertext: encrypted, iv, tag }
}

/**
 * AES-256-GCM decryption
 */
export function aesDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ])
}

/**
 * ECIES encrypt (wrap key for recipient)
 * 
 * 1. Generate ephemeral keypair
 * 2. ECDH shared secret
 * 3. Derive symmetric key from shared secret
 * 4. AES encrypt the payload
 * 5. Return: ephemeralPubKey || iv || tag || ciphertext
 */
export function eciesEncrypt(plaintext: Buffer, recipientPubKey: Buffer): Buffer {
  // Generate ephemeral keypair
  const ephemeral = secp256k1.genKeyPair()
  const ephemeralPubKey = Buffer.from(ephemeral.getPublic('array'))  // 65 bytes uncompressed
  
  // Parse recipient public key
  const recipientKey = secp256k1.keyFromPublic(recipientPubKey)
  
  // ECDH shared secret
  const sharedSecret = ephemeral.derive(recipientKey.getPublic())
  const sharedSecretBytes = Buffer.from(sharedSecret.toArray('be', 32))
  
  // Derive AES key from shared secret
  const aesKey = createHash('sha256').update(sharedSecretBytes).digest()
  
  // Encrypt
  const { ciphertext, iv, tag } = aesEncrypt(plaintext, aesKey)

  // Pack: ephemeralPubKey (65) || iv (12) || ciphertext || tag (16)
  //
  // IMPORTANT: tag MUST come after the ciphertext, matching the
  // WebCrypto AES-GCM layout that eciesDecrypt() and the browser-side
  // orderCrypto.ts both assume. An earlier version of this function
  // packed the tag between iv and ciphertext — that made server-side
  // encrypt → server-side decrypt fail the AES-GCM auth check and
  // burned every gift/send recipient_blob straight to dead_letter.
  return Buffer.concat([ephemeralPubKey, iv, ciphertext, tag])
}

/**
 * ECIES decrypt
 * 
 * 1. Parse ephemeralPubKey, iv, tag, ciphertext
 * 2. ECDH shared secret with recipient private key
 * 3. Derive symmetric key
 * 4. AES decrypt
 */
export function eciesDecrypt(encrypted: Buffer, recipientPrivKey: Buffer): Buffer {
  // Unpack the fixed-offset prefix (ephPub || iv), then do the ECDH so
  // we have the AES key. Body layout varies:
  //   WebCrypto / post-fix eciesEncrypt: ephPub(65) || iv(12) || ct || tag(16)
  //   Legacy pre-fix eciesEncrypt:       ephPub(65) || iv(12) || tag(16) || ct
  //
  // Old gift recipient_blobs on-chain were written with the legacy
  // format. Supporting both layouts so stale blobs still decrypt.
  const ephemeralPubKey = encrypted.subarray(0, 65)
  const iv = encrypted.subarray(65, 65 + AES_IV_LENGTH)
  const body = encrypted.subarray(65 + AES_IV_LENGTH)

  const ephemeralKey = secp256k1.keyFromPublic(ephemeralPubKey)
  const recipientKey = secp256k1.keyFromPrivate(recipientPrivKey)
  const sharedSecret = recipientKey.derive(ephemeralKey.getPublic())
  const sharedSecretBytes = Buffer.from(sharedSecret.toArray('be', 32))
  const aesKey = createHash('sha256').update(sharedSecretBytes).digest()

  // Format 1 (WebCrypto, new): tag at END
  try {
    const tag = body.subarray(body.length - AES_TAG_LENGTH)
    const ciphertext = body.subarray(0, body.length - AES_TAG_LENGTH)
    return aesDecrypt(ciphertext, aesKey, iv, tag)
  } catch (err1) {
    // Format 2 (legacy, old): tag at START
    try {
      const tag = body.subarray(0, AES_TAG_LENGTH)
      const ciphertext = body.subarray(AES_TAG_LENGTH)
      return aesDecrypt(ciphertext, aesKey, iv, tag)
    } catch (err2) {
      // Re-throw the first error (new format) so it's the one surfaced
      // — the legacy fallback is best-effort.
      throw err1
    }
  }
}

/**
 * Encrypt payment payload for storage on-chain
 * 
 * @param payload - Order details
 * @param recipientViewingPubKey - Recipient's viewing public key (65 bytes)
 * @param adminPubKey - Admin's public key (65 bytes)
 */
export function encryptOrderPayload(
  payload: OrderPayload,
  recipientViewingPubKey: Buffer,
  adminPubKey: Buffer
): EncryptedOrderData {
  // Serialize payload
  const payloadJson = JSON.stringify(payload)
  const payloadBytes = Buffer.from(payloadJson, 'utf8')
  
  // Generate random AES key
  const randomKey = randomBytes(AES_KEY_LENGTH)
  
  // Encrypt payload with random key
  const { ciphertext, iv, tag } = aesEncrypt(payloadBytes, randomKey)
  
  // Pack ciphertext: iv || tag || encrypted
  // WebCrypto layout: iv || ciphertext || tag. Must match
  // decryptWebCryptoCiphertext so server-encrypt → server-decrypt
  // round-trips. Legacy on-chain blobs (iv || tag || ciphertext) are
  // still readable via decryptWebCryptoCiphertext's fallback branch.
  const fullCiphertext = Buffer.concat([iv, ciphertext, tag])
  
  // Wrap random key for user and admin
  const keyForUser = eciesEncrypt(randomKey, recipientViewingPubKey)
  const keyForAdmin = eciesEncrypt(randomKey, adminPubKey)
  
  // Cook addresses
  const senderCooked = cookAddress(payload.sender)
  const recipientCooked = cookAddress(payload.recipient)
  
  return {
    ciphertext: fullCiphertext,
    keyForUser,
    keyForAdmin,
    senderCooked,
    recipientCooked,
  }
}

/**
 * Decrypt payment payload (for admin audit)
 * 
 * @param encrypted - Encrypted payment data from chain
 * @param adminPrivKey - Admin's private key (32 bytes)
 */
/**
 * Decrypt a packed AES-GCM ciphertext. Historically the server emitted
 * two different layouts and they're both on chain now, so we try the
 * new (WebCrypto) layout first and fall back to the legacy one.
 *
 *   WebCrypto (new):  iv(12) || ciphertext || tag(16)   [tag at END]
 *   Legacy (old):     iv(12) || tag(16)    || ciphertext [tag at START]
 */
function decryptWebCryptoCiphertext(fullCiphertext: Buffer, aesKey: Buffer): Buffer {
  const iv = fullCiphertext.subarray(0, AES_IV_LENGTH)
  const body = fullCiphertext.subarray(AES_IV_LENGTH)

  // Format 1 — tag at end (WebCrypto / post-fix encryptOrderPayload)
  try {
    const tag = body.subarray(body.length - AES_TAG_LENGTH)
    const ciphertext = body.subarray(0, body.length - AES_TAG_LENGTH)
    return aesDecrypt(ciphertext, aesKey, iv, tag)
  } catch (err1) {
    // Format 2 — tag at start (legacy pre-fix encryptOrderPayload +
    // the old gift recipient_blob outer ciphertext on chain).
    try {
      const tag = body.subarray(0, AES_TAG_LENGTH)
      const ciphertext = body.subarray(AES_TAG_LENGTH)
      return aesDecrypt(ciphertext, aesKey, iv, tag)
    } catch {
      throw err1
    }
  }
}

/**
 * Decrypt full payment payload for the recipient.
 * Returns the parsed payload including claimKey.
 */
export function decryptPayloadForRecipient(
  fullCiphertext: Buffer,   // chain[7] = iv || ciphertext || tag
  keyForRecipient: Buffer,  // chain[9] = ECIES(randomKey, recipientViewingPubKey)
  viewingPrivKeyEnc: string
): Record<string, any> {
  const viewingPrivKey = decryptViewingPrivKey(viewingPrivKeyEnc)
  const randomKey = eciesDecrypt(keyForRecipient, viewingPrivKey)
  const payloadBytes = decryptWebCryptoCiphertext(fullCiphertext, randomKey)
  return JSON.parse(payloadBytes.toString('utf8'))
}

export function decryptOrderPayloadAdmin(
  encrypted: EncryptedOrderData,
  adminPrivKey: Buffer
): OrderPayload {
  // Unwrap random key using admin private key
  const randomKey = eciesDecrypt(encrypted.keyForAdmin, adminPrivKey)
  // Use correct WebCrypto format (iv || ciphertext || tag)
  const payloadBytes = decryptWebCryptoCiphertext(encrypted.ciphertext, randomKey)
  return JSON.parse(payloadBytes.toString('utf8'))
}

/**
 * Derive viewing keypair from wallet signature
 * This is deterministic - same signature = same keypair
 * 
 * @param signature - Wallet signature of standard message
 */
export function deriveViewingKeyFromSignature(signature: string): { privKey: Buffer; pubKey: Buffer } {
  // Hash signature to get private key
  const privKey = createHash('sha256')
    .update(signature)
    .update('ipay-viewing-key-v1')
    .digest()
  
  // Derive public key
  const keyPair = secp256k1.keyFromPrivate(privKey)
  const pubKey = Buffer.from(keyPair.getPublic('array'))  // 65 bytes uncompressed
  
  return { privKey, pubKey }
}

/**
 * Verify cooked address matches
 */
export function verifyCooked(address: string, cooked: Buffer): boolean {
  const expected = cookAddress(address)
  return expected.equals(cooked)
}

// ═══════════════════════════════════════════════════════════════════════════
// Server-Side Key Storage (for viewing_privkey_enc)
// ═══════════════════════════════════════════════════════════════════════════

const SERVER_KEY_ENV = 'IPAY_SERVER_KEY'

/**
 * Get or generate server encryption key
 * In production, this should be from secure key management (HSM, KMS)
 */
function getServerKey(): Buffer {
  const envKey = process.env[SERVER_KEY_ENV]
  if (envKey) {
    return Buffer.from(envKey, 'hex')
  }
  // Fallback for development - derive from a secret
  const devSecret = process.env.JWT_SECRET || 'dev-secret-ipay'
  return createHash('sha256').update(devSecret).update('server-key-v1').digest()
}

/**
 * Encrypt viewing private key for storage
 * Format: base64(iv:ciphertext:tag)
 */
export function encryptViewingPrivKey(privKey: Buffer): string {
  const serverKey = getServerKey()
  const { ciphertext, iv, tag } = aesEncrypt(privKey, serverKey)
  const packed = Buffer.concat([iv, ciphertext, tag])
  return packed.toString('base64')
}

/**
 * Decrypt viewing private key from storage
 */
export function decryptViewingPrivKey(encrypted: string): Buffer {
  const serverKey = getServerKey()
  const packed = Buffer.from(encrypted, 'base64')
  
  const iv = packed.subarray(0, AES_IV_LENGTH)
  const tag = packed.subarray(packed.length - AES_TAG_LENGTH)
  const ciphertext = packed.subarray(AES_IV_LENGTH, packed.length - AES_TAG_LENGTH)
  
  return aesDecrypt(ciphertext, serverKey, iv, tag)
}

/**
 * Generate viewing keypair server-side
 */
export function generateViewingKeyPair(): { privKey: Buffer; pubKey: Buffer } {
  const keyPair = secp256k1.genKeyPair()
  const privKey = Buffer.from(keyPair.getPrivate().toArray('be', 32))
  const pubKey = Buffer.from(keyPair.getPublic().encode('array', false))  // 65 bytes uncompressed
  return { privKey, pubKey }
}

/**
 * Decrypt claim key for recipient (server-side)
 * 
 * @param keyForRecipient - ECIES encrypted key (from payment on-chain)
 * @param viewingPrivKeyEnc - Encrypted viewing private key (from accounts table)
 */
export function decryptClaimKey(keyForRecipient: Buffer, viewingPrivKeyEnc: string): Buffer {
  const viewingPrivKey = decryptViewingPrivKey(viewingPrivKeyEnc)
  return eciesDecrypt(keyForRecipient, viewingPrivKey)
}
