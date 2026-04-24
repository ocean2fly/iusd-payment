/**
 * requireAuth middleware — single source of truth
 *
 * Validates Bearer session token against auth_sessions DB table.
 * Sets request.userAddress on success.
 *
 * Used by: account routes, payment routes, any authenticated endpoint.
 */
import { FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../db/index'

function normalizeAddress(addr: string): string {
  return addr.toLowerCase()
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'MISSING_AUTH', message: 'Authorization required' })
  }

  const token = authHeader.slice(7)
  try {
    const db = getDb()
    const session = db.prepare(
      'SELECT address, expires_at FROM auth_sessions WHERE session_id = ? AND revoked = 0'
    ).get(token) as { address: string; expires_at: string } | undefined

    if (!session) {
      return reply.status(401).send({ error: 'INVALID_TOKEN' })
    }

    if (new Date() > new Date(session.expires_at)) {
      return reply.status(401).send({ error: 'SESSION_EXPIRED' })
    }

    const normalizedAddr = normalizeAddress(session.address)

    // Fetch full account (frozen check + route handlers need address, short_id, etc.)
    const account = db.prepare(
      `SELECT address, short_id, nickname, frozen_at, viewing_privkey_enc,
              default_claim_address, avatar_svg, short_seal_svg
       FROM accounts WHERE address = ?`
    ).get(normalizedAddr) as any | undefined

    if (account?.frozen_at) {
      return reply.status(403).send({
        error: 'ACCOUNT_FROZEN',
        message: 'Your account has been suspended. Contact support.'
      })
    }

    ;(request as any).userAddress = normalizedAddr
    ;(request as any).account = account  // full account row available to handlers
  } catch {
    return reply.status(401).send({ error: 'INVALID_TOKEN' })
  }
}
