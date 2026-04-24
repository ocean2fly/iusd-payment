/**
 * Order Encryption Service (Frontend)
 * 
 * Handles:
 * - Key generation (order_id, claim_key, refund_key)
 * - Hybrid encryption (AES + ECIES)
 * - Address cooking (privacy-preserving indexing)
 * - Viewing key derivation from wallet signature
 */

import { ec as EC } from 'elliptic'

const secp256k1 = new EC('secp256k1')

// ═══════════════════════════════════════════════════════════════════════════
// Pubkey Utils
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert compressed pubkey (33 bytes, 02/03 prefix) to uncompressed (65 bytes, 04 prefix)
 */
export function decompressPubKey(pubKey: Uint8Array): Uint8Array {
  // Already uncompressed
  if (pubKey.length === 65 && pubKey[0] === 0x04) {
    return pubKey
  }
  
  // Compressed format - decompress
  if (pubKey.length === 33 && (pubKey[0] === 0x02 || pubKey[0] === 0x03)) {
    try {
      const keyPair = secp256k1.keyFromPublic(Array.from(pubKey))
      const uncompressed = keyPair.getPublic(false, 'array') // false = uncompressed
      return new Uint8Array(uncompressed)
    } catch (err) {
      console.error('[decompressPubKey] Failed:', err)
    }
  }
  
  return pubKey
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface OrderPayload {
  amount: string          // Amount in micro units (string to avoid precision loss)
  memo?: string           // Optional memo
  sender: string          // Sender address
  recipient: string       // Recipient address
  claimKey: string        // 32 bytes hex - secret for claiming
  refundKey: string       // 32 bytes hex - secret for refunding
  createdAt: number       // Unix timestamp (seconds)
}

export interface EncryptedOrderData {
  ciphertext: Uint8Array      // AES-GCM encrypted payload (iv || tag || encrypted)
  keyForSender: Uint8Array    // ECIES wrapped key for sender
  keyForRecipient: Uint8Array // ECIES wrapped key for recipient
  keyForAdmin: Uint8Array     // ECIES wrapped key for admin
  senderCooked: Uint8Array    // SHA256(sender || "ipay-cook")
  recipientCooked: Uint8Array // SHA256(recipient || "ipay-cook")
  claimKeyHash: Uint8Array    // SHA256(claimKey)
  refundKeyHash: Uint8Array   // SHA256(refundKey)
}

export interface ViewingKeyPair {
  privateKey: Uint8Array  // 32 bytes
  publicKey: Uint8Array   // 65 bytes (uncompressed)
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════

/** Convert hex string to Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  const padded = clean.length % 2 === 0 ? clean : '0' + clean
  const bytes = new Uint8Array(padded.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** Convert Uint8Array to hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Generate random bytes using Web Crypto API */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** SHA-256 hash */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', toArrayBuffer(data))
  return new Uint8Array(hashBuffer)
}

/** Convert Uint8Array to ArrayBuffer (for crypto APIs) */
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer
}

/** Concatenate Uint8Arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Key Generation
// ═══════════════════════════════════════════════════════════════════════════

/** Generate order ID (32 random bytes) */
export function generateOrderId(): Uint8Array {
  return randomBytes(32)  // 32 bytes = 256 bits
}

/** Generate claim key (32 random bytes) */
export function generateClaimKey(): Uint8Array {
  return randomBytes(32)
}

/** Generate refund key (32 random bytes) */
export function generateRefundKey(): Uint8Array {
  return randomBytes(32)
}

/** Hash a key (SHA-256) */
export async function hashKey(key: Uint8Array): Promise<Uint8Array> {
  return sha256(key)
}

/** Cook an address for privacy-preserving indexing */
export async function cookAddress(address: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = concat(
    encoder.encode(address.toLowerCase()),
    encoder.encode('ipay-cook')
  )
  return sha256(data)
}

// ═══════════════════════════════════════════════════════════════════════════
// Viewing Key Derivation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive viewing keypair from wallet signature
 * This is deterministic - same signature = same keypair
 */
export async function deriveViewingKey(signature: string): Promise<ViewingKeyPair> {
  const encoder = new TextEncoder()
  const data = concat(
    encoder.encode(signature),
    encoder.encode('ipay-viewing-key-v1')
  )
  
  // Hash to get private key
  const privateKey = await sha256(data)
  
  // Derive public key using elliptic
  const keyPair = secp256k1.keyFromPrivate(privateKey)
  const publicKeyArray = keyPair.getPublic('array') as number[]
  const publicKey = new Uint8Array(publicKeyArray)
  
  return { privateKey, publicKey }
}

/**
 * Get the standard message for viewing key derivation
 */
export function getViewingKeySignMessage(walletAddress: string): string {
  return `iPay Viewing Key\n\nAddress: ${walletAddress}\n\nSign this message to derive your viewing key. This key allows you to decrypt payment details sent to you.\n\nThis signature will NOT submit any blockchain transaction.`
}

// ═══════════════════════════════════════════════════════════════════════════
// AES-256-GCM Encryption
// ═══════════════════════════════════════════════════════════════════════════

