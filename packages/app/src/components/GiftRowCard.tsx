/**
 * GiftRowCard — single shared gift-row renderer.
 *
 * Used by GiftHistoryList (received + sent), InBox (pending, received, sent
 * sections) and History (All + Gift tabs). One file to edit if you want to
 * change how a gift row looks anywhere in the app.
 *
 * Privacy: for UNOPENED received/pending rows this component deliberately
 * hides the gift name + amount. The viewer only sees a mystery-box cover,
 * "From <sender>", the sender memo, and an "Open →" hint. Sent rows are
 * never masked — the sender knows what they sent.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { giftCoverNode } from '../pages/Gift'

export type GiftRowKind = 'received' | 'sent' | 'pending'

export interface GiftRowCardProps {
  kind: GiftRowKind
  packetId: string
  boxId: number
  wrapStyleId?: number
  wrapParams?: any
  expiresAt?: string | null
  giftName?: string
  giftImageUrl?: string
  senderNickname?: string | null
  senderMessage?: string
  claimed?: boolean
  status?: string
  amount?: number
  slotIndex?: number
  thankEmoji?: string
  thankMessage?: string
  claimedAt?: string
  numSlots?: number
  claimedCount?: number
  unseenActivityCount?: number
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  disabled?: boolean
  variant?: 'list' | 'inbox'
}

function formatIusd(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function useTimeAgo() {
  const { t } = useTranslation()
  return (iso: string): string => {
    const d = Date.now() - new Date(iso).getTime()
    if (d < 60000) return t('time.justNow')
    if (d < 3600000) return t('time.minutesAgo', { n: Math.floor(d / 60000) })
    if (d < 86400000) return t('time.hoursAgo', { n: Math.floor(d / 3600000) })
    return t('time.daysAgo', { n: Math.floor(d / 86400000) })
  }
}

const containerBase: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  position: 'relative',
  transition: 'transform 0.15s ease, background 0.15s ease, box-shadow 0.2s ease',
}

export function GiftRowCard(props: GiftRowCardProps) {
  const { t } = useTranslation()
  const timeAgo = useTimeAgo()
  const {
    kind,
    packetId: _packetId,
    boxId,
    wrapStyleId, wrapParams, expiresAt,
    giftName, giftImageUrl,
    senderNickname, senderMessage,
    claimed, status,
    amount,
    claimedAt,
    numSlots, claimedCount,
    unseenActivityCount,
    onClick, disabled,
    variant = 'list',
  } = props
  // Resolve translated gift name using box_id as the stable key (same approach
  // as useGiftBoxText in Gift.tsx). Falls back to the DB-stored giftName, then
  // to a generic "Gift #N".
  const translatedName = t(`giftBox.${boxId}.name`, {
    defaultValue: giftName ?? t('gift.giftNumber', { id: boxId }),
  })

  const isExpired = !!(expiresAt && new Date(expiresAt).getTime() < Date.now())

  const isOpened =
    kind === 'sent'
      ? (status === 'completed' || (claimedCount ?? 0) > 0)
      : kind === 'received'
        ? !!claimed
        : false

  const pendingExpiredLock = kind === 'pending' && isExpired

  const coverSize = variant === 'inbox' ? 40 : 44
  const padding = variant === 'inbox' ? '10px 12px' : '10px 12px'
  const titleFont = variant === 'inbox' ? 12 : 13
  const subFont = variant === 'inbox' ? 10 : 11
  const metaFont = variant === 'inbox' ? 9 : 10
  const amountFont = variant === 'inbox' ? 13 : 14

  const pressHandlers = {
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || pendingExpiredLock) return
      e.currentTarget.style.transform = 'scale(0.97)'
    },
    onMouseUp: (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.transform = '' },
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.transform = '' },
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => {
      if (disabled || pendingExpiredLock) return
      e.currentTarget.style.transform = 'scale(0.97)'
    },
    onTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => { e.currentTarget.style.transform = '' },
  }

  // ── SENT: unchanged treatment, matches GiftHistoryList.sent ──────────────
  if (kind === 'sent') {
    const totalSlots = numSlots ?? 1
    const cCount = claimedCount ?? 0
    const progress = totalSlots > 0 ? cCount / totalSlots : 0
    const unseen = unseenActivityCount ?? 0

    return (
      <div
        className="gift-sent-item"
        style={{
          ...containerBase,
          padding,
          cursor: disabled ? 'default' : 'pointer',
        }}
        {...pressHandlers}
        onClick={(e) => {
          if (disabled) return
          const fhue = ((wrapStyleId ?? 0) * 30 + 10) % 360
          const el = e.currentTarget as HTMLDivElement
          el.style.background = `hsla(${fhue}, 60%, 55%, 0.18)`
          el.style.boxShadow = `0 0 0 2px hsla(${fhue}, 60%, 55%, 0.5)`
          setTimeout(() => {
            el.style.background = ''
            el.style.boxShadow = ''
          }, 300)
          const ripple = document.createElement('span')
          const rect = el.getBoundingClientRect()
          const size = Math.max(rect.width, rect.height) * 2
          ripple.style.cssText = `
            position: absolute;
            left: ${e.clientX - rect.left - size / 2}px;
            top: ${e.clientY - rect.top - size / 2}px;
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: hsla(${fhue}, 70%, 60%, 0.25);
            transform: scale(0);
            animation: giftRipple 0.5s ease-out forwards;
            pointer-events: none;
          `
          el.appendChild(ripple)
          setTimeout(() => ripple.remove(), 500)
          onClick?.(e)
        }}>
        {unseen > 0 && (
          <div style={{
            position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16,
            borderRadius: 8, background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', zIndex: 1,
            boxShadow: '0 0 0 2px var(--bg-elevated)',
          }}>{unseen}</div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {giftCoverNode({
            claimed: status === 'completed',
            expiresAt: status === 'expired' ? new Date(0).toISOString() : null,
            wrapStyleId, wrapParams,
            imageUrl: giftImageUrl,
            size: coverSize,
          })}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: titleFont, fontWeight: 600, color: 'var(--text)' }}>
              {translatedName}
            </div>
            <div style={{ fontSize: subFont, color: 'var(--muted)', marginBottom: 4 }}>
              {t('gift.claimedOfShort', { claimed: cCount, total: totalSlots })}{claimedAt ? ` · ${timeAgo(claimedAt)}` : ''}
            </div>
            <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--border)' }}>
              <div style={{
                width: `${Math.min(progress * 100, 100)}%`, height: '100%', borderRadius: 2,
                background: progress >= 1 ? '#22c55e' : '#3b82f6',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: amountFont, fontWeight: 700, color: 'var(--text)' }}>
              {formatIusd(amount ?? 0)} iUSD
            </div>
            <div style={{ fontSize: metaFont, color: status === 'active' ? '#4ade80' : 'var(--muted)' }}>
              {status === 'active' ? t('gift.progressPanel.inProgress')
                : status === 'completed' ? t('gift.progressPanel.completed')
                : status === 'expired' ? t('gift.progressPanel.expired')
                : status}
            </div>
          </div>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>›</span>
        </div>
      </div>
    )
  }

  // ── RECEIVED / PENDING ────────────────────────────────────────────────────
  const isPending = kind === 'pending'
  const showOpened = isOpened // received + claimed

  const senderLabel = senderNickname ?? t('gift.anonymous')
  const title = showOpened
    ? translatedName
    : t('gift.fromName', { name: senderLabel })

  const subtitleLine = showOpened
    ? t('gift.fromName', { name: senderLabel })
    : (senderMessage && senderMessage.length > 0
        ? `"${senderMessage}"`
        : t('gift.mysteryAwaits'))

  const metaLine = showOpened
    ? (claimedAt ? t('gift.claimedAgo', { time: timeAgo(claimedAt) }) : t('gift.claimed'))
    : null

  const borderColor = isPending && !pendingExpiredLock
    ? '1px solid #f59e0b40'
    : '1px solid var(--border)'

  return (
    <div
      className="gift-received-item"
      onClick={(e) => { if (!disabled && !pendingExpiredLock) onClick?.(e) }}
      {...pressHandlers}
      style={{
        ...containerBase,
        border: borderColor,
        padding,
        cursor: (disabled || pendingExpiredLock) ? 'default' : 'pointer',
        opacity: pendingExpiredLock ? 0.65 : 1,
      }}>
      {(unseenActivityCount ?? 0) > 0 && (
        <div style={{
          position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16,
          borderRadius: 8, background: '#ef4444', color: '#fff',
          fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px', zIndex: 1,
          boxShadow: '0 0 0 2px var(--bg-elevated)',
        }}>{unseenActivityCount}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {giftCoverNode({
          claimed: showOpened,
          expiresAt: expiresAt ?? null,
          wrapStyleId, wrapParams,
          imageUrl: showOpened ? giftImageUrl : undefined,
          size: coverSize,
        })}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: titleFont, fontWeight: 600, color: 'var(--text)' }}>
            {title}
          </div>
          <div style={{ fontSize: subFont, color: 'var(--muted)', lineHeight: 1.4 }}>
            {subtitleLine}
          </div>
          {metaLine && (
            <div style={{ fontSize: metaFont, color: 'var(--muted)' }}>{metaLine}</div>
          )}
          {showOpened && senderMessage && (
            <div style={{ fontSize: metaFont, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
              "{senderMessage}"
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {showOpened ? (
            <>
              <div style={{ fontSize: amountFont, fontWeight: 700, color: 'var(--text)' }}>
                {formatIusd(amount ?? 0)} iUSD
              </div>
              <div style={{ fontSize: metaFont, color: '#4ade80' }}>{t('gift.view')}</div>
            </>
          ) : pendingExpiredLock ? (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--muted)',
              border: '1px solid var(--border)',
            }}>{t('gift.expiredChip')}</span>
          ) : (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
              background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
              border: '1px solid #f59e0b40',
            }}>{t('gift.openCta')}</span>
          )}
        </div>
      </div>
    </div>
  )
}
