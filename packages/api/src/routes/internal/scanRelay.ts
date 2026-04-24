/**
 * Scan Relay — WebRTC-based live camera relay + basic result relay
 *
 * Basic relay:
 *   POST /scan-relay                    — create session
 *   POST /scan-relay/:id/result         — phone posts decoded result
 *   GET  /scan-relay/:id                — desktop polls result
 *
 * WebRTC live stream signaling:
 *   PUT  /scan-relay/:id/offer          — desktop posts SDP offer
 *   GET  /scan-relay/:id/offer          — phone polls for offer
 *   PUT  /scan-relay/:id/answer         — phone posts SDP answer
 *   GET  /scan-relay/:id/answer         — desktop polls answer
 *   POST /scan-relay/:id/ice/:role      — add ICE candidate (role: desktop|phone)
 *   GET  /scan-relay/:id/ice/:role      — poll ICE candidates
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db'

function ensureTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_sessions (
      id         TEXT PRIMARY KEY,
      result     TEXT,
      created_at TEXT DEFAULT (now()::text),
      used_at    TEXT
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webrtc_sessions (
      id           TEXT PRIMARY KEY,
      offer        TEXT,
      answer       TEXT,
      desktop_ice  TEXT NOT NULL DEFAULT '[]',
      phone_ice    TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT DEFAULT (now()::text)
    )
  `)
}

function genId() {
  const bytes = new Uint8Array(12)
  for (let i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('')
}

export async function scanRelayRoutes(app: FastifyInstance) {

  // ── Basic relay ─────────────────────────────────────────────────────────

  app.post('/scan-relay', async (_req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    db.prepare("DELETE FROM scan_sessions WHERE created_at < (now() - interval '10 minutes')::text").run()
    db.prepare("DELETE FROM webrtc_sessions WHERE created_at < (now() - interval '10 minutes')::text").run()
    const id = genId()
    db.prepare('INSERT INTO scan_sessions (id) VALUES (?) ON CONFLICT DO NOTHING').run(id)
    db.prepare('INSERT INTO webrtc_sessions (id) VALUES (?) ON CONFLICT DO NOTHING').run(id)
    return reply.send({ sessionId: id })
  })

  app.post('/scan-relay/:id/result', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id } = req.params as { id: string }
    const { result } = req.body as { result: string }
    if (!result) return reply.status(400).send({ error: 'result required' })
    db.prepare('INSERT INTO scan_sessions (id) VALUES (?) ON CONFLICT DO NOTHING').run(id)
    db.prepare("UPDATE scan_sessions SET result = ?, used_at = now()::text WHERE id = ?").run(result, id)
    return reply.send({ ok: true })
  })

  app.get('/scan-relay/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT result FROM scan_sessions WHERE id = ?').get(id) as any
    if (!row) return reply.status(404).send({ error: 'not found' })
    return reply.send({ result: row.result ?? null })
  })

  // ── WebRTC signaling ────────────────────────────────────────────────────

  /** Desktop posts SDP offer */
  app.put('/scan-relay/:id/offer', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id } = req.params as { id: string }
    const { sdp } = req.body as { sdp: string }
    db.prepare('INSERT INTO webrtc_sessions (id) VALUES (?) ON CONFLICT DO NOTHING').run(id)
    db.prepare('UPDATE webrtc_sessions SET offer = ? WHERE id = ?').run(JSON.stringify(sdp), id)
    return reply.send({ ok: true })
  })

  /** Phone polls for offer */
  app.get('/scan-relay/:id/offer', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT offer FROM webrtc_sessions WHERE id = ?').get(id) as any
    if (!row) return reply.status(404).send({ error: 'not found' })
    return reply.send({ sdp: row.offer ? JSON.parse(row.offer) : null })
  })

  /** Phone posts SDP answer */
  app.put('/scan-relay/:id/answer', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id } = req.params as { id: string }
    const { sdp } = req.body as { sdp: string }
    db.prepare('INSERT INTO webrtc_sessions (id) VALUES (?) ON CONFLICT DO NOTHING').run(id)
    db.prepare('UPDATE webrtc_sessions SET answer = ? WHERE id = ?').run(JSON.stringify(sdp), id)
    return reply.send({ ok: true })
  })

  /** Desktop polls for answer */
  app.get('/scan-relay/:id/answer', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT answer FROM webrtc_sessions WHERE id = ?').get(id) as any
    if (!row) return reply.status(404).send({ error: 'not found' })
    return reply.send({ sdp: row.answer ? JSON.parse(row.answer) : null })
  })

  /** Add ICE candidate */
  app.post('/scan-relay/:id/ice/:role', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id, role } = req.params as { id: string; role: string }
    const { candidate } = req.body as { candidate: RTCIceCandidateInit }
    if (role !== 'desktop' && role !== 'phone') return reply.status(400).send({ error: 'invalid role' })
    db.prepare('INSERT INTO webrtc_sessions (id) VALUES (?) ON CONFLICT DO NOTHING').run(id)
    const col = role === 'desktop' ? 'desktop_ice' : 'phone_ice'
    const row = db.prepare(`SELECT ${col} FROM webrtc_sessions WHERE id = ?`).get(id) as any
    const arr = row ? JSON.parse(row[col] || '[]') : []
    arr.push(candidate)
    db.prepare(`UPDATE webrtc_sessions SET ${col} = ? WHERE id = ?`).run(JSON.stringify(arr), id)
    return reply.send({ ok: true })
  })

  /** Get ICE candidates */
  app.get('/scan-relay/:id/ice/:role', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { id, role } = req.params as { id: string; role: string }
    if (role !== 'desktop' && role !== 'phone') return reply.status(400).send({ error: 'invalid role' })
    const col = role === 'desktop' ? 'desktop_ice' : 'phone_ice'
    const row = db.prepare(`SELECT ${col} FROM webrtc_sessions WHERE id = ?`).get(id) as any
    if (!row) return reply.status(404).send({ error: 'not found' })
    return reply.send({ candidates: JSON.parse(row[col] || '[]') })
  })
}
