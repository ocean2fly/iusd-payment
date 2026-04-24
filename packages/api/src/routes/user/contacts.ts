import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db'
import { requireAuth } from '../../middleware/auth'

/**
 * Ownership guard: ensures the authenticated caller (request.userAddress,
 * set by requireAuth) matches the `userAddr` that was resolved from the
 * route param. Prevents shortId enumeration from reading/writing another
 * user's contact list.
 */
function assertSelf(request: FastifyRequest, reply: FastifyReply, userAddr: string): boolean {
  const caller = String((request as any).userAddress ?? '').toLowerCase()
  if (!caller || caller !== userAddr.toLowerCase()) {
    reply.status(403).send({ error: 'FORBIDDEN' })
    return false
  }
  return true
}

interface Contact {
  id: number
  contactAddr: string
  nickname: string | null
  avatar: string | null
  notes: string | null
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
}

function ensureTable() {
  // Table created by main DB migration (db/index.ts or postgres.ts)
  // This is a no-op safety check
  try { getDb().exec(`
    CREATE TABLE IF NOT EXISTS user_contacts (
      id SERIAL PRIMARY KEY,
      user_addr TEXT NOT NULL,
      contact_addr TEXT NOT NULL,
      nickname TEXT,
      avatar TEXT,
      notes TEXT,
      tags TEXT,
      favorite INTEGER DEFAULT 0,
      created_at BIGINT,
      updated_at BIGINT,
      UNIQUE(user_addr, contact_addr)
    );
    CREATE INDEX IF NOT EXISTS idx_user_contacts_user ON user_contacts(user_addr);
    CREATE INDEX IF NOT EXISTS idx_user_contacts_favorite ON user_contacts(user_addr, favorite);
  `) } catch { /* table may already exist with different syntax */ }
}

