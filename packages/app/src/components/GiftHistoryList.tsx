/**
 * GiftHistoryList — shared gift list UI used by both Gift.tsx (history tab)
 * and History.tsx (gift tab).
 *
 * Renders Received + Sent sections. Each row is delegated to the single
 * shared `<GiftRowCard>` component so the whole app stays visually in-sync.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ReceivedGift, SentPacket } from '../lib/giftTypes'
import { GiftRowCard } from './GiftRowCard'

export interface GiftHistoryListProps {
  received: ReceivedGift[]
  sent: SentPacket[]
  receivedHasMore: boolean
  sentHasMore: boolean
  receivedLoadingMore: boolean
  sentLoadingMore: boolean
  onLoadMoreReceived: () => void
  onLoadMoreSent: () => void
  onReceivedClick: (item: ReceivedGift, e: React.MouseEvent<HTMLDivElement>) => void
  onSentClick: (pkt: SentPacket, e: React.MouseEvent<HTMLDivElement>) => void
  /** Shown when both received + sent are empty (and not loading). */
  emptyMessage?: string
  /** If true, the empty state is rendered. Parent controls the timing. */
  showEmpty?: boolean
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--muted)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  paddingLeft: 2,
}

const emptyMsg: React.CSSProperties = {
  textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13,
}

export function GiftHistoryList(props: GiftHistoryListProps) {
  const { t } = useTranslation()
  const {
    received, sent,
    receivedHasMore, sentHasMore,
    receivedLoadingMore, sentLoadingMore,
    onLoadMoreReceived, onLoadMoreSent,
    onReceivedClick, onSentClick,
    emptyMessage = t('history.noGiftHistory'),
    showEmpty = false,
  } = props

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`@keyframes giftRipple { to { transform: scale(1); opacity: 0 } }`}</style>

      {showEmpty && received.length === 0 && sent.length === 0 && (
        <div style={emptyMsg}>{emptyMessage}</div>
      )}

      {received.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={sectionLabel}>{t('history.receivedSection', { count: received.length })}</div>
          {received.map((item) => (
            <GiftRowCard
              key={`${item.packet_id}:${item.slot_index}`}
              kind="received"
              packetId={item.packet_id}
              boxId={item.box_id}
              wrapStyleId={item.wrap_style_id}
              wrapParams={item.wrap_params}
              expiresAt={item.expires_at ?? null}
              giftName={item.gift?.name}
              giftImageUrl={item.gift?.image_url}
              senderNickname={item.sender_nickname ?? null}
              senderMessage={item.sender_message}
              claimed={item.claimed}
              amount={item.amount}
              slotIndex={item.slot_index}
              thankEmoji={item.thank_emoji}
              thankMessage={item.thank_message}
              claimedAt={item.claimed_at}
              unseenActivityCount={item.unseen_activity_count}
              onClick={(e) => onReceivedClick(item, e)}
            />
          ))}
          {receivedHasMore && (
            <button onClick={onLoadMoreReceived} disabled={receivedLoadingMore}
              style={{
                padding: '10px', borderRadius: 10,
                background: 'var(--bg-elevated)', border: '1px dashed var(--border)',
                color: 'var(--muted)', cursor: receivedLoadingMore ? 'wait' : 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
              }}>
              {receivedLoadingMore ? t('history.loadingMore') : t('history.loadMoreReceived')}
            </button>
          )}
        </div>
      )}

      {sent.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={sectionLabel}>{t('history.sentSection', { count: sent.length })}</div>
          {sent.map(pkt => (
            <GiftRowCard
              key={pkt.packet_id}
              kind="sent"
              packetId={pkt.packet_id}
              boxId={pkt.box_id}
              wrapStyleId={pkt.wrap_style_id}
              wrapParams={pkt.wrap_params}
              expiresAt={pkt.expires_at ?? null}
              giftName={pkt.gift?.name}
              giftImageUrl={pkt.gift?.image_url}
              status={pkt.status}
              amount={pkt.total_amount}
              numSlots={pkt.num_slots}
              claimedCount={pkt.claims?.length ?? 0}
              claimedAt={pkt.created_at}
              unseenActivityCount={pkt.unseen_activity_count ?? pkt.unseen_reply_count ?? 0}
              onClick={(e) => onSentClick(pkt, e)}
            />
          ))}
          {sentHasMore && (
            <button onClick={onLoadMoreSent} disabled={sentLoadingMore}
              style={{
                padding: '10px', borderRadius: 10,
                background: 'var(--bg-elevated)', border: '1px dashed var(--border)',
                color: 'var(--muted)', cursor: sentLoadingMore ? 'wait' : 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
              }}>
              {sentLoadingMore ? t('history.loadingMore') : t('history.loadMoreSent')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
