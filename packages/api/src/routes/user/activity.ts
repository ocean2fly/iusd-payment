/**
 * activity.ts — Unified paginated activity timeline.
 *
 * GET /v1/activity         — cursor-paginated mixed timeline
 * GET /v1/activity/stats   — aggregated counts / sums for the whole history
 *
 * Replaces the older scattered endpoints:
 *   /account/history/sent|received
 *   /account/inbox
 *   /account/gift/sent|received
 *   /gift/my-gifts
 *
 * Design notes:
 *   - Cursor-based pagination. Cursor = ISO timestamp of the last returned item.
 *     Each source query is `WHERE <at> < cursor ORDER BY <at> DESC LIMIT (N+1)`.
 *     After merging all sources we sort desc by `at`, take top N, derive
 *     nextCursor from the last one.
 *
 *   - Per-source queries in parallel. Gift rows are aggregated: each gift shows
 *     as ONE item, with replyCount / latestReply / unseenReplies embedded in
 *     `data`, and the ordering timestamp is max(gift.created_at,
 *     latestReplyAt) so gifts with fresh replies bubble up.
 *
 *   - gift_reply is a separate type for Inbox notifications — each reply is
 *     its own item, and it is filtered server-side to exclude replies
 *     authored by the current user.
 *
 *   - Payment rows hydrate their on-chain status via Promise.all. Slow chain
 *     nodes are acceptable because page size is small (20). The frontend
 *     should render "fetching" state if status is -1 / unknown.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db'
import { requireAuth } from '../../middleware/auth'
import { getChainPayment } from './account'
import { getPoolAddress, getModuleAddress } from '../../shared/contract-config'
import { APP_URL } from '../../shared/config'
import { encodeGiftGroupCode } from '../../lib/giftCrypto'
import { decryptPayloadForRecipient } from '../../services/security/encryption'
import { fetchAllBoxes } from '../../lib/giftChainQuery'

// ── Box fee cache ──
// Fee bps is a per-box on-chain attribute. We cache the full boxId→feeBps map
// for 60s to avoid hitting the chain on every /v1/activity call.
let _boxFeeCache: { at: number; map: Map<number, number> } | null = null
async function getBoxFeeMap(): Promise<Map<number, number>> {
  const now = Date.now()
  if (_boxFeeCache && now - _boxFeeCache.at < 60_000) return _boxFeeCache.map
  try {
    const all = await fetchAllBoxes()
    const map = new Map<number, number>()
    for (const b of all) map.set(Number(b.box_id), Number(b.fee_bps || 0))
    _boxFeeCache = { at: now, map }
    return map
  } catch {
    // On chain query failure, return the stale map if we have one, else empty.
    return _boxFeeCache?.map ?? new Map()
  }
}

// ── Activity types ─────────────────────────────────────────────

export type ActivityType =
  | 'payment_sent'
  | 'payment_received'
  | 'payment_pending'
  | 'gift_sent'
  | 'gift_received'
  | 'gift_pending'
  | 'gift_reply'
  | 'invoice_sent'
  | 'invoice_received'
  | 'invoice_paid'

const ALL_TYPES: ActivityType[] = [
  'payment_sent', 'payment_received', 'payment_pending',
  'gift_sent', 'gift_received', 'gift_pending', 'gift_reply',
  'invoice_sent', 'invoice_received', 'invoice_paid',
]

export interface ActivityItem {
  id: string
  type: ActivityType
  at: string            // ISO timestamp
  amountMicro?: string  // stringified bigint (payments, gifts)
  status?: string       // type-specific status
  counterparty?: {
    shortId?: string
    nickname?: string
  }
  data: Record<string, any>  // type-specific extras
}

const MODULE_ADDRESS = getModuleAddress()

// ── Helpers ─────────────────────────────────────────────────────

function parseTypes(raw: string | undefined): ActivityType[] {
  if (!raw) return ALL_TYPES.slice()
  const list = raw.split(',').map(s => s.trim()).filter(Boolean) as ActivityType[]
  return list.filter(t => ALL_TYPES.includes(t as ActivityType))
}

function tryJson<T>(s: any, fallback: T): T {
  try { return s ? JSON.parse(s) : fallback } catch { return fallback }
}

// ── Source fetchers — each returns ActivityItem[] sorted desc by `at` ───

/** Fetch gift_sent items with reply aggregation. */
function fetchGiftSent(db: any, userAddress: string, cursor: string, n: number, boxFeeMap: Map<number, number>): ActivityItem[] {
  const rows = db.prepare(`
    SELECT p.packet_id, p.box_id, p.mode, p.num_slots, p.total_amount,
           p.sender_message, p.status, p.created_at, p.expires_at, p.claim_key_hex,
           p.allocation_seed_hex,
           p.memo_font, p.wrap_style_id, p.wrap_params, p.reply_seen_at,
           m.name AS gift_name, m.image_urls AS gift_image_urls,
           m.description AS gift_description, m.collection AS gift_collection,
           (SELECT COUNT(*) FROM gift_v3_claims c WHERE c.packet_id = p.packet_id) AS claimed_count,
           (SELECT COUNT(*) FROM gift_v3_claims c
            WHERE c.packet_id = p.packet_id
              AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)) AS reply_count,
           (SELECT COUNT(*) FROM gift_v3_claims c
            WHERE c.packet_id = p.packet_id
              AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)
              AND (p.reply_seen_at IS NULL OR c.claimed_at > p.reply_seen_at)) AS unseen_reply_count,
           -- Aggregate "anything new since last visit": new claims OR new
           -- replies, both keyed on reply_seen_at. A single row may be BOTH
           -- a new claim AND a new reply; we count it once.
           (SELECT COUNT(*) FROM gift_v3_claims c
            WHERE c.packet_id = p.packet_id
              AND (p.reply_seen_at IS NULL OR c.claimed_at > p.reply_seen_at)) AS unseen_activity_count,
           (SELECT max(claimed_at) FROM gift_v3_claims c
            WHERE c.packet_id = p.packet_id
              AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)) AS latest_reply_at,
           (SELECT a.nickname FROM gift_v3_claims c
            LEFT JOIN accounts a ON lower(a.address) = lower(c.claimer_address)
            WHERE c.packet_id = p.packet_id
              AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)
            ORDER BY c.claimed_at DESC LIMIT 1) AS latest_reply_nick,
           (SELECT c.thank_message FROM gift_v3_claims c
            WHERE c.packet_id = p.packet_id
              AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)
            ORDER BY c.claimed_at DESC LIMIT 1) AS latest_reply_msg
    FROM gift_v3_packets p
    LEFT JOIN gift_box_meta m ON m.box_id = p.box_id
    WHERE lower(p.sender_address) = lower(?) AND p.status != 'pending_tx'
      AND GREATEST(
            p.created_at,
            COALESCE(
              (SELECT max(claimed_at) FROM gift_v3_claims c
               WHERE c.packet_id = p.packet_id
                 AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)),
              p.created_at
            )
          ) < ?
    ORDER BY GREATEST(
              p.created_at,
              COALESCE(
                (SELECT max(claimed_at) FROM gift_v3_claims c
                 WHERE c.packet_id = p.packet_id
                   AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)),
                p.created_at
              )
            ) DESC
    LIMIT ?
  `).all(userAddress, cursor, n) as any[]

  // Batch-load claim detail rows for all packets in this page (one query).
  const claimsByPacket = new Map<string, any[]>()
  if (rows.length > 0) {
    const packetIds = rows.map((r: any) => r.packet_id)
    const placeholders = packetIds.map(() => '?').join(',')
    // Privacy: we join accounts to map claimer_address → short_id + nickname,
    // but the response NEVER exposes the raw init1 address. Downstream
    // rendering keys off shortId.
    const claimRows = db.prepare(`
      SELECT c.packet_id, c.slot_index, c.amount, c.claimed_at,
             c.thank_emoji, c.thank_message,
             a.nickname AS claimer_nickname, a.short_id AS claimer_short_id
      FROM gift_v3_claims c
      LEFT JOIN accounts a ON lower(a.address) = lower(c.claimer_address)
      WHERE c.packet_id IN (${placeholders})
      ORDER BY c.claimed_at ASC
    `).all(...packetIds) as any[]
    for (const c of claimRows) {
      const list = claimsByPacket.get(c.packet_id) ?? []
      list.push({
        slot_index: Number(c.slot_index ?? 0),
        claimer_short_id: c.claimer_short_id ?? null,
        claimer_nickname: c.claimer_nickname ?? null,
        amount: Number(c.amount ?? 0) / 1_000_000,
        claimed_at: c.claimed_at,
        thank_emoji: c.thank_emoji ?? null,
        thank_message: c.thank_message ?? null,
      })
      claimsByPacket.set(c.packet_id, list)
    }
  }

  return rows.map((r: any) => {
    const images = tryJson<string[]>(r.gift_image_urls, [])
    const latestAt = r.latest_reply_at ?? r.created_at
    // Build claim URL (matches account.ts logic)
    let claimUrl = ''
    if (r.mode === 1 && r.claim_key_hex) {
      claimUrl = `${APP_URL}/g/${encodeGiftGroupCode(r.packet_id, r.claim_key_hex)}`
    } else {
      claimUrl = `${APP_URL}/gift/claim?p=${r.packet_id}`
    }
    return {
      id: r.packet_id,
      type: 'gift_sent' as const,
      at: latestAt,
      amountMicro: String(r.total_amount ?? '0'),
      status: r.status ?? 'active',
      data: {
        packetId: r.packet_id,
        boxId: r.box_id,
        mode: Number(r.mode),
        // equal: fixed per-slot share; random: seed-driven allocation.
        // Historical signal lives in allocation_seed_hex (NULL ⇒ equal).
        splitMode: r.allocation_seed_hex ? 'random' : 'equal',
        numSlots: Number(r.num_slots ?? 1),
        totalAmountIusd: Number(r.total_amount ?? 0) / 1_000_000,
        claimedCount: Number(r.claimed_count ?? 0),
        senderMessage: r.sender_message ?? '',
        memoFont: r.memo_font,
        wrapStyleId: r.wrap_style_id ?? 0,
        wrapParams: tryJson(r.wrap_params, null),
        giftCreatedAt: r.created_at,
        giftExpiresAt: r.expires_at ?? null,
        // feeBps lives on the live box config (on-chain gift_v3_boxes). We
        // resolve it via a cached boxId→feeBps map so the frontend doesn't need
        // its own /gift/configs fetch to be ready when rendering history.
        feeBps: boxFeeMap.get(Number(r.box_id)) ?? 0,
        claimUrl,
        claimLinks: [claimUrl],
        claims: claimsByPacket.get(r.packet_id) ?? [],
        gift: {
          name: r.gift_name ?? `Gift #${r.box_id}`,
          imageUrl: images[0] ?? '',
          imageUrls: images,
          description: r.gift_description ?? '',
          collection: r.gift_collection ?? 'other',
        },
        replyCount: Number(r.reply_count ?? 0),
        unseenReplyCount: Number(r.unseen_reply_count ?? 0),
        unseenActivityCount: Number(r.unseen_activity_count ?? 0),
        latestReply: r.latest_reply_msg ? {
          author: r.latest_reply_nick ?? 'Anon',
          message: r.latest_reply_msg,
          at: r.latest_reply_at,
        } : null,
      },
    }
  })
}

