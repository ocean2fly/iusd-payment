/**
 * Gift V3 API Routes
 *
 * GET  /v1/gift/boxes                — List enabled gift boxes (from chain)
 * POST /v1/gift/send                 — Prepare direct gift TX
 * POST /v1/gift/send-group           — Prepare group gift TX (generates secrets)
 * POST /v1/gift/confirm-send         — Confirm TX was broadcast
 * POST /v1/gift/claim                — Claim direct gift (sponsored)
 * POST /v1/gift/claim-slot           — Claim group gift slot (sponsored, legacy per-slot URL)
 * POST /v1/gift/claim-queue          — Claim group gift (single URL, server assigns slot)
 * GET  /v1/gift/packet/:packetId     — Get packet info + queue status
 * GET  /v1/gift/my-gifts             — List user's sent/received gifts
 * POST /v1/gift/thank                — Send thank-you for a gift
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db'
import { getGiftPoolAddress, getModuleAddress } from '../../shared/contract-config'
import { requireAuth } from '../../middleware/auth'
import {
  generatePacketId,
  generateClaimKey,
  generateAllocationSeed,
  generateSlotHashes,
  deriveSlotSecret,
  deriveProof,
  encodeGiftShortCode,
  encodeGiftGroupCode,
} from '../../lib/giftCrypto'
import {
  fetchEnabledBoxes,
  fetchAllBoxes,
  fetchPacket,
  fetchSlotsSummary,
} from '../../lib/giftChainQuery'
import {
  sponsorClaimDirect,
  sponsorClaimSlot,
} from '../../services/relayer/giftRelayer'
// NOTE: the gift claim worker runs in the SEPARATE `ipay-relayer`
// process (see relayer-main.ts). Importing triggerGiftClaimNow from
// here would execute processNextClaim in the API process context,
// where getGiftPool() has never been initialized — that throws
// "Relayer service not started" and markFailed the queue row.
// Rely on the 1.5s passive scan in the relayer process instead.
import { APP_URL } from '../../shared/config'
import { sendNotification } from '../../routes/internal/notify'
import {
  encryptOrderPayload,
  decryptPayloadForRecipient,
  generateSecretKey,
  hashKey,
} from '../../services/security/encryption'
import { ensureViewingKey } from '../../lib/viewingKey'
import { createHash, randomBytes as cryptoRandomBytes } from 'crypto'

// ── Shielded recipient blob helpers ─────────────────────────────────
//
// Under the new design, gift_v3::send_gift no longer takes a plaintext
// `recipient: address` parameter. Instead it takes `recipient_blob:
// vector<u8>` (ECIES ciphertext of {shortId, address, claimKey, memo,
// timestamp} encrypted for both the recipient's viewing_pk and the admin's
// viewing_pk) plus `claim_key_hash: vector<u8>` (sha256 of the bearer
// claim_key embedded in the blob).
//
// The blob is serialized as a versioned TLV container so both halves of
// the ECIES double-envelope (keyForUser + keyForAdmin) plus the AES-GCM
// ciphertext fit into a single `vector<u8>` on chain.
//
// Wire format (all big-endian):
//   [1]       version byte, currently 0x01
//   [2]       u16 keyForUser.length
//   [...]     keyForUser bytes (ECIES-wrapped AES key for recipient)
//   [2]       u16 keyForAdmin.length
//   [...]     keyForAdmin bytes (ECIES-wrapped AES key for admin)
//   [2]       u16 ciphertext.length
//   [...]     ciphertext bytes (iv || tag || AES-GCM encrypted payload JSON)

const RECIPIENT_BLOB_VERSION = 0x01

function serializeRecipientBlob(
  keyForUser: Buffer,
  keyForAdmin: Buffer,
  ciphertext: Buffer,
): Buffer {
  const parts: Buffer[] = []
  parts.push(Buffer.from([RECIPIENT_BLOB_VERSION]))
  const writeLenPrefixed = (b: Buffer) => {
    const len = Buffer.alloc(2)
    len.writeUInt16BE(b.length, 0)
    parts.push(len)
    parts.push(b)
  }
  writeLenPrefixed(keyForUser)
  writeLenPrefixed(keyForAdmin)
  writeLenPrefixed(ciphertext)
  return Buffer.concat(parts)
}

function deserializeRecipientBlob(blob: Buffer): {
  keyForUser: Buffer
  keyForAdmin: Buffer
  ciphertext: Buffer
} {
  let off = 0
  const version = blob.readUInt8(off)
  off += 1
  if (version !== RECIPIENT_BLOB_VERSION) {
    throw new Error(`unsupported recipient blob version: ${version}`)
  }
  const readLenPrefixed = (): Buffer => {
    const len = blob.readUInt16BE(off)
    off += 2
    const out = blob.subarray(off, off + len)
    off += len
    return Buffer.from(out)
  }
  return {
    keyForUser: readLenPrefixed(),
    keyForAdmin: readLenPrefixed(),
    ciphertext: readLenPrefixed(),
  }
}

function getAdminViewingPubKey(): Buffer {
  const hex = process.env.ADMIN_VIEWING_PK || ''
  if (!hex) {
    throw new Error('[gift] ADMIN_VIEWING_PK env not set')
  }
  return Buffer.from(hex.replace(/^0x/i, ''), 'hex')
}

const DEFAULT_GIFT_TTL_SECONDS = 7 * 24 * 60 * 60

const MEMO_FONTS = [
  'Dancing Script', 'Pacifico', 'Great Vibes', 'Satisfy',
  'Caveat', 'Indie Flower', 'Sacramento', 'Kalam',
  'Architects Daughter', 'Shadows Into Light', 'Amatic SC',
  'Lobster', 'Courgette', 'Cookie', 'Comforter',
]
function pickMemoFont(): string {
  return MEMO_FONTS[Math.floor(Math.random() * MEMO_FONTS.length)]
}

/** Generate randomized gift box visual params */
function generateWrapParams(): { texture: number; ribbonHueShift: number; rotateX: number; rotateY: number; scale: number } {
  return {
    texture: Math.floor(Math.random() * 10),          // 0-9 wrap texture
    ribbonHueShift: Math.floor(Math.random() * 360),   // ribbon color independent of DNA
    rotateX: -8 - Math.floor(Math.random() * 10),      // -8 to -17 deg
    rotateY: -12 - Math.floor(Math.random() * 14),     // -12 to -25 deg
    scale: 0.9 + Math.random() * 0.2,                  // 0.9 to 1.1
  }
}