function parseContact(row: any): Contact {
  return {
    id: row.id,
    contactAddr: row.contact_addr,
    nickname: row.nickname,
    avatar: row.avatar,
    notes: row.notes,
    tags: row.tags ? JSON.parse(row.tags) : [],
    favorite: Number(row.favorite) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/**
 * Resolve an incoming `:userAddr` param to the canonical bech32 address we
 * store in user_contacts.user_addr.
 *
 * PRIVACY: this ONLY accepts a public shortId. init1 wallet addresses are
 * explicitly rejected — the server must never take an address as a lookup
 * key for contacts (or any identity-linked table) because that would let a
 * caller probe "does wallet X have a contact list?" and link address ↔
 * shortId. Callers MUST pass their public shortId.
 */
function resolveUserAddr(db: any, raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // Hard-reject anything that looks like a bech32 address.
  if (/^init1[a-z0-9]+$/i.test(trimmed)) return null
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return null
  // Accept only a shortId (uppercase, short base32 string).
  const shortId = trimmed.toUpperCase()
  try {
    const row = db.prepare('SELECT address FROM accounts WHERE short_id = ?').get(shortId) as any
    return row?.address ? String(row.address).toLowerCase() : null
  } catch { return null }
}

export async function contactsRoutes(app: FastifyInstance) {
  ensureTable()

  app.get('/contacts/:userAddr', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAddr: rawParam } = request.params as { userAddr: string }
    // Privacy: reject init1/bech32 probes outright.
    if (/^init1[a-z0-9]+$/i.test(rawParam) || /^0x[0-9a-f]+$/i.test(rawParam)) {
      return reply.status(400).send({ error: 'INVALID_IDENTIFIER', message: 'Pass your shortId, not a wallet address' })
    }
    const db = getDb()
    const userAddr = resolveUserAddr(db, rawParam)
    if (!userAddr) return { contacts: [], total: 0, limit: 0, offset: 0 }
    if (!assertSelf(request, reply, userAddr)) return
    const { favorites, search, limit = 100, offset = 0 } = request.query as any

    let sql = 'SELECT * FROM user_contacts WHERE user_addr = ?'
    const params: any[] = [userAddr]

    if (favorites === 'true') sql += ' AND favorite = 1'
    if (search) {
      sql += ' AND (nickname LIKE ? OR contact_addr LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    sql += ' ORDER BY favorite DESC, nickname ASC, created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit), parseInt(offset))

    try {
      const rows = db.prepare(sql).all(...params)
      const countRow = db.prepare('SELECT COUNT(*) as count FROM user_contacts WHERE user_addr = ?').get(userAddr) as any
      return { contacts: rows.map(parseContact), total: Number(countRow?.count ?? 0), limit: parseInt(limit), offset: parseInt(offset) }
    } catch (err: any) {
      app.log.error({ err, userAddr }, '[Contacts] Failed to list contacts')
      return reply.status(500).send({ error: err.message })
    }
  })

  app.post('/contacts/:userAddr', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAddr: rawParam } = request.params as { userAddr: string }
    if (/^init1[a-z0-9]+$/i.test(rawParam) || /^0x[0-9a-f]+$/i.test(rawParam)) {
      return reply.status(400).send({ error: 'INVALID_IDENTIFIER', message: 'Pass your shortId, not a wallet address' })
    }
    const userAddr = resolveUserAddr(getDb(), rawParam)
    if (!userAddr) return reply.status(404).send({ error: 'User not found' })
    if (!assertSelf(request, reply, userAddr)) return
    const { contactAddr, nickname, avatar, notes, tags = [], favorite = false } = request.body as any
    if (!contactAddr) return reply.status(400).send({ error: 'contactAddr is required' })

    try {
      getDb().prepare(`
        INSERT INTO user_contacts (user_addr, contact_addr, nickname, avatar, notes, tags, favorite)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_addr, contact_addr) DO UPDATE SET
          nickname = excluded.nickname,
          avatar = excluded.avatar,
          notes = excluded.notes,
          tags = excluded.tags,
          favorite = excluded.favorite,
          updated_at = extract(epoch from now())::bigint
      `).run(
        userAddr,
        contactAddr.toLowerCase(),
        nickname || null,
        avatar || null,
        notes || null,
        JSON.stringify(tags),
        favorite ? 1 : 0
      )

      return { success: true, message: 'Contact saved' }
    } catch (err: any) {
      app.log.error({ err, userAddr, contactAddr }, '[Contacts] Failed to add contact')
      return reply.status(500).send({ error: err.message })
    }
  })

  app.put('/contacts/:userAddr/:contactAddr', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAddr: rawParam, contactAddr } = request.params as { userAddr: string; contactAddr: string }
    if (/^init1[a-z0-9]+$/i.test(rawParam) || /^0x[0-9a-f]+$/i.test(rawParam)) {
      return reply.status(400).send({ error: 'INVALID_IDENTIFIER', message: 'Pass your shortId, not a wallet address' })
    }
    const userAddr = resolveUserAddr(getDb(), rawParam)
    if (!userAddr) return reply.status(404).send({ error: 'User not found' })
    if (!assertSelf(request, reply, userAddr)) return
    const { nickname, avatar, notes, tags, favorite } = request.body as any
    const updates: string[] = []
    const params: any[] = []

    if (nickname !== undefined) { updates.push('nickname = ?'); params.push(nickname) }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar) }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes) }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)) }
    if (favorite !== undefined) { updates.push('favorite = ?'); params.push(favorite ? 1 : 0) }
    if (updates.length === 0) return reply.status(400).send({ error: 'No fields to update' })

    updates.push('updated_at = extract(epoch from now())::bigint')
    params.push(userAddr, contactAddr.toLowerCase())

    try {
      const result = getDb().prepare(`
        UPDATE user_contacts SET ${updates.join(', ')}
        WHERE user_addr = ? AND contact_addr = ?
      `).run(...params)

      if (result.changes === 0) return reply.status(404).send({ error: 'Contact not found' })
      return { success: true, message: 'Contact updated' }
    } catch (err: any) {
      app.log.error({ err, userAddr, contactAddr }, '[Contacts] Failed to update contact')
      return reply.status(500).send({ error: err.message })
    }
  })

  app.delete('/contacts/:userAddr/:contactAddr', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userAddr: rawParam, contactAddr } = request.params as { userAddr: string; contactAddr: string }
    if (/^init1[a-z0-9]+$/i.test(rawParam) || /^0x[0-9a-f]+$/i.test(rawParam)) {
      return reply.status(400).send({ error: 'INVALID_IDENTIFIER', message: 'Pass your shortId, not a wallet address' })
    }
    const userAddr = resolveUserAddr(getDb(), rawParam)
    if (!userAddr) return reply.status(404).send({ error: 'User not found' })
    if (!assertSelf(request, reply, userAddr)) return
    try {
      const result = getDb().prepare('DELETE FROM user_contacts WHERE user_addr = ? AND contact_addr = ?')
        .run(userAddr, contactAddr.toLowerCase())
      if (result.changes === 0) return reply.status(404).send({ error: 'Contact not found' })
      return { success: true, message: 'Contact deleted' }
    } catch (err: any) {
      app.log.error({ err, userAddr, contactAddr }, '[Contacts] Failed to delete contact')
      return reply.status(500).send({ error: err.message })
    }
  })
}