/** Fetch gift_received items (user has claimed). */
function fetchGiftReceived(db: any, userAddress: string, cursor: string, n: number): ActivityItem[] {
  const rows = db.prepare(`
    SELECT c.packet_id, c.slot_index, c.amount, c.claimed_at, c.thank_emoji, c.thank_message,
           c.last_viewed_at,
           p.box_id, p.sender_message, p.sender_address, p.mode, p.memo_font, p.wrap_style_id,
           p.wrap_params, p.expires_at,
           sender_a.nickname AS sender_nickname, sender_a.short_id AS sender_short_id,
           m.name AS gift_name, m.image_urls AS gift_image_urls,
           m.description AS gift_description, m.collection AS gift_collection,
           -- Aggregate red-dot: count every gift-level event (other people's
           -- claims in a group gift, other people's thank-messages, public
           -- comments) that landed after this user's own last_viewed_at.
           -- Excludes the user's own activity so the badge never flags the
           -- user about themselves.
           (SELECT COUNT(*) FROM gift_v3_claims c2
            WHERE c2.packet_id = c.packet_id
              AND lower(c2.claimer_address) != lower(?)
              AND (c.last_viewed_at IS NULL OR c2.claimed_at > c.last_viewed_at))
           AS unseen_activity_count
    FROM gift_v3_claims c
    LEFT JOIN gift_v3_packets p ON p.packet_id = c.packet_id
    LEFT JOIN accounts sender_a ON lower(sender_a.address) = lower(p.sender_address)
    LEFT JOIN gift_box_meta m ON m.box_id = p.box_id
    WHERE lower(c.claimer_address) = lower(?)
      AND c.claimed_at < ?
    ORDER BY c.claimed_at DESC
    LIMIT ?
  `).all(userAddress, userAddress, cursor, n) as any[]

  return rows.map((r: any) => {
    const images = tryJson<string[]>(r.gift_image_urls, [])
    // Optional second source of unseen activity: gift_comments authored by
    // someone other than the viewer, after last_viewed_at. Queried lazily
    // and folded into the total so the badge surfaces comments too.
    let commentUnseen = 0
    try {
      commentUnseen = Number((db.prepare(`
        SELECT COUNT(*) AS cnt FROM gift_comments g
        WHERE g.packet_id = ?
          AND lower(g.author_address) != lower(?)
          AND (? IS NULL OR g.created_at > ?)
      `).get(r.packet_id, userAddress, r.last_viewed_at, r.last_viewed_at) as any)?.cnt ?? 0)
    } catch { /* gift_comments optional */ }
    const totalUnseen = Number(r.unseen_activity_count ?? 0) + commentUnseen
    return {
      id: `${r.packet_id}:${r.slot_index}`,
      type: 'gift_received' as const,
      at: r.claimed_at,
      amountMicro: String(r.amount ?? '0'),
      status: 'claimed',
      counterparty: {
        shortId: r.sender_short_id ?? null,
        nickname: r.sender_nickname ?? null,
      },
      data: {
        packetId: r.packet_id,
        slotIndex: r.slot_index,
        boxId: r.box_id,
        mode: r.mode,
        senderMessage: r.sender_message ?? '',
        memoFont: r.memo_font,
        wrapStyleId: r.wrap_style_id ?? 0,
        wrapParams: tryJson(r.wrap_params, null),
        expiresAt: r.expires_at ?? null,
        thankEmoji: r.thank_emoji,
        thankMessage: r.thank_message,
        unseenActivityCount: totalUnseen,
        gift: {
          name: r.gift_name ?? `Gift #${r.box_id}`,
          imageUrl: images[0] ?? '',
          imageUrls: images,
          description: r.gift_description ?? '',
          collection: r.gift_collection ?? 'other',
        },
      },
    }
  })
}