/** Record a claim attempt (both successful queuing and rejections) */
function recordAttempt(db: any, packetId: string, address: string, result: 'queued' | 'rejected') {
  try {
    const acct = db.prepare('SELECT nickname FROM accounts WHERE lower(address) = lower(?)').get(address) as any
    db.prepare(`
      INSERT INTO gift_claim_attempts (packet_id, requester_address, requester_nickname, result)
      VALUES (?, ?, ?, ?)
    `).run(packetId, address, acct?.nickname ?? null, result)
  } catch {}
}

/** Get claim attempt stats for a packet */
function getAttemptStats(db: any, packetId: string) {
  const stats = db.prepare(`
    SELECT result, count(*) as cnt FROM gift_claim_attempts WHERE packet_id = ? GROUP BY result
  `).all(packetId) as { result: string; cnt: number }[]

  const rejected = db.prepare(`
    SELECT requester_nickname, requester_address, created_at
    FROM gift_claim_attempts WHERE packet_id = ? AND result = 'rejected'
    ORDER BY created_at DESC LIMIT 50
  `).all(packetId) as any[]

  return {
    totalRequests: stats.reduce((a, r) => a + Number(r.cnt), 0),
    queuedCount: Number(stats.find(r => r.result === 'queued')?.cnt ?? 0),
    rejectedCount: Number(stats.find(r => r.result === 'rejected')?.cnt ?? 0),
    rejectedUsers: rejected.map(r => ({
      nickname: r.requester_nickname ?? 'Anonymous',
      time: r.created_at,
    })),
  }
}

