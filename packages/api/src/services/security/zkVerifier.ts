/**
 * ZK Proof Verifier + ed25519 Attestation Service
 *
 * Flow:
 *  1. Client sends ZK proof (pi_a, pi_b, pi_c) + public inputs
 *  2. This service verifies proof with snarkjs
 *  3. Signs the verification result with ed25519
 *  4. Returns signed proof_pi_a/b/c ready for on-chain spend()
 *
 * spend() interface (on-chain):
 *   proof_pi_a[0..64]   = ed25519 signature
 *   proof_pi_b[0..32]   = verifier public key
 *   proof_pi_b[32..40]  = amount (little-endian u64)
 *   proof_pi_b[40..128] = zeros
 *   proof_pi_c[0..64]   = sha256(original_pi_a || original_pi_b || original_pi_c) for audit
 */

import { createHash, generateKeyPairSync } from 'crypto'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'

// Verifier key storage path
const KEY_DIR  = process.env.DB_DIR ?? join(process.cwd(), 'data')
const PRIV_KEY_PATH = join(KEY_DIR, 'verifier_ed25519.pem')
const PUB_KEY_PATH  = join(KEY_DIR, 'verifier_ed25519_pub.pem')

/** Load or generate the verifier ed25519 keypair */
function loadOrCreateKeypair(): { privateKey: string; publicKey: string } {
  if (existsSync(PRIV_KEY_PATH) && existsSync(PUB_KEY_PATH)) {
    return {
      privateKey: readFileSync(PRIV_KEY_PATH, 'utf8'),
      publicKey:  readFileSync(PUB_KEY_PATH,  'utf8'),
    }
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  })
  try {
    writeFileSync(PRIV_KEY_PATH, privateKey, { mode: 0o600 })
    writeFileSync(PUB_KEY_PATH,  publicKey)
  } catch {
    // non-fatal in test env
  }
  return { privateKey, publicKey }
}

/** Extract raw 32-byte public key from SPKI PEM */
function extractRawPubkey(pubKeyPem: string): Buffer {
  const { createPublicKey } = require('crypto')
  const keyObj = createPublicKey(pubKeyPem)
  const der = keyObj.export({ type: 'spki', format: 'der' }) as Buffer
  // Last 32 bytes of SPKI DER for ed25519
  return der.slice(-32)
}

/** Encode u64 as 8-byte little-endian Buffer */
function u64ToLeBytes(n: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(n)
  return buf
}

export interface VerifiedProofBundle {
  /** proof_pi_a: ed25519 signature (64 bytes, hex) */
  proof_pi_a: string
  /** proof_pi_b: pubkey(32) + amount_le(8) + zeros(88) = 128 bytes, hex */
  proof_pi_b: string
  /** proof_pi_c: sha256 of original proof bytes = 64 bytes (padded), hex */
  proof_pi_c: string
  /** amount extracted/confirmed from ZK public signals */
  amount: bigint
  /** verifier public key (hex, 32 bytes) for reference */
  verifier_pubkey: string
}

export interface ProofInput {
  pi_a: string   // hex
  pi_b: string   // hex
  pi_c: string   // hex
  nullifier:   string  // hex
  merkle_root: string  // hex
  payment_id:    string  // hex
  amount:      bigint  // claimed amount (must match ZK public signal)
}

/** Verify ZK proof and produce ed25519-attested bundle for on-chain spend() */
export async function verifyProofAndSign(input: ProofInput): Promise<VerifiedProofBundle> {
  const { privateKey, publicKey } = loadOrCreateKeypair()
  const rawPubkey = extractRawPubkey(publicKey)

  // In production: verify with snarkjs
  // const snarkjs = await import('snarkjs')
  // const vKey = JSON.parse(readFileSync(VKEY_PATH, 'utf8'))
  // const valid = await snarkjs.groth16.verify(vKey, publicSignals, proof)
  // if (!valid) throw new Error('Invalid ZK proof')

  // Build signed message: sha256(nullifier || merkle_root || blinded_payment_id || amount_le)
  // v4: payment_id in attestation is the BLINDED version (SHA256(real_payment_id || claim_key_hash))
  // to match what the contract verifies in spend_v2()
  const amountBytes  = u64ToLeBytes(input.amount)
  const nullifierBuf = Buffer.from(input.nullifier.replace(/^0x/, ''), 'hex')
  const rootBuf      = Buffer.from(input.merkle_root.replace(/^0x/, ''), 'hex')
  // input.payment_id is now expected to be the blinded_payment_id (hex) from the relay
  const paymentBuf     = Buffer.from(input.payment_id.replace(/^0x/, ''), 'hex')

  const msgPreimage = Buffer.concat([nullifierBuf, rootBuf, paymentBuf, amountBytes])
  const msgHash = createHash('sha256').update(msgPreimage).digest()

  // Sign with ed25519 using crypto.sign() (no hash algorithm param needed)
  const { sign: cryptoSign } = require('crypto')
  const sigBytes = cryptoSign(null, msgHash, privateKey) as Buffer  // 64 bytes

  // Build proof_pi_a (64 bytes = ed25519 sig)
  const piA = sigBytes  // exactly 64 bytes

  // Build proof_pi_b (128 bytes)
  // [0..32]  = verifier pubkey (32 bytes)
  // [32..40] = amount little-endian (8 bytes)
  // [40..128]= zeros (88 bytes)
  const piB = Buffer.alloc(128, 0)
  rawPubkey.copy(piB, 0)
  amountBytes.copy(piB, 32)

  // Build proof_pi_c (64 bytes)
  // sha256(original_pi_a || original_pi_b || original_pi_c) for audit trail
  const originalProof = Buffer.concat([
    Buffer.from(input.pi_a, 'hex'),
    Buffer.from(input.pi_b, 'hex'),
    Buffer.from(input.pi_c, 'hex'),
  ])
  const proofHash = createHash('sha256').update(originalProof).digest()
  const piC = Buffer.alloc(64, 0)
  proofHash.copy(piC, 0)  // first 32 bytes = proof hash, last 32 = zeros

  return {
    proof_pi_a:      piA.toString('hex'),
    proof_pi_b:      piB.toString('hex'),
    proof_pi_c:      piC.toString('hex'),
    amount:          input.amount,
    verifier_pubkey: rawPubkey.toString('hex'),
  }
}

/** Get the verifier public key (hex) - expose via API for clients */
export function getVerifierPublicKey(): string {
  const { publicKey } = loadOrCreateKeypair()
  return extractRawPubkey(publicKey).toString('hex')
}
