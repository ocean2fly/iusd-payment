/**
 * Pay Sessions — dynamic payment QR code flow
 *
 * POST /v1/pay-session/create       — payer creates a session (auth)
 * GET  /v1/pay-session/:token       — poll session status (public)
 * POST /v1/pay-session/:token/fill  — payee fills in their ID + amount (public)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomBytes } from 'crypto'
import { getDb } from '../../db'
import { requireAuth } from '../../middleware/auth'

const SESSION_TTL_MS = 5 * 60 * 1000  // 5 minutes

export async function paySessionRoutes(app: FastifyInstance) {
  const db = getDb()

  /**
   * POST /v1/pay-session/create
   * Payer creates a session. Returns token + URL for QR display.
   */
  app.post('/pay-session/create', { preHandler: [requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const account = (req as any).account
    const token = randomBytes(8).toString('hex')
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

    db.prepare(`
      INSERT INTO pay_sessions (token, payer_short_id, payer_address, status, expires_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(token, account.short_id, account.address, expiresAt)

    return reply.send({ token, expiresAt })
  })

  /**
   * GET /v1/pay-session/:token
   * Poll session status. Returns pending/filled/expired.
   */
  app.get('/pay-session/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string }

    const row = db.prepare(
      `SELECT * FROM pay_sessions WHERE token = ?`
    ).get(token) as any

    if (!row) return reply.status(404).send({ error: 'Session not found' })

    // Check expiry
    if (new Date(row.expires_at) < new Date()) {
      if (row.status === 'pending') {
        db.prepare(`UPDATE pay_sessions SET status='expired' WHERE token=?`).run(token)
      }
      return reply.send({ status: 'expired' })
    }

    return reply.send({
      status: row.status,
      payerShortId: row.payer_short_id,
      payeeShortId: row.payee_short_id ?? null,
      payeeNickname: row.payee_nickname ?? null,
      amount: row.amount ?? null,
      memo: row.memo ?? null,
      expiresAt: row.expires_at,
    })
  })

  /**
   * POST /v1/pay-session/:token/fill
   * Payee fills in their shortId + amount. Public (no auth).
   */
  app.post('/pay-session/:token/fill', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string }
    const { shortId, amount, memo } = req.body as { shortId: string; amount: string; memo?: string }

    if (!shortId || !amount) {
      return reply.status(400).send({ error: 'shortId and amount required' })
    }

    const row = db.prepare(
      `SELECT * FROM pay_sessions WHERE token = ? AND status = 'pending'`
    ).get(token) as any

    if (!row) return reply.status(404).send({ error: 'Session not found or already used' })

    if (new Date(row.expires_at) < new Date()) {
      db.prepare(`UPDATE pay_sessions SET status='expired' WHERE token=?`).run(token)
      return reply.status(410).send({ error: 'Session expired' })
    }

    // Look up payee nickname
    const payee = db.prepare(
      `SELECT nickname FROM accounts WHERE short_id = ?`
    ).get(shortId.toUpperCase()) as any

    db.prepare(`
      UPDATE pay_sessions
      SET payee_short_id = ?, payee_nickname = ?, amount = ?, memo = ?, status = 'filled'
      WHERE token = ? AND status = 'pending'
    `).run(shortId.toUpperCase(), payee?.nickname ?? shortId, amount, memo ?? null, token)

    return reply.send({ ok: true, payerShortId: row.payer_short_id })
  })
}