/** Fetch gift_pending items: direct gifts addressed to this user, not yet claimed. */
function fetchGiftPending(db: any, userAddress: string, cursor: string, n: number): ActivityItem[] {
  const rows = db.prepare(`
    SELECT p.packet_id, p.box_id, p.total_amount, p.sender_message, p.sender_address,
           p.status, p.created_at, p.mode, p.memo_font, p.wrap_style_id, p.wrap_params, p.expires_at,
           sender_a.nickname AS sender_nickname, sender_a.short_id AS sender_short_id,
           m.name AS gift_name, m.image_urls AS gift_image_urls,
           m.description AS gift_description, m.collection AS gift_collection
    FROM gift_v3_packets p
    LEFT JOIN accounts sender_a ON lower(sender_a.address) = lower(p.sender_address)
    LEFT JOIN gift_box_meta m ON m.box_id = p.box_id
    WHERE lower(p.recipient_address) = lower(?)
      AND p.status = 'active' AND p.mode = 0
      AND NOT EXISTS (
        SELECT 1 FROM gift_v3_claims c
        WHERE c.packet_id = p.packet_id AND lower(c.claimer_address) = lower(?)
      )
      AND p.created_at < ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(userAddress, userAddress, cursor, n) as any[]

  return rows.map((r: any) => {
    const images = tryJson<string[]>(r.gift_image_urls, [])
    return {
      id: r.packet_id,
      type: 'gift_pending' as const,
      at: r.created_at,
      amountMicro: String(r.total_amount ?? '0'),
      status: 'pending',
      counterparty: {
        shortId: r.sender_short_id ?? null,
        nickname: r.sender_nickname ?? null,
      },
      data: {
        packetId: r.packet_id,
        boxId: r.box_id,
        senderMessage: r.sender_message ?? '',
        memoFont: r.memo_font,
        wrapStyleId: r.wrap_style_id ?? 0,
        wrapParams: tryJson(r.wrap_params, null),
        expiresAt: r.expires_at ?? null,
        gift: {
          name: r.gift_name ?? `Gift #${r.box_id}`,
          imageUrl: images[0] ?? '',
          imageUrls: images,
          description: r.gift_description ?? '',
          collection: r.gift_collection ?? 'other',
        },
      },
    }
  })
}