const AES_KEY_LENGTH = 32   // 256 bits
const AES_IV_LENGTH = 12    // 96 bits (GCM standard)
const AES_TAG_LENGTH = 16   // 128 bits

/** Generate AES key */
export function generateAesKey(): Uint8Array {
  return randomBytes(AES_KEY_LENGTH)
}

/** AES-256-GCM encrypt */
export async function aesEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = randomBytes(AES_IV_LENGTH)
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: AES_TAG_LENGTH * 8 },
    cryptoKey,
    toArrayBuffer(plaintext)
  )
  
  return {
    ciphertext: new Uint8Array(encrypted),
    iv,
  }
}

/** AES-256-GCM decrypt */
export async function aesDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: AES_TAG_LENGTH * 8 },
    cryptoKey,
    toArrayBuffer(ciphertext)
  )
  
  return new Uint8Array(decrypted)
}

// ═══════════════════════════════════════════════════════════════════════════
// ECIES Encryption (secp256k1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ECIES encrypt (wrap key for recipient)
 * 
 * 1. Generate ephemeral keypair
 * 2. ECDH shared secret
 * 3. Derive symmetric key from shared secret
 * 4. AES encrypt the payload
 * 5. Return: ephemeralPubKey (65) || iv (12) || ciphertext+tag
 */
export async function eciesEncrypt(
  plaintext: Uint8Array,
  recipientPubKey: Uint8Array
): Promise<Uint8Array> {
  console.log('[eciesEncrypt] recipientPubKey length:', recipientPubKey?.length, 'first byte:', recipientPubKey?.[0]?.toString(16))
  
  // Auto-decompress if needed
  let pubKey = recipientPubKey
  if (pubKey && pubKey.length === 33 && (pubKey[0] === 0x02 || pubKey[0] === 0x03)) {
    console.log('[eciesEncrypt] Decompressing pubkey...')
    pubKey = decompressPubKey(pubKey)
    console.log('[eciesEncrypt] After decompress:', pubKey.length, 'first byte:', pubKey[0]?.toString(16))
  }
  
  // Validate pubkey format
  if (!pubKey || pubKey.length !== 65 || pubKey[0] !== 0x04) {
    console.error('[eciesEncrypt] Invalid pubkey format:', { length: pubKey?.length, firstByte: pubKey?.[0] })
    throw new Error(`Invalid pubkey: expected 65 bytes starting with 0x04, got ${pubKey?.length} bytes starting with 0x${pubKey?.[0]?.toString(16)}`)
  }
  
  recipientPubKey = pubKey
  
  // Generate ephemeral keypair
  const ephemeral = secp256k1.genKeyPair()
  const ephemeralPubKeyArray = ephemeral.getPublic('array') as number[]
  const ephemeralPubKey = new Uint8Array(ephemeralPubKeyArray)
  
  // Parse recipient public key
  const recipientKey = secp256k1.keyFromPublic(Array.from(recipientPubKey))
  
  // ECDH shared secret
  const sharedSecret = ephemeral.derive(recipientKey.getPublic())
  const sharedSecretBytes = new Uint8Array(sharedSecret.toArray('be', 32))
  
  // Derive AES key from shared secret
  const aesKey = await sha256(sharedSecretBytes)
  
  // Encrypt
  const { ciphertext, iv } = await aesEncrypt(plaintext, aesKey)
  
  // Pack: ephemeralPubKey (65) || iv (12) || ciphertext
  return concat(ephemeralPubKey, iv, ciphertext)
}

/**
 * ECIES decrypt
 * 
 * 1. Parse ephemeralPubKey, iv, ciphertext
 * 2. ECDH shared secret with recipient private key
 * 3. Derive symmetric key
 * 4. AES decrypt
 */
export async function eciesDecrypt(
  encrypted: Uint8Array,
  recipientPrivKey: Uint8Array
): Promise<Uint8Array> {
  // Unpack
  const ephemeralPubKey = encrypted.slice(0, 65)
  const iv = encrypted.slice(65, 65 + AES_IV_LENGTH)
  const ciphertext = encrypted.slice(65 + AES_IV_LENGTH)
  
  // Parse keys
  const ephemeralKey = secp256k1.keyFromPublic(Array.from(ephemeralPubKey))
  const recipientKey = secp256k1.keyFromPrivate(Array.from(recipientPrivKey))
  
  // ECDH shared secret
  const sharedSecret = recipientKey.derive(ephemeralKey.getPublic())
  const sharedSecretBytes = new Uint8Array(sharedSecret.toArray('be', 32))
  
  // Derive AES key
  const aesKey = await sha256(sharedSecretBytes)
  
  // Decrypt
  return aesDecrypt(ciphertext, aesKey, iv)
}

// ═══════════════════════════════════════════════════════════════════════════
// Order Encryption (High-Level API)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encrypt order payload for storage on-chain
 * 
 * @param payload - Order details
 * @param recipientViewingPubKey - Recipient's viewing public key (65 bytes)
 * @param adminPubKey - Admin's public key (65 bytes)
 */
