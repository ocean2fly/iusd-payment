/**
 * Directory Routes — public account lookups (no auth required)
 *
 * GET /v1/account/search           — search by nickname or shortId
 * GET /v1/account/:shortId         — lookup by shortId
 * GET /v1/account/viewing-pubkey/:shortId — get viewing pubkey for encryption
 *
 * PRIVACY: these public endpoints MUST NOT leak the init1 address. The
 * responses are built from `formatAccountResponse` which now strips the
 * address field unless `{ includeAddress: true }` is passed — callers here
 * deliberately do not pass it. `/account/by-address/:address` was removed
 * for the same reason (it mapped a private wallet address back to a public
 * shortId/nickname).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db'
import { formatAccountResponse } from '../user/account'
import { ensureViewingKey } from '../../lib/viewingKey'

export async function directoryRoutes(app: FastifyInstance) {
  const db = getDb()

  /**
   * GET /v1/account/search?q=&limit=
   */
  app.get('/account/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const { q, limit = '10' } = request.query as { q?: string; limit?: string }

    if (!q || q.length < 2) {
      return reply.status(400).send({ error: 'INVALID_QUERY', message: 'Query must be at least 2 characters' })
    }

    const maxLimit = Math.min(parseInt(limit) || 10, 50)
    const term = `%${q}%`

    const accounts = db.prepare(`
      SELECT * FROM accounts
      WHERE nickname LIKE ? OR short_id LIKE ?
      LIMIT ?
    `).all(term, term.toUpperCase(), maxLimit) as any[]

    return { results: accounts.map(a => formatAccountResponse(a)), count: accounts.length }
  })

  /**
   * GET /v1/account/:shortId?checksum=
   */
  app.get('/account/:shortId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = request.params as { shortId: string }
    const { checksum } = request.query as { checksum?: string }

    const account = db.prepare('SELECT * FROM accounts WHERE short_id = ?').get(shortId.toUpperCase()) as any
    if (!account) return reply.status(404).send({ error: 'NOT_FOUND' })

    if (checksum && checksum.toUpperCase() !== account.checksum) {
      return reply.status(400).send({ error: 'CHECKSUM_MISMATCH' })
    }

    const accountStatus = account.deleted_at ? 'deleted' : account.frozen_at ? 'frozen' : 'active'
    return { account: formatAccountResponse(account), status: accountStatus }
  })

  /**
   * GET /v1/account/viewing-pubkey/:shortId
   * Get viewing public key (for senders to encrypt claim keys).
   * PRIVACY: response intentionally omits `address` — senders only need the
   * shortId + pubkey to encrypt. The address stays private.
   */
  app.get('/account/viewing-pubkey/:shortId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = request.params as { shortId: string }

    const account = db.prepare(
      'SELECT address, short_id, checksum, nickname FROM accounts WHERE short_id = ?'
    ).get(shortId.toUpperCase()) as any

    if (!account) return reply.status(404).send({ error: 'NOT_FOUND' })

    // Single source of truth = accounts.pubkey. Auto-backfill legacy
    // accounts (same helper as /gift/send and /account/viewing-pubkey).
    let viewingPubkey: string
    try {
      const vk = ensureViewingKey(db, account.address)
      viewingPubkey = vk.pubkeyHex
    } catch (err: any) {
      return reply.status(500).send({ error: 'viewing key unavailable', detail: err.message })
    }

    return {
      viewingPubkey,
      shortId: account.short_id,
      checksum: account.checksum,
      nickname: account.nickname,
    }
  })
}