/**
 * Fetch gift_reply items: replies/comments on gifts the user is involved with
 * (as sender OR claimer). Excludes replies the user authored themselves.
 */
function fetchGiftReply(db: any, userAddress: string, cursor: string, n: number): ActivityItem[] {
  // Source 1: gift_v3_claims.thank_message where the gift involves me but the
  // claim author is not me.
  //
  // Seen-gate, applied symmetrically to both sides:
  //   - SENT parents (I'm the sender): respect p.reply_seen_at. Cleared
  //     by /gift/:id/seen sender-path, matches fetchGiftSent's unseen
  //     subquery.
  //   - RECEIVED parents (I'm a claimer of this packet): respect MY
  //     gift_v3_claims.last_viewed_at. Cleared by /gift/:id/seen
  //     claimer-path. Without this, any historical thank from another
  //     co-claimer OR any viewer comment on a gift I once claimed kept
  //     pulsing the inbox badge forever.
  const thankReplies = db.prepare(`
    SELECT c.packet_id, c.slot_index, c.thank_emoji, c.thank_message, c.claimed_at AS at,
           c.amount, c.claimer_address,
           claimer_a.nickname AS author_nick, claimer_a.short_id AS author_short_id,
           p.sender_address, p.box_id,
           m.name AS gift_name, m.image_urls AS gift_image_urls,
           CASE
             WHEN lower(p.sender_address) = lower(?) THEN 'sent'
             ELSE 'received'
           END AS parent_kind
    FROM gift_v3_claims c
    LEFT JOIN gift_v3_packets p ON p.packet_id = c.packet_id
    LEFT JOIN accounts claimer_a ON lower(claimer_a.address) = lower(c.claimer_address)
    LEFT JOIN gift_box_meta m ON m.box_id = p.box_id
    WHERE (c.thank_message IS NOT NULL OR c.thank_emoji IS NOT NULL)
      AND lower(c.claimer_address) != lower(?)
      AND (
        lower(p.sender_address) = lower(?)
        OR EXISTS (
          SELECT 1 FROM gift_v3_claims c2
          WHERE c2.packet_id = c.packet_id AND lower(c2.claimer_address) = lower(?)
        )
      )
      AND c.claimed_at < ?
      AND (
        -- Sent branch: respect p.reply_seen_at
        (lower(p.sender_address) = lower(?)
          AND (p.reply_seen_at IS NULL OR c.claimed_at > p.reply_seen_at))
        OR
        -- Received branch: respect MY claim's last_viewed_at
        (lower(p.sender_address) != lower(?)
          AND EXISTS (
            SELECT 1 FROM gift_v3_claims mine
             WHERE mine.packet_id = c.packet_id
               AND lower(mine.claimer_address) = lower(?)
               AND (mine.last_viewed_at IS NULL OR c.claimed_at > mine.last_viewed_at)
          ))
      )
    ORDER BY c.claimed_at DESC
    LIMIT ?
  `).all(
      userAddress, userAddress, userAddress, userAddress, cursor,
      userAddress, userAddress, userAddress,
      n,
    ) as any[]

  // Source 2: gift_comments where the gift involves me, author is not me.
  // (gift_comments table is optional — wrap in try/catch in case it doesn't exist.)
  let commentReplies: any[] = []
  try {
    commentReplies = db.prepare(`
      SELECT g.id AS comment_id, g.packet_id, g.content, g.created_at AS at,
             g.author_address, g.author_nickname AS author_nick, g.author_short_id,
             p.sender_address, p.box_id,
             m.name AS gift_name, m.image_urls AS gift_image_urls,
             CASE
               WHEN lower(p.sender_address) = lower(?) THEN 'sent'
               ELSE 'received'
             END AS parent_kind
      FROM gift_comments g
      LEFT JOIN gift_v3_packets p ON p.packet_id = g.packet_id
      LEFT JOIN gift_box_meta m ON m.box_id = p.box_id
      WHERE lower(g.author_address) != lower(?)
        AND (
          lower(p.sender_address) = lower(?)
          OR EXISTS (
            SELECT 1 FROM gift_v3_claims c2
            WHERE c2.packet_id = g.packet_id AND lower(c2.claimer_address) = lower(?)
          )
        )
        AND g.created_at < ?
        AND (
          -- Sent branch: respect p.reply_seen_at
          (lower(p.sender_address) = lower(?)
            AND (p.reply_seen_at IS NULL OR g.created_at > p.reply_seen_at))
          OR
          -- Received branch: respect MY claim's last_viewed_at
          (lower(p.sender_address) != lower(?)
            AND EXISTS (
              SELECT 1 FROM gift_v3_claims mine
               WHERE mine.packet_id = g.packet_id
                 AND lower(mine.claimer_address) = lower(?)
                 AND (mine.last_viewed_at IS NULL OR g.created_at > mine.last_viewed_at)
            ))
        )
      ORDER BY g.created_at DESC
      LIMIT ?
    `).all(
        userAddress, userAddress, userAddress, userAddress, cursor,
        userAddress, userAddress, userAddress,
        n,
      ) as any[]
  } catch { /* table may not exist yet */ }

  const thankItems: ActivityItem[] = thankReplies.map((r: any) => {
    const images = tryJson<string[]>(r.gift_image_urls, [])
    return {
      id: `thank:${r.packet_id}:${r.slot_index}`,
      type: 'gift_reply' as const,
      at: r.at,
      amountMicro: String(r.amount ?? '0'),
      counterparty: {
        shortId: r.author_short_id ?? null,
        nickname: r.author_nick ?? null,
      },
      data: {
        kind: 'thank',
        replyAuthor: r.author_nick ?? 'Anon',
        replyMessage: r.thank_message ?? '',
        replyEmoji: r.thank_emoji ?? null,
        parentGiftId: r.packet_id,
        parentGiftName: r.gift_name ?? `Gift #${r.box_id}`,
        parentGiftImage: images[0] ?? '',
        parentKind: r.parent_kind,  // 'sent' | 'received'
      },
    }
  })

  const commentItems: ActivityItem[] = commentReplies.map((r: any) => {
    const images = tryJson<string[]>(r.gift_image_urls, [])
    return {
      id: `comment:${r.comment_id}`,
      type: 'gift_reply' as const,
      at: r.at,
      counterparty: {
        shortId: r.author_short_id ?? null,
        nickname: r.author_nick ?? null,
      },
      data: {
        kind: 'comment',
        replyAuthor: r.author_nick ?? 'Anon',
        replyMessage: r.content ?? '',
        parentGiftId: r.packet_id,
        parentGiftName: r.gift_name ?? `Gift #${r.box_id}`,
        parentGiftImage: images[0] ?? '',
        parentKind: r.parent_kind,
      },
    }
  })

  return [...thankItems, ...commentItems].sort((a, b) => b.at.localeCompare(a.at)).slice(0, n)
}

