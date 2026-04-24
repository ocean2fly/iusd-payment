/**
 * iPay Admin JWT Authentication
 * 
 * POST /v1/admin/auth/challenge  — Get challenge to sign
 * POST /v1/admin/auth/login      — Verify signature, get JWT
 * GET  /v1/admin/auth/verify     — Verify JWT is valid
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { computeAddress, verifyMessage } from 'ethers'
import { bech32 } from 'bech32'

// Config
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_KEY || 'ipay-admin-secret-change-me'
const JWT_EXPIRES_IN = '24h'
const CHALLENGE_EXPIRES_MS = 5 * 60 * 1000 // 5 minutes

/** Convert bech32 (init1...) or hex (0x...) to lowercase EVM hex */
function toEvmAddress(addr: string): string {
  if (addr.startsWith('0x')) return addr.toLowerCase()
  try {
    const { words } = bech32.decode(addr)
    const bytes = bech32.fromWords(words)
    return '0x' + Buffer.from(bytes).toString('hex').toLowerCase()
  } catch {
    return addr.toLowerCase()
  }
}

function normalizeAddress(address: string): string {
  return toEvmAddress(address.trim())
}

function addAddress(target: Set<string>, address?: string | null): void {
  if (!address) return
  const normalized = normalizeAddress(address)
  if (normalized) target.add(normalized)
}

function addCsvAddresses(target: Set<string>, addresses?: string | null): void {
  if (!addresses) return
  addresses
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => addAddress(target, value))
}

function adminAddressFromPubkey(pubkey?: string | null): string | null {
  if (!pubkey) return null
  try {
    const normalized = pubkey.startsWith('0x') ? pubkey : `0x${pubkey}`
    return normalizeAddress(computeAddress(normalized))
  } catch {
    return null
  }
}

function getAdminAddresses(): string[] {
  const addrs = new Set<string>()

  addAddress(addrs, adminAddressFromPubkey(process.env.ADMIN_PUBKEY))
  addAddress(addrs, process.env.ADMIN_ADDRESS)
  addCsvAddresses(addrs, process.env.ADMIN_ADDRESSES)

  return Array.from(addrs)
}
const ADMIN_ADDRESSES = getAdminAddresses()

// Pending challenges (in production, use Redis)
const pendingChallenges = new Map<string, { challenge: string; expires: number }>()

// Clean expired challenges periodically
setInterval(() => {
  const now = Date.now()
  for (const [addr, data] of pendingChallenges.entries()) {
    if (data.expires < now) pendingChallenges.delete(addr)
  }
}, 60000)

function isAdminAddress(address: string): boolean {
  const lower = normalizeAddress(address)
  return ADMIN_ADDRESSES.includes(lower)
}

// Also export for use in verifyAdminJWT
export { isAdminAddress }

export async function adminAuthRoutes(app: FastifyInstance) {
  /**
   * POST /v1/admin/auth/challenge
   * Generate a challenge for the wallet to sign
   */
  app.post('/auth/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    const { address } = request.body as { address?: string }

    if (!address) {
      return reply.status(400).send({ error: 'ADDRESS_REQUIRED' })
    }

    // Check if admin
    if (!isAdminAddress(address)) {
      return reply.status(403).send({ error: 'NOT_ADMIN', message: 'This address is not authorized' })
    }

    // Generate challenge
    const nonce = crypto.randomBytes(16).toString('hex')
    const timestamp = Date.now()
    const challenge = `iPay Admin Login\n\nAddress: ${address}\nNonce: ${nonce}\nTimestamp: ${timestamp}`

    // Store challenge keyed by EVM address
    pendingChallenges.set(normalizeAddress(address), {
      challenge,
      expires: timestamp + CHALLENGE_EXPIRES_MS,
    })

    return reply.send({
      challenge,
      expiresIn: CHALLENGE_EXPIRES_MS / 1000,
    })
  })

  /**
   * POST /v1/admin/auth/login
   * Verify signature and issue JWT
   */
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { address, signature, pubKey } = request.body as {
      address?: string
      signature?: string
      pubKey?: string
    }

    if (!address || !signature) {
      return reply.status(400).send({ error: 'ADDRESS_AND_SIGNATURE_REQUIRED' })
    }

    const evmAddr = normalizeAddress(address)

    // Check if admin
    if (!isAdminAddress(address)) {
      return reply.status(403).send({ error: 'NOT_ADMIN' })
    }

    // Get pending challenge
    const pending = pendingChallenges.get(evmAddr)
    if (!pending) {
      return reply.status(400).send({ error: 'NO_PENDING_CHALLENGE', message: 'Request a challenge first' })
    }

    if (pending.expires < Date.now()) {
      pendingChallenges.delete(evmAddr)
      return reply.status(400).send({ error: 'CHALLENGE_EXPIRED' })
    }

    // Verify EVM signature (personal_sign)
    try {
      const recoveredAddr = verifyMessage(pending.challenge, signature)

      // Check if recovered address matches or is an admin
      if (recoveredAddr.toLowerCase() !== evmAddr &&
          !isAdminAddress(recoveredAddr)) {
        app.log.warn({ address, recoveredAddr }, 'Signature mismatch')
        return reply.status(401).send({ error: 'INVALID_SIGNATURE' })
      }
      
      app.log.info({ address, recoveredAddr }, 'Signature verified')
    } catch (err: any) {
      app.log.error({ error: err.message }, 'Signature verification failed')
      return reply.status(401).send({ error: 'SIGNATURE_VERIFICATION_FAILED', message: err.message })
    }

    // Clear challenge
    pendingChallenges.delete(evmAddr)

    // Issue JWT
    const token = jwt.sign(
      {
        sub: address,
        role: 'admin',
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    )

    app.log.info({ address }, 'Admin login successful')

    return reply.send({
      token,
      expiresIn: JWT_EXPIRES_IN,
      address,
    })
  })

  /**
   * GET /v1/admin/auth/verify
   * Verify JWT is valid
   */
  app.get('/auth/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization
    
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'NO_TOKEN' })
    }

    const token = authHeader.slice(7)

    try {
      const payload = jwt.verify(token, JWT_SECRET) as any
      
      return reply.send({
        valid: true,
        address: payload.sub,
        role: payload.role,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
      })
    } catch (err: any) {
      return reply.status(401).send({ 
        error: 'INVALID_TOKEN',
        message: err.message,
      })
    }
  })
}

/**
 * Middleware to verify admin JWT
 */
export function verifyAdminJWT(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const authHeader = request.headers.authorization
  
  // Also accept X-Admin-Address for backward compatibility during transition
  const adminAddr = (request.headers as any)['x-admin-address']
  if (adminAddr && isAdminAddress(adminAddr)) {
    ;(request as any).adminAddress = adminAddr
    return done()
  }

  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'UNAUTHORIZED', message: 'JWT required' })
    return
  }

  const token = authHeader.slice(7)
  const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_KEY || 'ipay-admin-secret-change-me'

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any
    
    if (payload.role !== 'admin') {
      reply.status(403).send({ error: 'FORBIDDEN', message: 'Admin role required' })
      return
    }

    ;(request as any).adminAddress = payload.sub
    done()
  } catch (err: any) {
    reply.status(401).send({ error: 'INVALID_TOKEN', message: err.message })
  }
}

export default adminAuthRoutes
