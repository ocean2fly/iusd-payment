/**
 * Shared gift list types + ActivityItem mappers.
 *
 * Extracted from Gift.tsx so both Gift.tsx (history tab) and History.tsx
 * (gift tab) can render byte-identical gift lists via GiftHistoryList
 * without duplicating type / mapping logic.
 */
import type { ActivityItem } from '../hooks/useActivity'

export interface ClaimInfo {
  slot_index: number
  // Privacy: `claimer_address` is deliberately NOT exposed by /v1/activity;
  // use `claimer_short_id` for any display/keying needs.
  claimer_address?: string
  claimer_short_id?: string
  claimer_nickname?: string
  amount: number
  claimed_at: string
  thank_emoji?: string
  thank_message?: string
}

export interface SentPacket {
  packet_id: string
  box_id: number
  mode: number         // 0=direct, 1=group
  total_amount: number
  num_slots: number
  split_mode?: 'equal' | 'random'
  fee_bps?: number
  sender_message: string
  memo_font?: string
  status: string
  created_at: string
  /** ISO string — when unclaimed slots auto-expire and get refunded. */
  expires_at?: string | null
  claim_url?: string
  claim_links?: string[]
  view_count?: number
  wrap_style_id?: number
  wrap_params?: { texture: number; ribbonHueShift: number; rotateX: number; rotateY: number; scale: number } | null
  gift?: {
    name: string
    image_url: string
    image_urls?: string[]
    collection?: string
    description?: string
  }
  claims?: ClaimInfo[]
  unseen_reply_count?: number
  reply_count?: number
  /** Aggregated unread counter: every new claim/reply since reply_seen_at. */
  unseen_activity_count?: number
}

export interface ReceivedGift {
  packet_id: string
  slot_index: number
  box_id: number
  amount: number
  claimed: boolean
  claimed_at?: string
  sender_nickname?: string
  sender_message?: string
  gift?: { name: string; image_url: string; collection: string }
  thank_emoji?: string
  thank_message?: string
  wrap_style_id?: number
  wrap_params?: any
  expires_at?: string | null
  /** Aggregated red-dot counter: new claims / thank-messages / comments
   *  that landed on this gift since the user's last visit. */
  unseen_activity_count?: number
}

// ── Activity → Legacy shape mappers ──────────────────────────────────────
// Let existing JSX consume ActivityItem without a full rewrite.
export function activityToSentPacket(item: ActivityItem): SentPacket {
  const d = item.data || {}
  return {
    packet_id: d.packetId ?? item.id,
    box_id: d.boxId ?? 0,
    mode: d.mode ?? 0,
    total_amount: d.totalAmountIusd ?? (Number(item.amountMicro ?? 0) / 1_000_000),
    num_slots: d.numSlots ?? 1,
    split_mode: d.splitMode ?? 'equal',
    fee_bps: d.feeBps,
    sender_message: d.senderMessage ?? '',
    memo_font: d.memoFont ?? undefined,
    status: item.status ?? 'active',
    created_at: d.giftCreatedAt ?? item.at,
    expires_at: d.giftExpiresAt ?? null,
    claim_url: d.claimUrl ?? undefined,
    claim_links: d.claimLinks ?? undefined,
    wrap_style_id: d.wrapStyleId ?? 0,
    wrap_params: d.wrapParams ?? null,
    gift: d.gift ? {
      name: d.gift.name,
      image_url: d.gift.imageUrl ?? '',
      image_urls: d.gift.imageUrls ?? [],
      collection: d.gift.collection ?? '',
      description: d.gift.description ?? '',
    } : undefined,
    claims: (d.claims ?? []) as ClaimInfo[],
    unseen_reply_count: d.unseenReplyCount ?? 0,
    reply_count: d.replyCount ?? 0,
    unseen_activity_count: d.unseenActivityCount ?? 0,
  }
}

export function activityToReceivedGift(item: ActivityItem): ReceivedGift {
  const d = item.data || {}
  return {
    packet_id: d.packetId ?? item.id.split(':')[0],
    slot_index: d.slotIndex ?? 0,
    box_id: d.boxId ?? 0,
    amount: Number(item.amountMicro ?? 0) / 1_000_000,
    claimed: true, // gift_received items are always claimed
    claimed_at: item.at,
    sender_nickname: item.counterparty?.nickname ?? undefined,
    sender_message: d.senderMessage ?? '',
    gift: d.gift ? {
      name: d.gift.name,
      image_url: d.gift.imageUrl ?? '',
      collection: d.gift.collection ?? '',
    } : undefined,
    thank_emoji: d.thankEmoji ?? undefined,
    thank_message: d.thankMessage ?? undefined,
    unseen_activity_count: d.unseenActivityCount ?? 0,
    wrap_style_id: d.wrapStyleId ?? 0,
    wrap_params: d.wrapParams ?? null,
    expires_at: d.expiresAt ?? null,
  }
}