/** Payment sent — hydrates chain status via Promise.all. */
async function fetchPaymentSent(db: any, userAddress: string, shortId: string | null, cursor: string, n: number): Promise<ActivityItem[]> {
  if (!shortId) return []
  const intents = db.prepare(`
    SELECT ip.payment_id, ip.recipient_short_id, ip.amount_micro, ip.created_at,
           ip.auto_claimed_at, ip.invoice_type, ip.merchant_snapshot,
           itx.invoice_token, itx.invoice_no, itx.note AS invoice_note,
           it.pay_link, itx.due_date, itx.payer_address AS invoice_payer_addr,
           it.payer_name, it.payer_short_id,
           itx.paid_at, itx.tx_hash,
           itx.fee_mode, itx.status AS invoice_status,
           it.merchant AS merchant_data, it.invoice_mode,
           cp.nickname AS counterparty_nickname
    FROM payment_intents ip
    LEFT JOIN invoice_transactions itx ON lower(replace(itx.payment_id,'0x','')) = lower(replace(ip.payment_id,'0x',''))
    LEFT JOIN invoice_tokens it ON it.token = itx.invoice_token
    LEFT JOIN accounts cp ON cp.short_id = ip.recipient_short_id
    WHERE ip.sender_short_id = ? AND ip.created_at < ?
    ORDER BY ip.created_at DESC
    LIMIT ?
  `).all(shortId, cursor, n) as any[]

  let poolAddress: string | null = null
  try { poolAddress = getPoolAddress() } catch { poolAddress = null }

  return Promise.all(intents.map(async (intent) => {
    const pid = (intent.payment_id ?? '').replace(/^0x/, '')
    const raw = (pid && poolAddress)
      ? await getChainPayment(pid, poolAddress, MODULE_ADDRESS).catch(() => null)
      : null
    const chainStatus = raw ? (typeof raw[0] === 'number' ? raw[0] : parseInt(raw[0])) : -1
    const amount = raw ? String(raw[1]) : String(intent.amount_micro ?? '0')
    return {
      id: pid ? ('0x' + pid) : intent.payment_id,
      type: 'payment_sent' as const,
      at: intent.created_at,
      amountMicro: amount,
      status: chainStatus === -1 ? 'fetching' : String(chainStatus),
      counterparty: {
        shortId: intent.recipient_short_id ?? null,
        nickname: intent.counterparty_nickname ?? null,
      },
      data: {
        paymentId: pid ? ('0x' + pid) : intent.payment_id,
        chainStatus,
        feeMicro: raw ? String(raw[2] ?? '0') : '0',
        claimedAt: intent.auto_claimed_at ?? null,
        merchantSnapshot: intent.merchant_snapshot ?? null,
        invoiceToken: intent.invoice_token ?? null,
        invoiceNo: intent.invoice_no ?? null,
        invoiceNote: intent.invoice_note ?? null,
        invoicePayLink: intent.pay_link ?? null,
        invoiceDueDate: intent.due_date ?? null,
        invoicePayerName: intent.payer_name ?? null,
        invoicePayerShortId: intent.payer_short_id ?? null,
        invoicePaidAt: intent.paid_at ?? null,
        invoiceTxHash: intent.tx_hash ?? null,
        invoiceFeeMode: intent.fee_mode ?? null,
        invoiceStatus: intent.invoice_status ?? null,
        invoiceType: intent.invoice_type ?? 'personal',
        invoiceMode: intent.invoice_mode ?? null,
        merchantData: intent.merchant_data ?? null,
      },
    }
  }))
}