export async function encryptOrderPayload(
  payload: OrderPayload,
  senderViewingPubKey: Uint8Array,
  recipientViewingPubKey: Uint8Array,
  adminPubKey: Uint8Array
): Promise<EncryptedOrderData> {
  const encoder = new TextEncoder()
  
  // Serialize payload to JSON
  const payloadJson = JSON.stringify(payload)
  const payloadBytes = encoder.encode(payloadJson)
  
  // Generate random AES key
  const randomKey = generateAesKey()
  
  // Encrypt payload with random key
  const { ciphertext, iv } = await aesEncrypt(payloadBytes, randomKey)
  
  // Pack ciphertext: iv (12) || ciphertext (includes tag)
  const fullCiphertext = concat(iv, ciphertext)
  
  // Wrap random key for sender, recipient, and admin using ECIES
  const keyForSender = await eciesEncrypt(randomKey, senderViewingPubKey)
  const keyForRecipient = await eciesEncrypt(randomKey, recipientViewingPubKey)
  const keyForAdmin = await eciesEncrypt(randomKey, adminPubKey)
  
  // Cook addresses
  const senderCooked = await cookAddress(payload.sender)
  const recipientCooked = await cookAddress(payload.recipient)
  
  // Hash keys
  const claimKeyHash = await hashKey(hexToBytes(payload.claimKey))
  const refundKeyHash = await hashKey(hexToBytes(payload.refundKey))
  
  return {
    ciphertext: fullCiphertext,
    keyForSender,
    keyForRecipient,
    keyForAdmin,
    senderCooked,
    recipientCooked,
    claimKeyHash,
    refundKeyHash,
  }
}

/**
 * Decrypt order payload (for recipient)
 * 
 * @param encrypted - Encrypted order data from chain
 * @param viewingPrivKey - Recipient's viewing private key (32 bytes)
 */
export async function decryptOrderPayload(
  ciphertext: Uint8Array,
  wrappedKey: Uint8Array,  // keyForSender or keyForRecipient
  viewingPrivKey: Uint8Array
): Promise<OrderPayload> {
  // Unwrap random key using viewing private key
  const randomKey = await eciesDecrypt(wrappedKey, viewingPrivKey)
  
  // Unpack ciphertext: iv (12) || encrypted
  const iv = ciphertext.slice(0, AES_IV_LENGTH)
  const encrypted = ciphertext.slice(AES_IV_LENGTH)
  
  // Decrypt
  const payloadBytes = await aesDecrypt(encrypted, randomKey, iv)
  
  // Parse JSON
  const decoder = new TextDecoder()
  const payloadJson = decoder.decode(payloadBytes)
  
  return JSON.parse(payloadJson)
}

// ═══════════════════════════════════════════════════════════════════════════
// BCS Encoding Helpers (for Move contract calls)
// ═══════════════════════════════════════════════════════════════════════════

/** ULEB128 encode a number */
export function uleb128Encode(value: number): Uint8Array {
  const bytes: number[] = []
  let v = value
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    bytes.push(b)
  } while (v !== 0)
  return new Uint8Array(bytes)
}

/** BCS encode vector<u8> (ULEB128 length prefix + raw bytes) */
export function bcsEncodeVecU8(bytes: Uint8Array): Uint8Array {
  const lenBytes = uleb128Encode(bytes.length)
  return concat(lenBytes, bytes)
}

/** BCS encode address (32 raw bytes, padded) */
export function bcsEncodeAddress(addr: string): Uint8Array {
  // Handle both hex and bech32 addresses
  if (addr.startsWith('0x') || /^[0-9a-fA-F]+$/.test(addr)) {
    // Hex address
    const clean = addr.replace(/^0x/, '').padStart(64, '0')
    return hexToBytes(clean)
  } else if (addr.startsWith('init1')) {
    // Bech32 address - decode manually
    // bech32 charset: qpzry9x8gf2tvdw0s3jn54khce6mua7l
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    const data = addr.slice(5) // Remove 'init1' prefix
    const values: number[] = []
    for (const c of data) {
      const idx = CHARSET.indexOf(c)
      if (idx === -1) throw new Error(`Invalid bech32 char: ${c}`)
      values.push(idx)
    }
    // Remove checksum (last 6 values)
    const words = values.slice(0, -6)
    // Convert from 5-bit words to 8-bit bytes
    let bits = 0
    let value = 0
    const bytes: number[] = []
    for (const word of words) {
      value = (value << 5) | word
      bits += 5
      while (bits >= 8) {
        bits -= 8
        bytes.push((value >> bits) & 0xff)
      }
    }
    // Pad to 32 bytes
    while (bytes.length < 32) bytes.unshift(0)
    return new Uint8Array(bytes)
  }
  throw new Error(`Invalid address format: ${addr}`)
}

/** BCS encode u8 (single byte) */
export function bcsEncodeU8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff])
}

/** BCS encode u64 (little-endian 8 bytes) */
export function bcsEncodeU64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number((value >> BigInt(i * 8)) & 0xffn)
  }
  return bytes
}