export async function giftRoutes(app: FastifyInstance) {

  // Clean up stale pending_tx gifts (older than 30 minutes)
  function cleanupStalePending() {
    try {
      const db = getDb()
      const result = db.prepare(
        `DELETE FROM gift_v3_packets WHERE status = 'pending_tx' AND created_at < (SELECT to_char(timezone('UTC', now() - interval '30 minutes'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`
      ).run()
      if (result.changes > 0) console.log(`[gift] Cleaned up ${result.changes} stale pending_tx packets`)
    } catch {}
  }
  cleanupStalePending()
  setInterval(cleanupStalePending, 10 * 60 * 1000)

  // ── GET /v1/gift/boxes ────────────────────────────────────────

  app.get('/gift/boxes', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const boxes = await fetchEnabledBoxes()
      return reply.send({ boxes })
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to fetch boxes', detail: err.message })
    }
  })

  // ── GET /v1/gift/configs — gift boxes merged with DB metadata for frontend ──

  app.get('/gift/configs', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const boxes = await fetchEnabledBoxes()
      const db = getDb()
      const configs = boxes.map((box: any) => {
        const meta = db.prepare('SELECT * FROM gift_box_meta WHERE box_id = ?').get(box.box_id) as any
        const imageUrls: string[] = meta ? JSON.parse(meta.image_urls || '[]') : (box.urls ?? [])
        const amountIusd = Number(box.amount) / 1_000_000
        const feeBps = Number(box.fee_bps || 0)
        const boxFee = amountIusd * feeBps / 10000
        return {
          giftId: box.box_id,
          amount: amountIusd,
          boxFee,
          feeBps,
          tier: meta?.collection || 'classic',
          tierLabel: meta?.collection ? meta.collection.charAt(0).toUpperCase() + meta.collection.slice(1) : 'Classic',
          title: meta?.name || box.name || `Gift #${box.box_id}`,
          artist: '',
          year: '',
          museum: '',
          culture: meta?.description || '',
          thumbUrl: imageUrls[0] || '',
          imageUrls,
          cooldownHours: 0,
          enabled: box.enabled,
          featured: meta?.featured === true || meta?.featured === 1,
          featuredSort: Number(meta?.featured_sort ?? 0),
        }
      })
      return reply.send({ configs })
    } catch (err: any) {
      return reply.status(500).send({ error: 'Failed to fetch configs', detail: err.message })
    }
  })

  // ── POST /v1/gift/send (direct gift) ─────────────────────────

  app.post('/gift/send', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { giftId, boxId, recipientAddress, recipientShortId, amount, message, ttl } = req.body as {
      giftId?: number
      boxId?: number
      recipientAddress: string
      recipientShortId?: string
      amount?: number
      message?: string
      ttl?: number
    }
    const finalBoxId = boxId ?? giftId

    if (!finalBoxId) {
      return reply.status(400).send({ error: 'boxId required' })
    }

    const packetId = generatePacketId()
    const packetIdHex = packetId.toString('hex')
    const pool = getGiftPoolAddress()
    const module = getModuleAddress()
    const ttlSeconds = ttl && ttl > 0 && ttl <= DEFAULT_GIFT_TTL_SECONDS ? ttl : DEFAULT_GIFT_TTL_SECONDS
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

    const db = getDb()
    const resolvedRecipient = recipientAddress || (
      recipientShortId
        ? (db.prepare('SELECT address FROM accounts WHERE short_id = ?').get(recipientShortId.toUpperCase()) as any)?.address
        : null
    )

    if (!resolvedRecipient) {
      return reply.status(400).send({ error: 'recipientAddress or valid recipientShortId required' })
    }

    // ── Resolve recipient viewing pubkey (server-custodial) ────────
    // Single source of truth = accounts.pubkey / accounts.viewing_privkey_enc.
    // ensureViewingKey() auto-backfills legacy accounts with empty columns.
    let recipientViewingPubKey: Buffer
    try {
      const vk = ensureViewingKey(db, resolvedRecipient)
      recipientViewingPubKey = Buffer.from(vk.pubkeyHex.replace(/^0x/i, ''), 'hex')
      if (recipientViewingPubKey.length !== 65) {
        throw new Error(`expected 65-byte uncompressed pubkey, got ${recipientViewingPubKey.length}`)
      }
    } catch (err: any) {
      return reply.status(500).send({
        error: 'recipient viewing key unavailable',
        detail: err.message,
      })
    }

    let adminViewingPubKey: Buffer
    try {
      adminViewingPubKey = getAdminViewingPubKey()
    } catch (err: any) {
      return reply.status(500).send({ error: 'admin viewing key not configured', detail: err.message })
    }

    // Generate the bearer claim_key (32 bytes random). This is the secret
    // the worker presents to sponsor_claim_direct; the contract verifies
    // sha2_256(claim_key) == claim_key_hash. The plaintext claim_key only
    // exists inside the encrypted blob, so only the recipient (or admin)
    // can recover it.
    const claimKey = generateSecretKey()
    const claimKeyHashBuf = hashKey(claimKey)
    const claimKeyHashHex = claimKeyHashBuf.toString('hex')

    const encrypted = encryptOrderPayload(
      {
        amount: String(amount ?? 0),
        memo: message ?? '',
        sender: userAddress,
        recipient: resolvedRecipient,
        claimKey: claimKey.toString('hex'),
        refundKey: '',
        createdAt: Math.floor(Date.now() / 1000),
      },
      recipientViewingPubKey,
      adminViewingPubKey,
    )

    const recipientBlob = serializeRecipientBlob(
      encrypted.keyForUser,
      encrypted.keyForAdmin,
      encrypted.ciphertext,
    )
    const recipientBlobHex = recipientBlob.toString('hex')

    const memoFont = message ? pickMemoFont() : null
    const wrapStyleId = Math.floor(Math.random() * 12)
    const wrapParams = generateWrapParams()
    wrapParams.texture = wrapStyleId // keep in sync
    db.prepare(`
      INSERT INTO gift_v3_packets (
        packet_id, box_id, sender_address, mode, recipient_address, num_slots,
        total_amount, sender_message, expires_at, memo_font, wrap_style_id, wrap_params
      )
      VALUES (?, ?, ?, 0, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(packetIdHex, finalBoxId, userAddress, resolvedRecipient, amount ?? 0, message ?? '', expiresAt, memoFont, wrapStyleId, JSON.stringify(wrapParams))

    const directClaimUrl = `${APP_URL}/gift/claim?p=${packetIdHex}`

    return reply.send({
      packetId: packetIdHex,
      memoFont: memoFont ?? undefined,
      wrapStyleId,
      wrapParams,
      claimUrl: directClaimUrl,
      claimLinks: [directClaimUrl],
      txParams: {
        moduleAddress: module,
        moduleName: 'gift_v3',
        functionName: 'send_gift',
        args: {
          pool,
          boxId: finalBoxId,
          packetId: packetIdHex,
          recipientBlob: recipientBlobHex,
          claimKeyHash: claimKeyHashHex,
          amount: amount ?? 0,
          ttl: ttl ?? 0,
        },
      },
    })
  })

  // ── POST /v1/gift/send-group ─────────────────────────────────

  app.post('/gift/send-group', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { giftId, boxId, numSlots, slots, amount, message, ttl, splitMode } = req.body as {
      giftId?: number
      boxId?: number
      numSlots?: number
      slots?: unknown[]
      amount?: number
      message?: string
      ttl?: number
      splitMode?: 'equal' | 'random'
    }
    const finalBoxId = boxId ?? giftId
    const finalNumSlots = numSlots ?? slots?.length ?? 0
    const isEqual = splitMode === 'equal'

    if (!finalBoxId || !finalNumSlots || finalNumSlots < 1) {
      return reply.status(400).send({ error: 'boxId and numSlots required' })
    }
    if (finalNumSlots > 200) {
      return reply.status(400).send({ error: 'Max 200 slots' })
    }

    const packetId = generatePacketId()
    const claimKey = generateClaimKey()
    const slotHashes = generateSlotHashes(claimKey, finalNumSlots)

    const packetIdHex = packetId.toString('hex')
    const claimKeyHex = claimKey.toString('hex')
    const slotHashesHex = slotHashes.map(h => h.toString('hex'))

    const pool = getGiftPoolAddress()
    const module = getModuleAddress()
    const ttlSeconds = ttl && ttl > 0 && ttl <= DEFAULT_GIFT_TTL_SECONDS ? ttl : DEFAULT_GIFT_TTL_SECONDS
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

    // For random mode, generate allocation seed; for equal mode, not needed
    const allocationSeed = isEqual ? null : generateAllocationSeed()
    const allocationSeedHex = allocationSeed?.toString('hex') ?? ''

    const db = getDb()
    const memoFont = message ? pickMemoFont() : null
    const wrapStyleId = Math.floor(Math.random() * 12)
    const wrapParams = generateWrapParams()
    wrapParams.texture = wrapStyleId
    db.prepare(`
      INSERT INTO gift_v3_packets (
        packet_id, box_id, sender_address, mode, num_slots, total_amount,
        claim_key_hex, allocation_seed_hex, sender_message, expires_at, memo_font, wrap_style_id, wrap_params
      )
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(packetIdHex, finalBoxId, userAddress, finalNumSlots, amount ?? 0, claimKeyHex, allocationSeedHex, message ?? '', expiresAt, memoFont, wrapStyleId, JSON.stringify(wrapParams))

    // Single claim URL for group gifts (server assigns slot from queue)
    const claimCode = encodeGiftGroupCode(packetIdHex, claimKeyHex)
    const claimUrl = `${APP_URL}/g/${claimCode}`

    // Choose contract function based on split mode
    const txArgs: Record<string, any> = {
      pool,
      boxId: finalBoxId,
      packetId: packetIdHex,
      numSlots: finalNumSlots,
      amount: amount ?? 0,
      slotHashes: slotHashesHex,
      ttl: ttl ?? 0,
    }
    if (!isEqual) {
      txArgs.allocationSeed = allocationSeedHex
    }

    return reply.send({
      packetId: packetIdHex,
      memoFont: memoFont ?? undefined,
      wrapStyleId,
      wrapParams,
      claimKey: claimKeyHex,
      claimUrl,
      claimLinks: [claimUrl],  // backward compat
      txParams: {
        moduleAddress: module,
        moduleName: 'gift_v3',
        functionName: isEqual ? 'send_gift_group_equal' : 'send_gift_group',
        args: txArgs,
      },
    })
  })

  // ── POST /v1/gift/confirm-send ───────────────────────────────

  app.post('/gift/confirm-send', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { packetId, txHash } = req.body as { packetId: string; txHash: string }
    if (!packetId || !txHash) {
      return reply.status(400).send({ error: 'packetId and txHash required' })
    }

    const db = getDb()
    db.prepare(`UPDATE gift_v3_packets SET tx_hash = ?, status = 'active' WHERE packet_id = ?`)
      .run(txHash, packetId)

    // Send notification to recipient if specified (direct or named group gift)
    try {
      const packet = db.prepare(
        'SELECT recipient_address, sender_address, mode, total_amount, num_slots, sender_message, box_id FROM gift_v3_packets WHERE packet_id = ?'
      ).get(packetId) as any

      if (packet?.recipient_address) {
        // Direct gift — notify recipient by address
        const senderAccount = db.prepare('SELECT nickname, short_id FROM accounts WHERE lower(address) = lower(?)').get(packet.sender_address) as any
        const meta = db.prepare('SELECT name FROM gift_box_meta WHERE box_id = ?').get(packet.box_id) as any
        const amountIusd = (Number(packet.total_amount) / 1e6).toFixed(2)
        sendNotification(packet.recipient_address, 'GIFT_RECEIVED', {
          packetId,
          boxName: meta?.name ?? `Gift #${packet.box_id}`,
          amount: amountIusd,
          senderNickname: senderAccount?.nickname ?? 'Someone',
          senderShortId: senderAccount?.short_id ?? null,
          message: packet.sender_message ?? '',
          mode: packet.mode,
          numSlots: packet.num_slots,
        })
      }
    } catch {}

    return reply.send({ success: true, packetId, txHash })
  })

  // ── POST /v1/gift/cancel-pending ────────────────────────────

  app.post('/gift/cancel-pending', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId } = req.body as { packetId: string }
    if (!packetId) return reply.status(400).send({ error: 'packetId required' })

    const db = getDb()
    db.prepare(
      `DELETE FROM gift_v3_packets WHERE packet_id = ? AND lower(sender_address) = lower(?) AND status = 'pending_tx'`
    ).run(packetId, userAddress)

    return reply.send({ success: true })
  })

  // ── POST /v1/gift/claim (direct, sponsored) ──────────────────

  app.post('/gift/claim', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId } = req.body as { packetId: string }

    if (!packetId) {
      return reply.status(400).send({ error: 'packetId required' })
    }

    const db = getDb()
    const pid = packetId.replace(/^0x/, '').toLowerCase()

    // Direct-mode gifts are single-slot (slot_index always 0), and the
    // schema enforces UNIQUE(packet_id, slot_index). That means there
    // can be at most ONE queue row per direct packet, and we must look
    // it up by (packet_id, slot_index=0) — NOT by claimer_address,
    // because a stale row from a previous attempt might have a
    // slightly different claimer_address capitalization or even a
    // different address altogether, and we'd still hit the UNIQUE
    // constraint on INSERT.
    //
    // Distinguish between:
    //   - claimed     → return as-is
    //   - failed / dead_letter / queued / processing
    //       by same user → reset + trigger worker
    //   - by DIFFERENT user
    //       → race lost (another claimer beat us), 410
    const existing = db.prepare(
      'SELECT id, status, claimer_address FROM gift_claim_queue WHERE packet_id = ? AND slot_index = 0'
    ).get(pid) as any

    if (existing) {
      const sameUser = String(existing.claimer_address ?? '').toLowerCase() === userAddress.toLowerCase()

      if (existing.status === 'claimed') {
        if (sameUser) return reply.send({ success: true, status: 'claimed', message: 'Already claimed' })
        return reply.status(410).send({ error: 'Already claimed by another user' })
      }

      if (sameUser) {
        if (existing.status === 'dead_letter' || existing.status === 'failed') {
          db.prepare(
            `UPDATE gift_claim_queue
                SET status = 'queued', retry_count = 0, last_error = NULL
              WHERE id = ?`
          ).run(existing.id)
          console.log(`[gift/claim] Reset ${pid.slice(0, 16)} from '${existing.status}' → 'queued' for retry`)
          // (worker triggered by ipay-relayer passive scan, not from api process)
          return reply.send({ success: true, status: 'queued', message: 'Reset for retry' })
        }
        // queued / processing — no-op, worker already on it
        // (worker triggered by ipay-relayer passive scan, not from api process)
        return reply.send({ success: true, status: existing.status, message: 'Already in queue' })
      }

      // Different user's row is stuck (failed/dead_letter). Take it
      // over: update claimer_address to me and requeue. Direct gifts
      // are bearer, so whoever's here first legitimately owns the
      // claim slot — we just couldn't before because the dead row was
      // blocking.
      if (existing.status === 'dead_letter' || existing.status === 'failed') {
        db.prepare(
          `UPDATE gift_claim_queue
              SET claimer_address = ?, status = 'queued', retry_count = 0, last_error = NULL
            WHERE id = ?`
        ).run(userAddress, existing.id)
        console.log(`[gift/claim] Took over stuck ${existing.status} row on ${pid.slice(0, 16)} from another user`)
        // (worker triggered by ipay-relayer passive scan, not from api process)
        return reply.send({ success: true, status: 'queued', message: 'Reset for retry' })
      }

      // Active row held by someone else (queued/processing) — can't
      // butt in, they're actively claiming.
      return reply.status(410).send({ error: 'Another claim is already in progress' })
    }

    // No existing row — fresh insert.
    try {
      db.prepare(`
        INSERT INTO gift_claim_queue (packet_id, slot_index, claimer_address, status)
        VALUES (?, 0, ?, 'queued')
      `).run(pid, userAddress)
    } catch (err: any) {
      // Defensive: if we somehow raced and hit the UNIQUE constraint
      // anyway, surface the real error message for diagnosis instead
      // of the misleading "Already claimed".
      console.warn('[gift/claim] insert race:', err?.message)
      return reply.status(409).send({ error: 'Claim race — please retry' })
    }

    // Fire-and-forget: kick the worker immediately so the user doesn't
    // wait for the next scan tick. Safe to double-fire with the periodic
    // scan because processNextClaim uses FOR UPDATE SKIP LOCKED.
    // (worker triggered by ipay-relayer passive scan, not from api process)

    return reply.send({ success: true, status: 'queued', message: 'Claim queued for processing' })
  })

  // ── POST /v1/gift/claim-slot (group, sponsored) ──────────────

  app.post('/gift/claim-slot', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId, slotIndex, claimKey } = req.body as {
      packetId: string
      slotIndex: number
      claimKey: string
    }

    if (!packetId || slotIndex === undefined || !claimKey) {
      return reply.status(400).send({ error: 'packetId, slotIndex, and claimKey required' })
    }

    const db = getDb()
    const pid = packetId.replace(/^0x/, '').toLowerCase()

    // Check if already claimed
    const existing = db.prepare(
      'SELECT id, status FROM gift_claim_queue WHERE packet_id = ? AND lower(claimer_address) = lower(?)'
    ).get(pid, userAddress) as any
    if (existing) {
      return reply.send({ success: true, status: existing.status })
    }

    // Find an available slot (try requested slot first, then scan for free ones)
    const packet = db.prepare('SELECT num_slots FROM gift_v3_packets WHERE packet_id = ?').get(pid) as any
    const takenSlots = db.prepare('SELECT slot_index FROM gift_claim_queue WHERE packet_id = ?').all(pid) as { slot_index: number }[]
    const takenSet = new Set(takenSlots.map(r => r.slot_index))
    const numSlots = packet?.num_slots ?? 0

    let assignedSlot = -1
    if (!takenSet.has(slotIndex)) {
      assignedSlot = slotIndex
    } else {
      for (let i = 0; i < numSlots; i++) {
        if (!takenSet.has(i)) { assignedSlot = i; break }
      }
    }
    if (assignedSlot === -1) {
      recordAttempt(db, pid, userAddress, 'rejected')
      return reply.status(410).send({ error: 'All shares have been claimed' })
    }

    try {
      db.prepare(`
        INSERT INTO gift_claim_queue (packet_id, slot_index, claimer_address, status)
        VALUES (?, ?, ?, 'queued')
      `).run(pid, assignedSlot, userAddress)
    } catch {
      recordAttempt(db, pid, userAddress, 'rejected')
      return reply.status(410).send({ error: 'Slot already taken' })
    }

    recordAttempt(db, pid, userAddress, 'queued')
    // (worker triggered by ipay-relayer passive scan, not from api process)
    return reply.send({ success: true, status: 'queued', slotIndex: assignedSlot })
  })

  // ── POST /v1/gift/claim-queue (single-URL group claim) ────────

  app.post('/gift/claim-queue', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId, claimKey } = req.body as {
      packetId: string
      claimKey: string
    }

    if (!packetId || !claimKey) {
      return reply.status(400).send({ error: 'packetId and claimKey required' })
    }

    const db = getDb()
    const pid = packetId.replace(/^0x/, '').toLowerCase()

    // Verify packet exists and has claim key
    const packet = db.prepare(
      'SELECT packet_id, num_slots, claim_key_hex, status FROM gift_v3_packets WHERE packet_id = ?'
    ).get(pid) as any

    if (!packet) {
      return reply.status(404).send({ error: 'Packet not found' })
    }
    if (packet.status !== 'active' && packet.status !== 'pending_tx') {
      return reply.status(400).send({ error: 'Gift is no longer active' })
    }
    if (packet.claim_key_hex !== claimKey) {
      return reply.status(403).send({ error: 'Invalid claim key' })
    }

    // Check if user already claimed this packet
    const existingClaim = db.prepare(
      'SELECT id, status FROM gift_claim_queue WHERE packet_id = ? AND claimer_address = ?'
    ).get(pid, userAddress) as any

    if (existingClaim) {
      return reply.send({
        success: true,
        status: existingClaim.status,
        message: existingClaim.status === 'claimed' ? 'Already claimed' : 'Already in queue',
      })
    }

    // Find next available slot index
    const claimedSlots = db.prepare(
      'SELECT slot_index FROM gift_claim_queue WHERE packet_id = ?'
    ).all(pid) as { slot_index: number }[]

    const takenIndexes = new Set(claimedSlots.map(r => r.slot_index))
    let nextSlot = -1
    for (let i = 0; i < packet.num_slots; i++) {
      if (!takenIndexes.has(i)) {
        nextSlot = i
        break
      }
    }

    if (nextSlot === -1) {
      recordAttempt(db, pid, userAddress, 'rejected')
      const stats = getAttemptStats(db, pid)
      return reply.status(410).send({ error: 'All shares have been claimed', stats })
    }

    // Atomically insert into queue (UNIQUE constraint prevents races)
    try {
      db.prepare(`
        INSERT INTO gift_claim_queue (packet_id, slot_index, claimer_address, status)
        VALUES (?, ?, ?, 'queued')
      `).run(pid, nextSlot, userAddress)
    } catch (err: any) {
      // UNIQUE conflict — retry with next available slot
      let found = false
      for (let i = nextSlot + 1; i < packet.num_slots; i++) {
        if (!takenIndexes.has(i)) {
          try {
            db.prepare(`
              INSERT INTO gift_claim_queue (packet_id, slot_index, claimer_address, status)
              VALUES (?, ?, ?, 'queued')
            `).run(pid, i, userAddress)
            nextSlot = i
            found = true
            break
          } catch { continue }
        }
      }
      if (!found) {
        recordAttempt(db, pid, userAddress, 'rejected')
        const stats = getAttemptStats(db, pid)
        return reply.status(410).send({ error: 'All shares have been claimed', stats })
      }
    }

    recordAttempt(db, pid, userAddress, 'queued')
    // (worker triggered by ipay-relayer passive scan, not from api process)

    return reply.send({
      success: true,
      status: 'queued',
      slotIndex: nextSlot,
      totalShares: packet.num_slots,
      queuePosition: claimedSlots.length + 1,
    })
  })

  // ── GET /v1/gift/packet/:packetId ────────────────────────────

  app.get('/gift/packet/:packetId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { packetId } = req.params as { packetId: string }
    const pid = packetId.replace(/^0x/, '').toLowerCase()
    // Try to extract user address from auth token (optional — no 401 on failure)
    let userAddress: string | undefined
    try {
      const authHeader = req.headers.authorization
      if (authHeader?.startsWith('Bearer ')) {
        const db = getDb()
        const session = db.prepare(
          'SELECT address FROM auth_sessions WHERE session_id = ? AND revoked = 0'
        ).get(authHeader.slice(7)) as any
        if (session?.address) userAddress = session.address
      }
    } catch {}

    try {
      // Chain data
      const packet = await fetchPacket(pid)
      let slots = null
      if (packet.mode === 1) {
        slots = await fetchSlotsSummary(pid)
      }

      // DB metadata
      const db = getDb()
      const meta = db.prepare(`
        SELECT p.sender_message, p.memo_font, p.tx_hash, p.num_slots, p.sender_address, p.recipient_address, p.box_id, p.total_amount,
               p.wrap_style_id,
               a.nickname AS sender_nickname, a.short_id AS sender_short_id,
               m.name AS box_name, m.description AS box_description, m.collection AS box_collection, m.image_urls AS box_image_urls
        FROM gift_v3_packets p
        LEFT JOIN accounts a ON lower(a.address) = lower(p.sender_address)
        LEFT JOIN gift_box_meta m ON m.box_id = p.box_id
        WHERE p.packet_id = ?
      `).get(pid) as any
      const claims = db.prepare(`
        SELECT c.slot_index, c.claimer_address, c.amount, c.thank_emoji, c.thank_message, c.claimed_at,
               a.nickname AS claimer_nickname, a.short_id AS claimer_short_id
        FROM gift_v3_claims c
        LEFT JOIN accounts a ON lower(a.address) = lower(c.claimer_address)
        WHERE c.packet_id = ?
      `).all(pid)

      // Queue status
      const queueStats = db.prepare(
        `SELECT status, count(*) as cnt FROM gift_claim_queue WHERE packet_id = ? GROUP BY status`
      ).all(pid) as { status: string; cnt: number }[]

      const queuedCount = queueStats.find(r => r.status === 'queued')?.cnt ?? 0
      const processingCount = queueStats.find(r => r.status === 'processing')?.cnt ?? 0
      const claimedCount = queueStats.find(r => r.status === 'claimed')?.cnt ?? 0

      // User's own claim status.
      //
      // Priority: gift_v3_claims > gift_claim_queue.
      // Rationale: gift_v3_claims is the authoritative "this landed on
      // chain" record — it's written AFTER the worker successfully
      // submits sponsor_claim_slot. If the worker updates one table
      // but not the other (bug, crash, race), the queue row can stay
      // 'queued'/'processing' forever while the chain claim already
      // succeeded. Always prefer the authoritative record so the
      // frontend doesn't sit forever on "Waiting in queue...".
      let myClaimStatus: string = 'none'
      let myAmount: number | null = null
      let myTxHash: string | null = null
      if (userAddress) {
        const myClaim = db.prepare(
          'SELECT amount, claim_tx_hash FROM gift_v3_claims WHERE packet_id = ? AND lower(claimer_address) = lower(?)'
        ).get(pid, userAddress) as any
        if (myClaim) {
          myClaimStatus = 'claimed'
          myAmount = myClaim.amount
          myTxHash = myClaim.claim_tx_hash
          // Best-effort: reconcile any stale queue row so future reads
          // skip the extra indirection. Non-fatal on failure.
          try {
            db.prepare(
              `UPDATE gift_claim_queue
                  SET status = 'claimed', tx_hash = COALESCE(tx_hash, ?), amount = COALESCE(amount, ?)
                WHERE packet_id = ? AND lower(claimer_address) = lower(?) AND status != 'claimed'`
            ).run(myClaim.claim_tx_hash ?? null, myClaim.amount ?? null, pid, userAddress)
          } catch {}
        } else {
          const myQueue = db.prepare(
            'SELECT status, amount, tx_hash FROM gift_claim_queue WHERE packet_id = ? AND lower(claimer_address) = lower(?)'
          ).get(pid, userAddress) as any
          if (myQueue) {
            myClaimStatus = myQueue.status
            myAmount = myQueue.amount
            myTxHash = myQueue.tx_hash
          }
        }
      }

      // Parse box images
      let boxImages: string[] = []
      try { boxImages = JSON.parse(meta?.box_image_urls || '[]') } catch {}

      // Record view (if authenticated, upsert unique viewer)
      if (userAddress) {
        try {
          const acct = db.prepare('SELECT nickname, short_id FROM accounts WHERE lower(address) = lower(?)').get(userAddress) as any
          db.prepare(`
            INSERT INTO gift_views (packet_id, viewer_address, viewer_nickname, viewer_short_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (packet_id, viewer_address) DO UPDATE SET
              viewer_nickname = EXCLUDED.viewer_nickname,
              viewer_short_id = EXCLUDED.viewer_short_id
          `).run(pid, userAddress.toLowerCase(), acct?.nickname ?? null, acct?.short_id ?? null)
        } catch {}
      }

      // View stats
      const viewCount = Number((db.prepare('SELECT COUNT(*) as cnt FROM gift_views WHERE packet_id = ?').get(pid) as any)?.cnt ?? 0)
      const viewers = db.prepare(`
        SELECT viewer_nickname, viewer_short_id, viewer_address, created_at
        FROM gift_views WHERE packet_id = ?
        ORDER BY created_at DESC LIMIT 50
      `).all(pid) as any[]

      // Inject DB-side recipient_address into the chain `packet` so the
      // frontend "is this me" check still works after the on-chain
      // recipient field became an opaque ECIES blob.
      const packetWithRecipient = {
        ...packet,
        recipient_address: meta?.recipient_address ?? null,
      }

      return reply.send({
        packet: packetWithRecipient,
        slots,
        message: meta?.sender_message ?? '',
        memoFont: meta?.memo_font ?? null,
        claims,
        totalShares: meta?.num_slots ?? packet.total_slots,
        claimedCount,
        queuedCount,
        processingCount,
        myClaimStatus,
        myAmount,
        myTxHash,
        wrapStyleId: meta?.wrap_style_id ?? 0,
        // Sender info
        sender: {
          address: meta?.sender_address ?? '',
          nickname: meta?.sender_nickname ?? null,
          shortId: meta?.sender_short_id ?? null,
        },
        // Box info
        box: {
          id: meta?.box_id ?? null,
          name: meta?.box_name ?? null,
          description: meta?.box_description ?? '',
          collection: meta?.box_collection ?? '',
          imageUrls: boxImages,
          amount: meta?.total_amount ?? packet.amount,
        },
        // Claim attempt stats
        attemptStats: getAttemptStats(db, pid),
        // View stats
        viewCount,
        viewers,
        // Community reactions
        reactions: db.prepare(`
          SELECT reaction, comment, reactor_nickname, reactor_short_id, created_at
          FROM gift_reactions WHERE packet_id = ?
          ORDER BY created_at DESC LIMIT 50
        `).all(pid),
      })
    } catch (err: any) {
      return reply.status(404).send({ error: 'Packet not found', detail: err.message })
    }
  })

  // ── GET /v1/gift/my-gifts ────────────────────────────────────

  // Deprecated: /gift/my-gifts removed — use /v1/activity?types=gift_sent,gift_received,gift_pending instead.

  // ── POST /v1/gift/thank ──────────────────────────────────────

  app.post('/gift/thank', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId, slotIndex, emoji, message } = req.body as {
      packetId: string
      slotIndex?: number
      emoji?: string
      message?: string
    }

    if (!packetId) {
      return reply.status(400).send({ error: 'packetId required' })
    }

    const db = getDb()
    // Find the user's claim — by slotIndex if provided, otherwise by address
    const existing = slotIndex !== undefined
      ? db.prepare('SELECT id, slot_index FROM gift_v3_claims WHERE packet_id = ? AND slot_index = ? AND lower(claimer_address) = lower(?)').get(packetId, slotIndex, userAddress) as any
      : db.prepare('SELECT id, slot_index FROM gift_v3_claims WHERE packet_id = ? AND lower(claimer_address) = lower(?)').get(packetId, userAddress) as any

    if (!existing) {
      return reply.status(404).send({ error: 'Claim not found' })
    }

    db.prepare(`
      UPDATE gift_v3_claims SET thank_emoji = ?, thank_message = ? WHERE id = ?
    `).run(emoji ?? null, message ?? null, existing.id)

    // Notify the gift sender about the new thank-you
    try {
      const packet = db.prepare('SELECT sender_address FROM gift_v3_packets WHERE packet_id = ?').get(packetId) as any
      if (packet?.sender_address) {
        const claimer = db.prepare('SELECT nickname FROM accounts WHERE lower(address) = lower(?)').get(userAddress) as any
        sendNotification(packet.sender_address, 'GIFT_REPLY', JSON.stringify({
          packetId,
          claimerNickname: claimer?.nickname ?? 'Someone',
          emoji: emoji ?? '',
          message: message ?? '',
        }))
      }
    } catch {}

    return reply.send({ success: true })
  })

  // ── GET /v1/gift/packet/:packetId/replies ───────────────────
  // Returns all thank-you replies for a sent gift (sender only)

  app.get('/gift/packet/:packetId/replies', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId } = req.params as { packetId: string }
    const db = getDb()

    // Verify sender owns this packet
    const packet = db.prepare('SELECT packet_id, box_id, num_slots, total_amount, sender_message, status, created_at FROM gift_v3_packets WHERE packet_id = ? AND lower(sender_address) = lower(?)').get(packetId, userAddress) as any
    if (!packet) return reply.status(404).send({ error: 'Gift not found' })

    const replies = db.prepare(`
      SELECT c.claimer_address, c.amount, c.thank_emoji, c.thank_message, c.claimed_at, c.slot_index,
             a.nickname AS claimer_nickname, a.short_id AS claimer_short_id, a.avatar_seed
      FROM gift_v3_claims c
      LEFT JOIN accounts a ON lower(a.address) = lower(c.claimer_address)
      WHERE c.packet_id = ? AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)
      ORDER BY c.claimed_at DESC
    `).all(packetId)

    // Mark replies as seen
    db.prepare('UPDATE gift_v3_packets SET reply_seen_at = ipay_now_text() WHERE packet_id = ?').run(packetId)

    return reply.send({ packet, replies })
  })

  // ── POST /v1/gift/mark-replies-seen ─────────────────────────

  app.post('/gift/mark-replies-seen', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId } = req.body as { packetId: string }
    if (!packetId) return reply.status(400).send({ error: 'packetId required' })

    const db = getDb()
    db.prepare('UPDATE gift_v3_packets SET reply_seen_at = ipay_now_text() WHERE packet_id = ? AND lower(sender_address) = lower(?)').run(packetId, userAddress)
    return reply.send({ success: true })
  })

  // ── POST /v1/gift/:packetId/seen ────────────────────────────
  // Unified "mark gift activity as seen" endpoint. Clears the per-gift
  // unread badge for both senders (reply_seen_at on gift_v3_packets) and
  // claimers (last_viewed_at on gift_v3_claims). Safe to call for either
  // role; only rows the caller owns are updated.
  app.post('/gift/:packetId/seen', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId } = req.params as { packetId: string }
    if (!packetId) return reply.status(400).send({ error: 'packetId required' })

    const db = getDb()
    // Sender path
    db.prepare(
      'UPDATE gift_v3_packets SET reply_seen_at = ipay_now_text() WHERE packet_id = ? AND lower(sender_address) = lower(?)'
    ).run(packetId, userAddress)
    // Claimer path — may affect multiple slot rows if the user claimed more
    // than one share in a group gift.
    db.prepare(
      'UPDATE gift_v3_claims SET last_viewed_at = ipay_now_text() WHERE packet_id = ? AND lower(claimer_address) = lower(?)'
    ).run(packetId, userAddress)
    return reply.send({ success: true })
  })

  // ── POST /v1/gift/react ─────────────────────────────────────
  // Community reaction on a shared gift page (viewer → gift)

  app.post('/gift/react', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { packetId, reaction, comment } = req.body as {
      packetId: string
      reaction?: string
      comment?: string
    }
    if (!packetId) return reply.status(400).send({ error: 'packetId required' })
    if (!reaction && !comment) return reply.status(400).send({ error: 'reaction or comment required' })

    const db = getDb()
    const acct = db.prepare('SELECT nickname, short_id FROM accounts WHERE lower(address) = lower(?)').get(userAddress) as any

    db.prepare(`
      INSERT INTO gift_reactions (packet_id, reactor_address, reactor_nickname, reactor_short_id, reaction, comment)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (packet_id, reactor_address) DO UPDATE SET
        reaction = EXCLUDED.reaction,
        comment = EXCLUDED.comment,
        reactor_nickname = EXCLUDED.reactor_nickname,
        reactor_short_id = EXCLUDED.reactor_short_id,
        created_at = ipay_now_text()
    `).run(packetId, userAddress.toLowerCase(), acct?.nickname ?? null, acct?.short_id ?? null, reaction ?? '', comment ?? null)

    return reply.send({ success: true })
  })

  // ── POST /v1/gift/comment — post a comment/reply on a gift ──────────

  app.post('/gift/comment', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const account = (req as any).account as any
    const { packetId, parentId, content, contentEncrypted, encryptionMeta, isPrivate } = req.body as {
      packetId: string; parentId?: number; content?: string; contentEncrypted?: string; encryptionMeta?: string; isPrivate?: boolean
    }
    if (!packetId) return reply.status(400).send({ error: 'Missing packetId' })
    if (!content && !contentEncrypted) return reply.status(400).send({ error: 'Missing content' })

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO gift_comments (packet_id, parent_id, author_address, author_nickname, author_short_id, content, content_encrypted, encryption_meta, is_private)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      packetId, parentId ?? null, userAddress,
      account?.nickname ?? null, account?.short_id ?? null,
      isPrivate ? '' : (content ?? ''),
      contentEncrypted ?? null, encryptionMeta ?? null,
      isPrivate ? true : false,
    )

    // Notify gift sender about new comment
    try {
      const packet = db.prepare('SELECT sender_address FROM gift_v3_packets WHERE packet_id = ?').get(packetId) as any
      if (packet?.sender_address && packet.sender_address.toLowerCase() !== userAddress.toLowerCase()) {
        sendNotification(packet.sender_address, 'GIFT_COMMENT', {
          packetId, authorNickname: account?.nickname, isPrivate: !!isPrivate,
        })
      }
    } catch {}

    return reply.send({ success: true, commentId: Number((result as any).lastInsertRowid ?? 0) })
  })

  // ── GET /v1/gift/packet/:packetId/comments — get comment tree ───────

  app.get('/gift/packet/:packetId/comments', async (req: FastifyRequest, reply: FastifyReply) => {
    const { packetId } = req.params as { packetId: string }
    // Try to get current user address for private message decryption
    let userAddress: string | undefined
    try {
      const authHeader = req.headers.authorization
      if (authHeader?.startsWith('Bearer ')) {
        const db = getDb()
        const session = db.prepare('SELECT address FROM auth_sessions WHERE session_id = ? AND revoked = 0').get(authHeader.slice(7)) as any
        if (session?.address) userAddress = session.address
      }
    } catch {}

    const db = getDb()
    const comments = db.prepare(`
      SELECT id, packet_id, parent_id, author_address, author_nickname, author_short_id,
             content, content_encrypted, encryption_meta, is_private, created_at
      FROM gift_comments WHERE packet_id = ?
      ORDER BY created_at ASC LIMIT 200
    `).all(packetId) as any[]

    // Filter private messages: only show if user is author or recipient (packet sender)
    const packet = db.prepare('SELECT sender_address FROM gift_v3_packets WHERE packet_id = ?').get(packetId) as any
    const senderAddr = packet?.sender_address?.toLowerCase()

    const filtered = comments.map(c => {
      if (c.is_private) {
        const isAuthor = userAddress && c.author_address.toLowerCase() === userAddress.toLowerCase()
        const isSender = userAddress && senderAddr === userAddress.toLowerCase()
        if (!isAuthor && !isSender) {
          return { ...c, content: '[Private Message]', content_encrypted: null, encryption_meta: null }
        }
      }
      return c
    })

    return reply.send({ comments: filtered })
  })

  // ── DELETE /v1/gift/comment/:id — delete own comment ────────────────

  app.delete('/gift/comment/:id', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (req as any).userAddress as string
    const { id } = req.params as { id: string }
    const db = getDb()
    const comment = db.prepare('SELECT author_address FROM gift_comments WHERE id = ?').get(parseInt(id)) as any
    if (!comment) return reply.status(404).send({ error: 'Not found' })
    if (comment.author_address.toLowerCase() !== userAddress.toLowerCase()) {
      return reply.status(403).send({ error: 'Not your comment' })
    }
    db.prepare('DELETE FROM gift_comments WHERE id = ?').run(parseInt(id))
    return reply.send({ success: true })
  })
}