/** Payment received — hydrates chain status. */
async function fetchPaymentReceived(
  db: any,
  userAddress: string,
  shortId: string | null,
  viewingPrivkeyEnc: string | null,
  cursor: string,
  n: number,
): Promise<ActivityItem[]> {
  if (!shortId) return []
  const intents = db.prepare(`
    SELECT ip.payment_id, ip.sender_short_id, ip.amount_micro, ip.created_at,
           ip.auto_claimed_at,
           itx.invoice_token, itx.invoice_no, itx.note AS invoice_note,
           it.pay_link, it.payer_name,
           itx.paid_at, itx.tx_hash, itx.fee_mode, itx.status AS invoice_status,
           cp.nickname AS counterparty_nickname
    FROM payment_intents ip
    LEFT JOIN invoice_transactions itx ON lower(replace(itx.payment_id,'0x','')) = lower(replace(ip.payment_id,'0x',''))
    LEFT JOIN invoice_tokens it ON it.token = itx.invoice_token
    LEFT JOIN accounts cp ON cp.short_id = ip.sender_short_id
    WHERE ip.recipient_short_id = ? AND ip.created_at < ?
    ORDER BY ip.created_at DESC
    LIMIT ?
  `).all(shortId, cursor, n) as any[]

  let poolAddress: string | null = null
  try { poolAddress = getPoolAddress() } catch { poolAddress = null }

  return Promise.all(intents.map(async (intent) => {
    const pid = (intent.payment_id ?? '').replace(/^0x/, '')
    const raw = (pid && poolAddress)
      ? await getChainPayment(pid, poolAddress, MODULE_ADDRESS).catch(() => null)
      : null
    const chainStatus = raw ? (typeof raw[0] === 'number' ? raw[0] : parseInt(raw[0])) : -1
    const amount = raw ? String(raw[1]) : String(intent.amount_micro ?? '0')
    // Distinguish pending (status=2) from received (status=3)
    const isPending = chainStatus === 2

    // For pending payments, decrypt the claim key so the frontend can claim.
    // Chain struct positions: [status, amount, fee, sender_cooked, recipient_cooked,
    //   created_at, expires_at, ciphertext, key_for_sender, key_for_recipient, claim_key_hash].
    let claimKeyHex: string | null = null
    let expiresAt = 0
    if (raw) {
      try { expiresAt = typeof raw[6] === 'number' ? raw[6] : parseInt(raw[6] ?? '0') } catch {}
    }
    if (isPending && raw && viewingPrivkeyEnc) {
      try {
        const ciphertextHex = raw[7]
        const keyForRecipientHex = raw[9]
        if (keyForRecipientHex && String(keyForRecipientHex) !== '0x0'
            && String(keyForRecipientHex).length > 4
            && ciphertextHex && String(ciphertextHex).length > 4) {
          const keyBytes = Buffer.from(String(keyForRecipientHex).replace(/^0x/i, ''), 'hex')
          const ctBytes = Buffer.from(String(ciphertextHex).replace(/^0x/i, ''), 'hex')
          const payload = decryptPayloadForRecipient(ctBytes, keyBytes, viewingPrivkeyEnc)
          claimKeyHex = payload.claimKey ?? null
        }
      } catch (e: any) {
        console.warn('[activity] payload decrypt failed:', e?.message)
      }
    }

    return {
      id: pid ? ('0x' + pid) : intent.payment_id,
      type: (isPending ? 'payment_pending' : 'payment_received') as ActivityType,
      at: intent.created_at,
      amountMicro: amount,
      status: chainStatus === -1 ? 'fetching' : String(chainStatus),
      counterparty: {
        shortId: intent.sender_short_id ?? null,
        nickname: intent.counterparty_nickname ?? null,
      },
      data: {
        paymentId: pid ? ('0x' + pid) : intent.payment_id,
        chainStatus,
        feeMicro: raw ? String(raw[2] ?? '0') : '0',
        expiresAt,
        claimKey: claimKeyHex,
        claimedAt: intent.auto_claimed_at ?? null,
        invoiceToken: intent.invoice_token ?? null,
        invoiceNo: intent.invoice_no ?? null,
        invoiceNote: intent.invoice_note ?? null,
        invoicePayLink: intent.pay_link ?? null,
        invoicePayerName: intent.payer_name ?? null,
        invoicePaidAt: intent.paid_at ?? null,
        invoiceTxHash: intent.tx_hash ?? null,
        invoiceFeeMode: intent.fee_mode ?? null,
        invoiceStatus: intent.invoice_status ?? null,
      },
    }
  }))
}

// ── Route registration ─────────────────────────────────────────

export async function activityRoutes(app: FastifyInstance) {

  app.get('/activity', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb()
    const acct = (req as any).account as any
    const userAddress = (acct?.address ?? (req as any).userAddress) as string
    if (!userAddress) return reply.status(401).send({ error: 'UNAUTHORIZED' })
    const row = db.prepare('SELECT short_id, viewing_privkey_enc FROM accounts WHERE lower(address) = lower(?)').get(userAddress) as any
    const shortId = acct?.short_id ?? row?.short_id ?? null
    const viewingPrivkeyEnc: string | null = row?.viewing_privkey_enc ?? null

    const q = req.query as { types?: string; cursor?: string; limit?: string; sort?: string }
    const types = parseTypes(q.types)
    const LIMIT_CAP = 50
    const limit = Math.min(LIMIT_CAP, Math.max(1, parseInt(q.limit ?? '20') || 20))
    const fetchN = limit + 1
    const sort: 'asc' | 'desc' = q.sort === 'asc' ? 'asc' : 'desc'
    // Default cursor:
    //   desc  → cursor = "now" far future ISO, queries fetch rows where at < cursor
    //   asc   → cursor = epoch ISO, queries still fetch rows where at < cursor
    //           but after merge we sort ascending and cursor becomes the MAX at
    //   For simplicity we still run the source SQL with `at < cursor` (desc
    //   friendly). For asc we always fetch all recent rows and just re-sort &
    //   page client-side via a separate start cursor interpretation.
    const cursor = q.cursor || new Date(Date.now() + 60_000).toISOString()

    // Resolve box fee map up front when gift_sent is requested — fetchGiftSent
    // needs it to enrich each packet with its box's current feeBps.
    const boxFeeMap = types.includes('gift_sent') ? await getBoxFeeMap() : new Map<number, number>()

    // Launch all requested source queries in parallel
    const tasks: Promise<ActivityItem[]>[] = []
    if (types.includes('gift_sent'))     tasks.push(Promise.resolve(fetchGiftSent(db, userAddress, cursor, fetchN, boxFeeMap)))
    if (types.includes('gift_received')) tasks.push(Promise.resolve(fetchGiftReceived(db, userAddress, cursor, fetchN)))
    if (types.includes('gift_pending'))  tasks.push(Promise.resolve(fetchGiftPending(db, userAddress, cursor, fetchN)))
    if (types.includes('gift_reply'))    tasks.push(Promise.resolve(fetchGiftReply(db, userAddress, cursor, fetchN)))
    if (types.includes('payment_sent'))     tasks.push(fetchPaymentSent(db, userAddress, shortId, cursor, fetchN))
    if (types.includes('payment_received') || types.includes('payment_pending')) {
      tasks.push(fetchPaymentReceived(db, userAddress, shortId, viewingPrivkeyEnc, cursor, fetchN))
    }

    const results = await Promise.all(tasks)
    // Flatten, filter by requested types (payment fetcher may return mixed types)
    let merged = ([] as ActivityItem[])
      .concat(...results)
      .filter(i => types.includes(i.type))

    if (sort === 'asc') {
      // Asc mode: sort ascending. Source queries are still desc but that's
      // fine — we only reorder. Pagination in asc is best-effort: we return
      // the page's last item's `at` as the next cursor. Subsequent asc
      // callers typically re-fetch from scratch when cursor is stale.
      merged.sort((a, b) => a.at.localeCompare(b.at))
    } else {
      merged.sort((a, b) => b.at.localeCompare(a.at))
    }

    const page = merged.slice(0, limit)
    const hasMore = merged.length > limit
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].at : null

    return reply.send({ items: page, nextCursor, hasMore, sort })
  })

  app.get('/activity/stats', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb()
    const acct = (req as any).account as any
    const userAddress = (acct?.address ?? (req as any).userAddress) as string
    if (!userAddress) return reply.status(401).send({ error: 'UNAUTHORIZED' })
    const shortId = acct?.short_id
      ?? (db.prepare('SELECT short_id FROM accounts WHERE lower(address) = lower(?)').get(userAddress) as any)?.short_id
      ?? null

    const monthStartIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

    // Gift aggregates (DB-only, fast)
    const giftsReceivedMonth = Number((db.prepare(
      `SELECT COUNT(*) AS cnt FROM gift_v3_claims WHERE lower(claimer_address) = lower(?) AND claimed_at >= ?`
    ).get(userAddress, monthStartIso) as any)?.cnt ?? 0)
    const giftsSentMonth = Number((db.prepare(
      `SELECT COUNT(*) AS cnt FROM gift_v3_packets WHERE lower(sender_address) = lower(?) AND status != 'pending_tx' AND created_at >= ?`
    ).get(userAddress, monthStartIso) as any)?.cnt ?? 0)
    const giftsReceivedTotal = Number((db.prepare(
      `SELECT COUNT(*) AS cnt FROM gift_v3_claims WHERE lower(claimer_address) = lower(?)`
    ).get(userAddress) as any)?.cnt ?? 0)
    const giftsSentTotal = Number((db.prepare(
      `SELECT COUNT(*) AS cnt FROM gift_v3_packets WHERE lower(sender_address) = lower(?) AND status != 'pending_tx'`
    ).get(userAddress) as any)?.cnt ?? 0)
    const giftValueReceivedTotalMicro = Number((db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS total FROM gift_v3_claims WHERE lower(claimer_address) = lower(?)`
    ).get(userAddress) as any)?.total ?? 0)
    const giftValueSentTotalMicro = Number((db.prepare(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM gift_v3_packets WHERE lower(sender_address) = lower(?) AND status != 'pending_tx'`
    ).get(userAddress) as any)?.total ?? 0)

    // Unread buckets
    const pendingGifts = Number((db.prepare(
      `SELECT COUNT(*) AS cnt FROM gift_v3_packets
       WHERE lower(recipient_address) = lower(?) AND status = 'active' AND mode = 0
         AND NOT EXISTS (SELECT 1 FROM gift_v3_claims c WHERE c.packet_id = gift_v3_packets.packet_id AND lower(c.claimer_address) = lower(?))`
    ).get(userAddress, userAddress) as any)?.cnt ?? 0)
    const unseenReplies = Number((db.prepare(
      `SELECT COUNT(*) AS cnt FROM gift_v3_claims c
       JOIN gift_v3_packets p ON p.packet_id = c.packet_id
       WHERE lower(p.sender_address) = lower(?)
         AND (c.thank_emoji IS NOT NULL OR c.thank_message IS NOT NULL)
         AND (p.reply_seen_at IS NULL OR c.claimed_at > p.reply_seen_at)`
    ).get(userAddress) as any)?.cnt ?? 0)
    // Pending payments: payment_intents addressed to me that haven't been
    // auto-claimed yet. Proxy for "InBox PENDING_CLAIM" without a chain RPC.
    let pendingPayments = 0
    if (shortId) {
      try {
        pendingPayments = Number((db.prepare(
          `SELECT COUNT(*) AS cnt FROM payment_intents
           WHERE recipient_short_id = ? AND auto_claimed_at IS NULL`
        ).get(shortId) as any)?.cnt ?? 0)
      } catch { /* optional table */ }
    }

    // Payment aggregates — only use DB (fast) counts, skip chain calls
    let paymentsSentMonth = 0, paymentsReceivedMonth = 0
    let paymentsSentTotal = 0, paymentsReceivedTotal = 0
    let paymentSentTotalMicro = 0, paymentReceivedTotalMicro = 0
    if (shortId) {
      try {
        paymentsSentMonth = Number((db.prepare(
          `SELECT COUNT(*) AS cnt FROM payment_intents WHERE sender_short_id = ? AND created_at >= ?`
        ).get(shortId, monthStartIso) as any)?.cnt ?? 0)
        paymentsReceivedMonth = Number((db.prepare(
          `SELECT COUNT(*) AS cnt FROM payment_intents WHERE recipient_short_id = ? AND created_at >= ?`
        ).get(shortId, monthStartIso) as any)?.cnt ?? 0)
        paymentsSentTotal = Number((db.prepare(
          `SELECT COUNT(*) AS cnt FROM payment_intents WHERE sender_short_id = ?`
        ).get(shortId) as any)?.cnt ?? 0)
        paymentsReceivedTotal = Number((db.prepare(
          `SELECT COUNT(*) AS cnt FROM payment_intents WHERE recipient_short_id = ?`
        ).get(shortId) as any)?.cnt ?? 0)
        paymentSentTotalMicro = Number((db.prepare(
          `SELECT COALESCE(SUM(CAST(amount_micro AS BIGINT)),0) AS total FROM payment_intents WHERE sender_short_id = ?`
        ).get(shortId) as any)?.total ?? 0)
        paymentReceivedTotalMicro = Number((db.prepare(
          `SELECT COALESCE(SUM(CAST(amount_micro AS BIGINT)),0) AS total FROM payment_intents WHERE recipient_short_id = ?`
        ).get(shortId) as any)?.total ?? 0)
      } catch { /* optional table */ }
    }

    return reply.send({
      thisMonth: {
        giftsReceived: giftsReceivedMonth,
        giftsSent: giftsSentMonth,
        paymentsSent: paymentsSentMonth,
        paymentsReceived: paymentsReceivedMonth,
      },
      total: {
        giftsReceived: giftsReceivedTotal,
        giftsSent: giftsSentTotal,
        paymentsSent: paymentsSentTotal,
        paymentsReceived: paymentsReceivedTotal,
        incomeIusd: (giftValueReceivedTotalMicro + paymentReceivedTotalMicro) / 1_000_000,
        expenseIusd: (giftValueSentTotalMicro + paymentSentTotalMicro) / 1_000_000,
      },
      unread: {
        pendingGifts,
        pendingPayments,
        unseenReplies,
      },
    })
  })
}
