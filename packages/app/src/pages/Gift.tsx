/**
 * Gift — /app/gift
 *
 * Three tabs:
 *   1. Gifts  — Gallery of all gift boxes, sortable by price, filterable by collection
 *   2. Open   — Inbox of received gifts (with unclaimed red dot)
 *   3. Sent   — History of sent gifts with share URLs
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useAuthContext } from '../hooks/AuthContext'
import { useUnreadSync } from '../hooks/useUnreadSync'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { API_BASE } from '../config'
import { dnaColor as getDnaColor, dnaHue as getDnaHue } from '../lib/dnaColor'
import { IUSD_FA, IUSD_DENOM, REST_URL } from '../networks'
import { buildSendGiftTx, buildSendGiftGroupTx, buildSendGiftGroupEqualTx } from '../lib/giftTx'
import { StyledQR } from '../components/StyledQR'
import { QRScanButton } from '../components/QRScanButton'
import { ReceivedGiftPreviewModal } from '../components/ReceivedGiftPreviewModal'
import { GiftHistoryList } from '../components/GiftHistoryList'
import { toPng } from 'html-to-image'

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = 'gifts' | 'history'
type SortDir = 'asc' | 'desc'

interface GiftBox {
  box_id: number
  name: string
  amount: number       // micro-units, 0 = flexible
  fee_bps: number
  urls: string[]       // on-chain image URLs
  enabled: boolean
  // off-chain metadata
  description?: string
  collection?: string
  image_urls?: string[]
  source_url?: string
  featured?: boolean
  featuredSort?: number
}

// Types + Activity→legacy mappers live in lib/giftTypes.ts so both
// Gift.tsx and History.tsx (via GiftHistoryList) can import them.
import type { SentPacket, ReceivedGift } from '../lib/giftTypes'
import { activityToSentPacket, activityToReceivedGift } from '../lib/giftTypes'
export type { SentPacket, ClaimInfo, ReceivedGift } from '../lib/giftTypes'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatIusd(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

import i18nRaw from 'i18next'
function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60000) return i18nRaw.t('time.justNow')
  if (d < 3600000) return i18nRaw.t('time.minutesAgo', { n: Math.floor(d / 60000) })
  if (d < 86400000) return i18nRaw.t('time.hoursAgo', { n: Math.floor(d / 3600000) })
  return i18nRaw.t('time.daysAgo', { n: Math.floor(d / 86400000) })
}

const COLLECTIONS = ['painting', 'music_box', 'instrument', 'sculpture', 'textile', 'ceramic', 'watch', 'brooch', 'armor', 'furniture', 'jewelry', 'other']

function collectionLabel(c: string): string {
  return c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

/**
 * Render-time collection label. Looks up `gift.collection.<id>` in i18n
 * resources and falls back to the Title-Cased raw string, so an unknown
 * backend value still renders sensibly while known ones translate.
 */
export function useCollectionLabel() {
  const { t } = useTranslation()
  return (c: string) => t(`gift.collection.${c}`, { defaultValue: collectionLabel(c) })
}

/**
 * Render-time gift-box name + description. Looks up locale-specific
 * strings keyed by the stable on-chain `box_id` in i18n resources and
 * falls back to the backend-provided value (box.name / box.description),
 * which itself falls back to "Gift #N" for unknown boxes.
 *
 * Backend contract unchanged — this is a frontend-only layer on top of
 * the existing `/v1/gift/configs` response. To translate a new box:
 * add `giftBox.<box_id>.name` / `.description` to each locale JSON.
 */
function useGiftBoxText() {
  const { t } = useTranslation()
  return {
    name: (boxId: number | undefined, fallback?: string | null) =>
      boxId == null
        ? (fallback ?? '')
        : t(`giftBox.${boxId}.name`, { defaultValue: fallback ?? `Gift #${boxId}` }),
    description: (boxId: number | undefined, fallback?: string | null) =>
      boxId == null
        ? (fallback ?? '')
        : t(`giftBox.${boxId}.description`, { defaultValue: fallback ?? '' }),
  }
}

// ── Image Viewer Modal ─────────────────────────────────────────────────────

function ImageViewer({ images, startIdx, onClose }: { images: string[]; startIdx: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIdx)
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const lastDist = useRef(0)
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // Reset zoom when switching images
  useEffect(() => { setScale(1); setTranslate({ x: 0, y: 0 }) }, [idx])

  // Native touch listeners (non-passive) so preventDefault works on mobile
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function getTouchDist(e: TouchEvent) {
      return Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY)
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault()
        lastDist.current = getTouchDist(e)
      } else if (e.touches.length === 1 && scaleRef.current > 1) {
        e.preventDefault()
        dragging.current = true
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault()
        const dist = getTouchDist(e)
        const ratio = dist / lastDist.current
        setScale(s => Math.min(5, Math.max(1, s * ratio)))
        lastDist.current = dist
      } else if (e.touches.length === 1 && dragging.current && scaleRef.current > 1) {
        e.preventDefault()
        const dx = e.touches[0].clientX - lastPos.current.x
        const dy = e.touches[0].clientY - lastPos.current.y
        setTranslate(t => ({ x: t.x + dx, y: t.y + dy }))
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
    }

    function onTouchEnd() {
      dragging.current = false
      if (scaleRef.current <= 1) setTranslate({ x: 0, y: 0 })
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // Double-tap to zoom in/out
  const lastTap = useRef(0)
  function handleDoubleTap() {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      if (scale > 1) {
        setScale(1)
        setTranslate({ x: 0, y: 0 })
      } else {
        setScale(2.5)
      }
    }
    lastTap.current = now
  }

  // Mouse wheel zoom (desktop)
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    setScale(s => Math.min(5, Math.max(1, s - e.deltaY * 0.002)))
    if (scale <= 1) setTranslate({ x: 0, y: 0 })
  }

  if (!images.length) return null
  return (
    <div style={overlayStyle} onClick={() => { if (scale <= 1) onClose() }}>
      <div
        ref={containerRef}
        style={{ position: 'relative', maxWidth: '92vw', maxHeight: '88vh', overflow: 'hidden', borderRadius: 12, touchAction: 'none' }}
        onClick={e => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <img
          src={images[idx]} alt=""
          onClick={handleDoubleTap}
          draggable={false}
          style={{
            maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain', display: 'block',
            transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
            transition: dragging.current ? 'none' : 'transform 0.15s ease-out',
            userSelect: 'none', touchAction: 'none',
          }}
        />
        {scale > 1 && (
          <button onClick={() => { setScale(1); setTranslate({ x: 0, y: 0 }) }}
            style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                     background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 20,
                     padding: '4px 14px', cursor: 'pointer', color: 'white', fontSize: 11, fontWeight: 600 }}>
            Reset
          </button>
        )}
        {images.length > 1 && scale <= 1 && (
          <>
            <button onClick={() => setIdx((idx - 1 + images.length) % images.length)}
              style={{ ...navBtnStyle, left: 8 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button onClick={() => setIdx((idx + 1) % images.length)}
              style={{ ...navBtnStyle, right: 8 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
              {idx + 1} / {images.length}
            </div>
          </>
        )}
        <button onClick={onClose} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  )
}

// ── Description Modal ──────────────────────────────────────────────────────

function DescriptionModal({ box, onClose }: { box: GiftBox; onClose: () => void }) {
  const { t } = useTranslation()
  const collLabel = useCollectionLabel()
  const giftText = useGiftBoxText()
  const translatedDesc = giftText.description(box.box_id, box.description)
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{giftText.name(box.box_id, box.name)}</h3>
          <button onClick={onClose} style={closeBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {box.collection && (
          <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {collLabel(box.collection)}
          </span>
        )}
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginTop: 10 }}>
          {translatedDesc || t('gift.noDescription')}
        </p>
        {box.source_url && (
          <a href={box.source_url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'block' }}>
            {t('gift.source')}
          </a>
        )}
      </div>
    </div>
  )
}

// ── Send Gift Modal ────────────────────────────────────────────────────────

export interface GiftSendResult {
  links: string[]
  box: GiftBox
  amount: number       // iUSD
  fee: number          // iUSD
  numSlots: number
  splitMode: 'equal' | 'random'
  recipientDisplay: string  // nickname or 'Anyone'
  isAnonymous: boolean
  message: string
  memoFont?: string    // Google Font name for artistic memo display
  wrapStyleId?: number // 0-9, wrapping paper texture
  wrapParams?: { texture: number; ribbonHueShift: number; rotateX: number; rotateY: number; scale: number }
  /**
   * When present, ShareLinksModal renders a "Progress & Activity" panel
   * under the QR card: claim list, reply list, completion/expiry status,
   * and refund info. Populated when clicking a row in Gift History → Sent.
   * Absent for fresh just-sent gifts (pure celebration view).
   */
  packet?: SentPacket
}

// ── Wrapping Paper Textures (10 styles) ──────────────────────────────────

/**
 * 12 gift box color sets — matched box + bow + open1 + open2 by color.
 * wrap_style_id (0-11) maps to a named color set.
 * Images served from /images/gift-assets/{type}_{id}_{color}.png
 */
const GIFT_BOX_STYLES = [
  'red', 'orange', 'lime', 'yellow', 'blue', 'forest',
  'teal', 'pink', 'purple', 'silver', 'gold', 'darkblue',
] as const

type GiftBoxState = 'closed' | 'open1' | 'open2'

function giftBoxUrl(styleId: number, state: GiftBoxState = 'closed'): string {
  const idx = Math.abs(styleId) % GIFT_BOX_STYLES.length
  const color = GIFT_BOX_STYLES[idx]
  const prefix = state === 'closed' ? 'box' : state
  return `/images/gift-assets/${prefix}_${idx}_${color}.png`
}

/** Renders the gift box image with a glowing edge aura to mask jagged cuts and add luxury feel. */
export function GiftBoxImage({ styleId, size = 120, state = 'closed', glow = true }: { styleId: number; size?: number; state?: GiftBoxState; glow?: boolean }) {
  // Derive a glow color from styleId
  const glowColors = [
    'rgba(255,120,120,0.4)', // red
    'rgba(255,180,80,0.4)',  // orange
    'rgba(160,255,120,0.4)', // lime
    'rgba(255,215,0,0.4)',   // yellow/gold
    'rgba(100,180,255,0.4)', // blue
    'rgba(80,200,120,0.4)',  // forest
    'rgba(80,220,210,0.4)',  // teal
    'rgba(255,150,200,0.4)', // pink
    'rgba(180,120,255,0.4)', // purple
    'rgba(200,200,220,0.35)',// silver
    'rgba(255,200,80,0.4)',  // gold
    'rgba(100,140,220,0.4)', // darkblue
  ]
  const idx = Math.abs(styleId) % GIFT_BOX_STYLES.length
  const gc = glowColors[idx] ?? 'rgba(255,215,0,0.3)'

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: size }}>
      <style>{`
        @keyframes giftGlowPulse {
          0%, 100% { opacity: 0.6; transform: scale(1.0); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes giftSparkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {glow && <>
        {/* Large soft glow behind — extends well beyond image edges */}
        <div style={{
          position: 'absolute', inset: '-15%',
          borderRadius: '50%',
          background: `radial-gradient(ellipse at center, ${gc} 0%, ${gc.replace(/[\d.]+\)$/, '0.15)')} 50%, transparent 75%)`,
          filter: 'blur(16px)',
          animation: 'giftGlowPulse 3s ease-in-out infinite',
          pointerEvents: 'none',
        }} />
        {/* Inner tighter glow for edge highlight */}
        <div style={{
          position: 'absolute', inset: '5%',
          borderRadius: '30%',
          background: `radial-gradient(ellipse at center, ${gc.replace(/[\d.]+\)$/, '0.25)')} 0%, transparent 60%)`,
          filter: 'blur(8px)',
          animation: 'giftGlowPulse 3s ease-in-out infinite 0.5s',
          pointerEvents: 'none',
        }} />
        {/* Sparkle dots around the box */}
        {[
          { top: '5%', left: '10%', delay: '0s', dur: '2.2s' },
          { top: '15%', right: '5%', delay: '0.7s', dur: '1.8s' },
          { bottom: '20%', left: '5%', delay: '1.2s', dur: '2.5s' },
          { bottom: '10%', right: '12%', delay: '0.3s', dur: '2.0s' },
          { top: '40%', left: '2%', delay: '1.8s', dur: '2.3s' },
          { top: '30%', right: '2%', delay: '0.5s', dur: '1.9s' },
        ].map((pos, i) => (
          <div key={i} style={{
            position: 'absolute', ...pos,
            width: 4, height: 4, borderRadius: '50%',
            background: '#fff',
            boxShadow: `0 0 6px 2px ${gc}`,
            animation: `giftSparkle ${pos.dur} ease-in-out infinite`,
            animationDelay: pos.delay,
            pointerEvents: 'none',
          }} />
        ))}
      </>}
      <img src={giftBoxUrl(styleId, state)} alt="Gift"
        style={{
          position: 'relative',
          width: '100%', height: 'auto',
          filter: `drop-shadow(0 0 10px ${gc}) drop-shadow(0 4px 8px rgba(0,0,0,0.3))`,
          pointerEvents: 'none',
        }} />
    </div>
  )
}

/**
 * giftCoverNode — renders the correct thumbnail for a gift list item.
 * - claimed + imageUrl → real gift image
 * - otherwise → GiftBoxImage (mystery box)
 * - expired + !claimed → greyscale/dimmed box
 */
export function giftCoverNode(args: {
  claimed: boolean
  expiresAt?: string | null
  wrapStyleId?: number
  wrapParams?: any
  imageUrl?: string
  size?: number
}) {
  const size = args.size ?? 44
  const missed = !!(args.expiresAt && new Date(args.expiresAt).getTime() < Date.now() && !args.claimed)
  if (args.claimed && args.imageUrl) {
    return (
      <img src={args.imageUrl} alt=""
        style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      filter: missed ? 'grayscale(1) opacity(0.55)' : undefined,
    }}>
      <GiftBoxImage styleId={args.wrapStyleId ?? 0} size={size} glow={false} />
    </div>
  )
}

function SendGiftModal({ box: initialBox, allBoxes, onClose, onSent, defaultRecipient }: {
  box: GiftBox
  allBoxes?: GiftBox[]
  onClose: () => void
  onSent: (result: GiftSendResult) => void
  defaultRecipient?: string
}) {
  const { t } = useTranslation()
  const collLabel = useCollectionLabel()
  const giftText = useGiftBoxText()
  const [box, setBox] = useState(initialBox)
  const boxList = allBoxes?.length ? allBoxes : [initialBox]
  const boxIdx = boxList.findIndex(b => b.box_id === box.box_id)
  const hasPrev = boxIdx > 0
  const hasNext = boxIdx < boxList.length - 1
  const { address, token } = useAuthContext()
  const { requestTxBlock } = useInterwovenKit()
  const [step, setStep] = useState(1) // 1=Gift, 2=Message, 3=Recipient
  const [recipient, setRecipient] = useState(defaultRecipient ?? '')
  const [recipientDisplay, setRecipientDisplay] = useState('')
  const [anyRecipient, setAnyRecipient] = useState(!defaultRecipient)
  const [numSlots, setNumSlots] = useState(1)
  const [customAmount, setCustomAmount] = useState('')
  const [flashAmountRequired, setFlashAmountRequired] = useState(0)
  const MEMO_PRESETS = [
    t('gift.enjoyEmoji'), t('gift.forYouEmoji'), t('gift.happyBirthday'),
    t('gift.thankYouEmoji'), t('gift.cheersEmoji'), t('gift.justBecause'),
    t('gift.deserveIt'), t('gift.haveFun'), t('gift.treatYourself'),
  ]
  const [message, setMessage] = useState(MEMO_PRESETS[Math.floor(Math.random() * MEMO_PRESETS.length)])
  const [showPresets, setShowPresets] = useState(false)
  const [splitMode, setSplitMode] = useState<'equal' | 'random'>('equal')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [iusdBalance, setIusdBalance] = useState<number | null>(null)
  const [recipientValid, setRecipientValid] = useState<boolean | null>(null) // null=unchecked, true=valid, false=invalid
  const [recipientError, setRecipientError] = useState<string>('') // specific error message
  const [recipientAddress, setRecipientAddress] = useState<string>('') // for DNA color
  const [validating, setValidating] = useState(false)
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Validate recipient exists + is active (debounced)
  useEffect(() => {
    if (anyRecipient || recipientDisplay) { setRecipientValid(recipientDisplay ? true : null); setRecipientError(''); return }
    if (!recipient || recipient.length < 4) { setRecipientValid(null); setRecipientError(''); return }
    if (validateTimer.current) clearTimeout(validateTimer.current)
    setValidating(true)
    validateTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/account/${encodeURIComponent(recipient)}`)
        if (!res.ok) { setRecipientValid(false); setRecipientError(t('gift.invalidRecipient')); setValidating(false); return }
        const d = await res.json()
        if (!d.account) { setRecipientValid(false); setRecipientError(t('gift.invalidRecipient')); }
        else if (d.status === 'frozen' || d.status === 'deleted') { setRecipientValid(false); setRecipientError(t('gift.usernameInactive')); }
        else {
          setRecipientValid(true); setRecipientError('')
          const sid = d.account.shortId || recipient
          setRecipientDisplay(`${d.account.nickname || sid}@${sid.slice(0,4)}◆${sid.slice(-4)}`)
          setRecipientAddress(d.account.address || '')
        }
      } catch { setRecipientValid(false); setRecipientError(t('gift.invalidRecipient')) }
      setValidating(false)
    }, 600)
    return () => { if (validateTimer.current) clearTimeout(validateTimer.current) }
  }, [recipient, anyRecipient, recipientDisplay]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch iUSD balance
  useEffect(() => {
    if (!address) return
    fetch(`${REST_URL}/cosmos/bank/v1beta1/balances/${address}`)
      .then(r => r.json())
      .then(d => {
        const bal: any[] = d.balances ?? []
        const coin = bal.find((b: any) => b.denom === IUSD_DENOM)
          ?? bal.find((b: any) => b.denom.startsWith('move/') && b.denom.includes(IUSD_FA.replace(/^0x/, '').slice(0, 20)))
        setIusdBalance(coin ? Number(coin.amount) / 1e6 : 0)
      })
      .catch(() => setIusdBalance(null))
  }, [address])

  const isFlexible = box.amount === 0
  const effectiveRecipient = anyRecipient ? '' : recipient
  const isGroup = numSlots > 1 || anyRecipient
  const giftAmount = isFlexible ? parseFloat(customAmount) || 0 : box.amount
  const totalAmount = giftAmount
  const fee = totalAmount * box.fee_bps / 10000
  const amountValid = !isFlexible || (giftAmount >= 0.1 && giftAmount <= 1000)
  const totalCost = totalAmount + fee
  const insufficientBalance = iusdBalance !== null && totalCost > iusdBalance

  async function handleSend() {
    if (!address || !token) return
    // Pre-create AudioContext in user gesture (click) — needed for mobile audio
    initAudioCtx()
    setSending(true); setError(null)
    try {
      if (!isGroup && !effectiveRecipient) throw new Error(t('gift.recipientRequired'))

      const endpoint = isGroup ? 'send-group' : 'send'
      const amountMicro = Math.round(giftAmount * 1_000_000)
      const body: any = {
        giftId: box.box_id, boxId: box.box_id, numSlots,
        slots: Array.from({ length: numSlots }, () => ({})),
        amount: amountMicro, message,
        ...(isGroup ? { splitMode } : {}),
        ...(effectiveRecipient ? { recipientShortId: effectiveRecipient } : {}),
      }
      const res = await fetch(`${API_BASE}/gift/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('gift.sendFailed'))

      const pendingPacketId = data.packetId
      const txArgs = data.txArgs ?? data.txParams?.args
      if (!txArgs) throw new Error(t('gift.missingTxParams'))

      let txRes: any
      try {
        const msgs = isGroup
          ? (splitMode === 'equal'
              ? buildSendGiftGroupEqualTx(address, txArgs)
              : buildSendGiftGroupTx(address, txArgs))
          : buildSendGiftTx(address, txArgs)
        txRes = await requestTxBlock({ messages: msgs })
      } catch (signErr: any) {
        fetch(`${API_BASE}/gift/cancel-pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId: pendingPacketId }),
        }).catch(() => {})
        throw signErr
      }

      if (txRes?.code !== 0 && txRes?.code !== undefined) {
        fetch(`${API_BASE}/gift/cancel-pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId: pendingPacketId }),
        }).catch(() => {})
        throw new Error((txRes as any)?.rawLog ?? t('gift.giftTxFailed'))
      }
      const txHash = (txRes as any)?.transactionHash ?? (txRes as any)?.txHash ?? 'confirmed'

      await fetch(`${API_BASE}/gift/confirm-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packetId: pendingPacketId, txHash }),
      })

      onSent({
        links: data.claimLinks ?? [],
        box, amount: giftAmount, fee, numSlots, splitMode,
        recipientDisplay: anyRecipient ? t('history.anyone') : (recipientDisplay || recipient || t('gift.anonymous')),
        isAnonymous: anyRecipient, message,
        memoFont: data.memoFont ?? undefined,
        wrapStyleId: data.wrapStyleId ?? Math.floor(Math.random() * 10),
        wrapParams: data.wrapParams ?? undefined,
      })
    } catch (e: any) {
      setError(e.message)
    } finally { setSending(false) }
  }

  const images = box.image_urls?.length ? box.image_urls : box.urls ?? []
  const [imgIdx, setImgIdx] = useState(0)
  const currentImg = images[imgIdx] || images[0]
  const [showContacts, setShowContacts] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [showDesc, setShowDesc] = useState(false)

  useEffect(() => {
    if (images.length <= 1) return
    const timer = setInterval(() => setImgIdx(i => (i + 1) % images.length), 4000)
    return () => clearInterval(timer)
  }, [images.length])

  const { address: userAddr, token: userToken, account: userAccount } = useAuthContext()
  const [contacts, setContactsList] = useState<Array<{ shortId: string; nickname: string }>>([])
  const [historyContacts, setHistoryContactsList] = useState<Array<{ shortId: string; nickname: string }>>([])
  useEffect(() => {
    if (!userAccount?.shortId || !userToken) return
    // Fetch directly from the server using the user's public shortId.
    // Bypasses contactsStore to avoid any caching/race with the module
    // global — same approach Transfer uses.
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/contacts/${encodeURIComponent(userAccount.shortId)}?limit=500`, {
          headers: { Authorization: `Bearer ${userToken}` },
        })
        if (!r.ok) return
        const data = await r.json()
        const rows = (data.contacts ?? []).map((c: any) => ({
          shortId: (c.nickname ?? c.contactAddr ?? '').toUpperCase(),
          nickname: c.avatar || c.nickname || c.contactAddr || '',
        }))
        if (!cancelled) setContactsList(rows)

        // Secondary: pull recent counterparties from activity so the
        // dropdown isn't empty for accounts that haven't visited History.
        const exclude = new Set<string>(rows.map((r: { shortId: string }) => r.shortId.toUpperCase()))
        const { fetchCounterpartiesFromActivity } = await import('../lib/contactsStore')
        const hist = await fetchCounterpartiesFromActivity(userToken, { limit: 30, excludeShortIds: exclude })
        if (!cancelled) setHistoryContactsList(hist.map(c => ({ shortId: c.shortId, nickname: c.nickname })))
      } catch {}
    })()
    return () => { cancelled = true }
  }, [userAccount?.shortId, userToken])
  const filteredContacts = recipient
    ? contacts.filter(c => c.nickname?.toLowerCase().includes(recipient.toLowerCase()) || c.shortId.toLowerCase().includes(recipient.toLowerCase()))
    : contacts
  const filteredHistoryContacts = recipient
    ? historyContacts.filter(c => c.nickname?.toLowerCase().includes(recipient.toLowerCase()) || c.shortId.toLowerCase().includes(recipient.toLowerCase()))
    : historyContacts

  const dnaHue = userAddr ? getDnaHue(userAddr) : 350
  const rc = `hsl(${dnaHue}, 65%, 45%)`
  const mouseDownTarget = useRef<EventTarget | null>(null)

  const canProceedStep3 = amountValid && message.trim().length > 0
  const canSend = amountValid && numSlots >= 1 && !insufficientBalance && (isGroup || (!!effectiveRecipient && recipientValid === true))

  return (
    <div style={{ ...overlayStyle, touchAction: 'none' }}
      onClick={e => e.stopPropagation()}
      onTouchStartCapture={e => e.stopPropagation()}
      onTouchEndCapture={e => e.stopPropagation()}
      onMouseDown={e => { mouseDownTarget.current = e.target }}
      onMouseUp={e => { if (e.target === mouseDownTarget.current && e.target === e.currentTarget) onClose() }}>
      <div style={{
        ...sheetStyle, maxWidth: 400, padding: 0, overflow: 'hidden', position: 'relative',
        border: 'none', borderRadius: 18,
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {step > 1 && (
              <button onClick={() => setStep(s => s - 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 14, padding: '2px 4px' }}>←</button>
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {step === 1 ? t('gift.stepChoose') : step === 2 ? t('gift.stepWrite') : t('gift.stepSendTo')}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}>✕</button>
        </div>

        {/* Step indicators: ① → ② → ③ */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, padding: '10px 0 2px' }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                background: s <= step ? rc : 'transparent',
                color: s <= step ? '#fff' : 'var(--muted)',
                border: s <= step ? 'none' : '1.5px solid var(--border)',
                transition: 'all 0.3s ease',
              }}>{s}</div>
              {s < 3 && (
                <svg width="12" height="10" viewBox="0 0 12 10" style={{ color: s < step ? rc : 'var(--border)', transition: 'color 0.3s' }}>
                  <path d="M1,5 L9,5 M7,2 L10,5 L7,8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: '12px 16px 16px', minHeight: 280, display: 'flex', flexDirection: 'column' }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}@keyframes giftRequiredFlash{0%,100%{transform:scale(1);color:#ef4444}25%{transform:scale(1.6);color:#ff0000;text-shadow:0 0 8px rgba(239,68,68,0.7)}50%{transform:scale(1);color:#ef4444}75%{transform:scale(1.6);color:#ff0000;text-shadow:0 0 8px rgba(239,68,68,0.7)}}`}</style>

          {/* ═══ Step 1: Choose Gift ═══ */}
          {step === 1 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeIn 0.25s ease' }}>
              {/* Large image preview with box prev/next arrows */}
              <div style={{ position: 'relative', width: '100%', height: 200, borderRadius: 14, overflow: 'hidden',
                            border: '1px solid var(--border)', background: 'var(--bg)', cursor: images.length > 1 ? 'pointer' : 'default' }}
                onClick={() => images.length > 1 && setImgIdx(i => (i + 1) % images.length)}>
                {currentImg ? (
                  <img src={currentImg} alt={box.name} key={`${box.box_id}-${imgIdx}`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', animation: 'fadeIn 0.3s ease' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 32 }}>🎁</div>
                )}
                {/* Prev box arrow */}
                {hasPrev && (
                  <button onClick={(e) => { e.stopPropagation(); setBox(boxList[boxIdx - 1]); setImgIdx(0) }}
                    style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 3,
                             width: 30, height: 30, borderRadius: '50%', border: 'none',
                             background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16,
                             cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                )}
                {/* Next box arrow */}
                {hasNext && (
                  <button onClick={(e) => { e.stopPropagation(); setBox(boxList[boxIdx + 1]); setImgIdx(0) }}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 3,
                             width: 30, height: 30, borderRadius: '50%', border: 'none',
                             background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16,
                             cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                )}
                {/* Magnifier */}
                <button onClick={(e) => { e.stopPropagation(); setViewerOpen(true) }}
                  style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 28, height: 28,
                           background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%',
                           cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
                  </svg>
                </button>
                {/* Box index indicator */}
                {boxList.length > 1 && (
                  <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', zIndex: 2 }}>
                    <span style={{ fontSize: 9, color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 8 }}>
                      {boxIdx + 1} / {boxList.length}
                    </span>
                  </div>
                )}
              </div>

              {/* Box info */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0, flex: 1 }}>{giftText.name(box.box_id, box.name)}</h3>
                  {box.collection && (
                    <span style={{ fontSize: 9, color: rc, background: `${rc}18`, padding: '2px 8px', borderRadius: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>
                      {collLabel(box.collection)}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 18 }}>
                    {box.amount > 0 ? formatIusd(box.amount) : t('gift.flexible')}
                    <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, color: 'var(--muted)' }}>iUSD</span>
                  </span>
                  <span style={{ fontSize: 11 }}>{t('gift.feePercent', { percent: (box.fee_bps / 100).toFixed(1) })}</span>
                </div>
                {(() => {
                  const desc = giftText.description(box.box_id, box.description)
                  if (!desc) return null
                  return (
                    <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0 0' }}>
                      {desc.length > 120
                        ? <>{desc.slice(0, 120)}… <button onClick={() => setShowDesc(true)}
                            style={{ border: 'none', color: rc, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0, background: 'none' }}>{t('gift.more')}</button></>
                        : desc}
                    </p>
                  )
                })()}
              </div>

              {/* Next + Browse all */}
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => setStep(2)} style={{
                  ...primaryBtn, borderRadius: 12, fontSize: 14,
                }}>
                  {t('gift.next')}
                </button>
                <button onClick={onClose} style={{
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
                  fontSize: 11, textAlign: 'center', padding: '4px',
                }}>
                  {t('gift.browseAll')}
                </button>
              </div>
            </div>
          )}

          {/* ═══ Step 2: Write Message + Amount ═══ */}
          {step === 2 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeIn 0.25s ease' }}>
              {/* Memo input */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t('gift.message')}</label>
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setShowPresets(s => !s)} style={{
                      padding: '4px 10px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                      color: 'var(--muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                    }}>{t('gift.quickPicks')} <span style={{ fontSize: 9 }}>▾</span></button>
                    {showPresets && (
                      <>
                        <div onClick={() => setShowPresets(false)}
                          style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                        <div style={{
                          position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
                          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', minWidth: 180, maxHeight: 240, overflowY: 'auto',
                          WebkitOverflowScrolling: 'touch',
                        }}>
                          {MEMO_PRESETS.map(p => (
                            <button key={p} onClick={() => { setMessage(p); setShowPresets(false) }}
                              style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'none',
                                       border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                                       textAlign: 'left', fontSize: 12,
                                       color: message === p ? rc : 'var(--text)',
                                       fontWeight: message === p ? 600 : 400 }}>{p}</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <textarea value={message} onChange={e => setMessage(e.target.value)}
                  placeholder={t('gift.writePlaceholder')}
                  rows={3}
                  style={{ ...inputSt, padding: '10px 12px', fontSize: 14, resize: 'none', lineHeight: 1.5, fontFamily: 'inherit' }} />
              </div>

              {/* Amount (only for flexible gifts) */}
              {isFlexible && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>
                    {t('gift.amountIusd')}
                    <span
                      key={flashAmountRequired}
                      style={{
                        color: '#ef4444', marginLeft: 4, fontWeight: 900, display: 'inline-block',
                        animation: flashAmountRequired ? 'giftRequiredFlash 0.6s ease-in-out' : undefined,
                      }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input type="number" step="0.01" min={0.1} max={1000} value={customAmount}
                      onChange={e => setCustomAmount(e.target.value)}
                      placeholder={t('gift.amountRangePlaceholder')}
                      style={{ ...inputSt, padding: '10px 130px 10px 12px', fontSize: 16, fontWeight: 600, width: '100%' }} />
                    <span style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 11, color: rc, fontWeight: 900,
                      background: `hsla(${dnaHue}, 65%, 45%, 0.10)`,
                      border: `1px solid hsla(${dnaHue}, 65%, 45%, 0.35)`,
                      padding: '3px 9px', borderRadius: 6,
                      letterSpacing: '0.02em',
                      pointerEvents: 'none', whiteSpace: 'nowrap',
                    }}>
                      {t('gift.tapToEdit')}
                    </span>
                  </div>
                  {!amountValid && <p style={{ color: '#f59e0b', fontSize: 11, margin: '4px 0 0' }}>{t('gift.amountInRange')}</p>}
                </div>
              )}

              {/* Nav buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button onClick={() => setStep(1)} style={{
                  ...primaryBtn, flex: 'none', width: 80, background: 'var(--bg-elevated)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 12, fontSize: 13,
                }}>{t('gift.back')}</button>
                <button
                  onClick={() => {
                    if (canProceedStep3) { setStep(3); return }
                    if (isFlexible && !amountValid) setFlashAmountRequired(n => n + 1)
                  }}
                  aria-disabled={!canProceedStep3}
                  style={{
                    ...primaryBtn, flex: 1, borderRadius: 12, fontSize: 14,
                    opacity: canProceedStep3 ? 1 : 0.35,
                    cursor: canProceedStep3 ? 'pointer' : 'pointer',
                  }}>{t('gift.next')}</button>
              </div>
            </div>
          )}

          {/* ═══ Step 3: Recipient + Send ═══ */}
          {step === 3 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeIn 0.25s ease' }}>
              {/* To field */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>{t('gift.recipient')}</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={anyRecipient}
                      onChange={e => { setAnyRecipient(e.target.checked); if (e.target.checked) { setRecipient(''); setRecipientDisplay(''); setNumSlots(n => Math.max(n, 1)) } else { setNumSlots(1) } }}
                      style={{ width: 14, height: 14, accentColor: rc }} />
                    {t('gift.anyoneGroup')}
                  </label>
                </div>
                <div style={{ position: 'relative' }}>
                  {/* Validated recipient — styled display with recipient's DNA color */}
                  {!anyRecipient && recipientValid === true && recipientDisplay ? (() => {
                    const recipientDnaHue = getDnaHue(recipientAddress || recipient)
                    const recipientDnaColor = `hsl(${recipientDnaHue}, 55%, 55%)`
                    return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <div style={{
                        ...inputSt, padding: '10px 12px', fontSize: 14, flex: '1 1 0%', minWidth: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                        cursor: 'pointer', overflow: 'hidden',
                      }} onClick={() => { /* Show full ID on click */ }}>
                        <span style={{ flex: '1 1 0%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 700 }}>{recipientDisplay.split('@')[0]}</span>
                          <span style={{ color: recipientDnaColor, fontSize: 11, marginLeft: 3, fontFamily: 'monospace' }}>
                            @{recipient.length > 10 ? `${recipient.slice(0,4)}◆${recipient.slice(-4)}` : recipient}
                          </span>
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); setRecipient(''); setRecipientDisplay(''); setRecipientValid(null); setRecipientAddress('') }}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>✕</button>
                      </div>
                      <QRScanButton onScan={shortId => {
                        setRecipient(shortId); setRecipientDisplay(''); setRecipientValid(null); setRecipientAddress(''); setAnyRecipient(false); setShowContacts(false)
                      }} />
                    </div>
                    )
                  })() : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input value={recipient}
                        disabled={anyRecipient}
                        onChange={e => { setRecipient(e.target.value); setRecipientDisplay(''); setRecipientValid(null); setShowContacts(true) }}
                        onFocus={() => { if (!anyRecipient) setShowContacts(true) }}
                        onBlur={() => setTimeout(() => setShowContacts(false), 200)}
                        placeholder={anyRecipient ? t('gift.anyoneCanClaim') : t('gift.enterContact')}
                        style={{ ...inputSt, padding: '10px 12px', fontSize: 14, opacity: anyRecipient ? 0.4 : 1, flex: 1 }} />
                      <QRScanButton disabled={anyRecipient} onScan={shortId => {
                        setRecipient(shortId); setRecipientDisplay(''); setRecipientValid(null); setAnyRecipient(false); setShowContacts(false)
                      }} />
                    </div>
                  )}
                  {/* Validation feedback */}
                  {!anyRecipient && recipient && !recipientDisplay && (
                    <div style={{ fontSize: 10, marginTop: 4, paddingLeft: 2 }}>
                      {validating ? (
                        <span style={{ color: 'var(--muted)' }}>{t('transfer.checking')}</span>
                      ) : recipientValid === false ? (
                        <span style={{ color: '#f87171' }}>{recipientError || t('gift.invalidRecipient')}</span>
                      ) : null}
                    </div>
                  )}
                  {!anyRecipient && !recipientDisplay && showContacts && (filteredContacts.length + filteredHistoryContacts.length > 0) && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                                  maxHeight: 280, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', marginTop: 4,
                                  WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain' }}
                        onTouchStartCapture={e => e.stopPropagation()}
                        onTouchMoveCapture={e => e.stopPropagation()}>

                      {/* Primary: Contacts */}
                      {filteredContacts.length > 0 && (
                        <>
                          <div style={{ padding: '6px 12px', fontSize: 9, color: 'var(--muted)',
                                        fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                                        borderBottom: '1px solid var(--border)',
                                        position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                            {t('gift.contactsHeader')}
                          </div>
                          {filteredContacts.slice(0, 5).map(c => (
                            <button key={`c-${c.shortId}`}
                              onMouseDown={() => { setRecipient(c.shortId); setRecipientDisplay(`${c.nickname || c.shortId}@${c.shortId.slice(0,4)}◆${c.shortId.slice(-4)}`); setRecipientValid(true); setAnyRecipient(false); setShowContacts(false); setNumSlots(1) }}
                              style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'none',
                                       border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                                       textAlign: 'left', fontSize: 13, color: 'var(--text)' }}>
                              <span style={{ fontWeight: 600 }}>{c.nickname || c.shortId}</span>
                              <span style={{ color: getDnaColor(c.shortId), marginLeft: 6, fontSize: 11, fontFamily: 'monospace' }}>@{c.shortId.slice(0,4)}◆{c.shortId.slice(-4)}</span>
                            </button>
                          ))}
                        </>
                      )}

                      {/* Fancy divider */}
                      {filteredContacts.length > 0 && filteredHistoryContacts.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                                      padding: '10px 12px 8px', fontSize: 9, color: 'var(--muted)',
                                      fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
                                      background: 'var(--surface)' }}>
                          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--border))' }} />
                          <span style={{ whiteSpace: 'nowrap' }}>{t('gift.fromHistory')}</span>
                          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--border), transparent)' }} />
                        </div>
                      )}
                      {filteredHistoryContacts.length > 0 && filteredContacts.length === 0 && (
                        <div style={{ padding: '6px 12px', fontSize: 9, color: 'var(--muted)',
                                      fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                                      borderBottom: '1px solid var(--border)',
                                      position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                          {t('gift.fromHistory')}
                        </div>
                      )}
                      {filteredHistoryContacts.slice(0, 5).map(c => (
                        <button key={`h-${c.shortId}`}
                          onMouseDown={() => { setRecipient(c.shortId); setRecipientDisplay(`${c.nickname || c.shortId}@${c.shortId.slice(0,4)}◆${c.shortId.slice(-4)}`); setRecipientValid(true); setAnyRecipient(false); setShowContacts(false); setNumSlots(1) }}
                          style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'none',
                                   border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                                   textAlign: 'left', fontSize: 13, color: 'var(--text)' }}>
                          <span style={{ fontWeight: 600 }}>{c.nickname || c.shortId}</span>
                          <span style={{ color: getDnaColor(c.shortId), marginLeft: 6, fontSize: 11, fontFamily: 'monospace' }}>@{c.shortId.slice(0,4)}◆{c.shortId.slice(-4)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Shares (group mode) */}
              {anyRecipient && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, display: 'block' }}>{t('gift.shares')}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => setNumSlots(n => Math.max(1, n - 1))}
                      style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)',
                               background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 18,
                               cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                    <input type="number" min={1} max={100}
                      value={numSlots === 0 ? '' : numSlots}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '') { setNumSlots(0); return }
                        const n = parseInt(v)
                        if (!isNaN(n)) setNumSlots(Math.min(100, Math.max(0, n)))
                      }}
                      onBlur={() => { if (numSlots < 1) setNumSlots(1) }}
                      style={{ ...inputSt, padding: '8px', fontSize: 16, width: 60, textAlign: 'center', fontWeight: 700 }} />
                    <button onClick={() => setNumSlots(n => Math.min(100, n + 1))}
                      style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)',
                               background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 18,
                               cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>

                    {/* Split mode */}
                    {numSlots > 1 && (
                      <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                        {(['equal', 'random'] as const).map(m => (
                          <button key={m} onClick={() => setSplitMode(m)} style={{
                            padding: '6px 12px', fontSize: 12, borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                            border: splitMode === m ? `1.5px solid ${rc}` : '1px solid var(--border)',
                            background: splitMode === m ? `${rc}15` : 'var(--bg-elevated)',
                            color: splitMode === m ? rc : 'var(--muted)',
                          }}>{m === 'equal' ? t('gift.splitEqual') : t('gift.splitRandom')}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Cost summary */}
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                  <span>{t('transfer.amountLabel')}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatIusd(totalAmount)} iUSD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                  <span>{t('gift.feeLabel', { percent: (box.fee_bps / 100).toFixed(1) })}</span>
                  <span>{formatIusd(fee)} iUSD</span>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>{t('gift.total')}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>{formatIusd(totalCost)} iUSD</span>
                </div>
                {iusdBalance !== null && (
                  <div style={{ fontSize: 10, color: insufficientBalance ? '#f87171' : 'var(--muted)', textAlign: 'right' }}>
                    {t('gift.balanceLine', { amount: formatIusd(iusdBalance) })}
                  </div>
                )}
              </div>

              {error && <p style={{ color: '#f87171', fontSize: 12, margin: 0, textAlign: 'center' }}>{error}</p>}

              {/* Nav + Send buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button onClick={() => setStep(2)} style={{
                  ...primaryBtn, flex: 'none', width: 80, background: 'var(--bg-elevated)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 12, fontSize: 13,
                }}>{t('gift.back')}</button>
                <button onClick={handleSend} disabled={sending || !canSend} style={{
                  ...primaryBtn, flex: 1, borderRadius: 12, fontSize: 14,
                  opacity: (sending || !canSend) ? 0.35 : 1,
                  cursor: (sending || !canSend) ? 'not-allowed' : 'pointer',
                }}>
                  {sending ? t('gift.wrapping') : insufficientBalance ? t('gift.insufficientBalance') : t('gift.wrapGift')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {viewerOpen && <ImageViewer images={images} startIdx={imgIdx} onClose={() => setViewerOpen(false)} />}
      {showDesc && <DescriptionModal box={box} onClose={() => setShowDesc(false)} />}
    </div>
  )
}

// Module-level AudioContext — created during user click gesture, reused by animations
let _sharedAudioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  if (_sharedAudioCtx && _sharedAudioCtx.state !== 'closed') return _sharedAudioCtx
  return null
}
function initAudioCtx() {
  try { if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') _sharedAudioCtx = new AudioContext() } catch {}
}

// ── Wrap Animation ────────────────────────────────────────────────────────

function WrapAnimation({ result, onDone }: { result: GiftSendResult; onDone: () => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'appear' | 'glow' | 'done'>('appear')

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('glow'), 1200),
      setTimeout(() => setPhase('done'), 2200),
      setTimeout(() => onDone(), 2800),
    ]
    // Celebration chime — uses shared AudioContext (created during user click)
    try {
      const ctx = getAudioCtx()
      if (ctx) {
        ctx.resume().then(() => {
          const notes = [523.25, 659.25, 783.99, 1046.50]
          notes.forEach((freq, i) => {
            const o = ctx.createOscillator()
            const g = ctx.createGain()
            o.type = 'sine'; o.frequency.value = freq
            g.gain.setValueAtTime(0, ctx.currentTime + 1.2 + i * 0.1)
            g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 1.2 + i * 0.1 + 0.04)
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2 + i * 0.1 + 0.5)
            o.connect(g).connect(ctx.destination)
            o.start(ctx.currentTime + 1.2 + i * 0.1)
            o.stop(ctx.currentTime + 1.2 + i * 0.1 + 0.5)
          })
        })
      }
    } catch {}
    return () => timers.forEach(clearTimeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ ...overlayStyle, background: 'rgba(0,0,0,0.85)' }}>
      <style>{`
        @keyframes giftAppear {
          0% { transform: scale(0.3) rotate(-8deg); opacity: 0; }
          60% { transform: scale(1.08) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes giftGlow {
          0% { filter: drop-shadow(0 0 0 rgba(255,215,0,0)); }
          50% { filter: drop-shadow(0 0 30px rgba(255,215,0,0.5)); }
          100% { filter: drop-shadow(0 0 15px rgba(255,215,0,0.2)); }
        }
        @keyframes giftExit {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.85); opacity: 0; }
        }
      `}</style>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        animation: phase === 'appear' ? 'giftAppear 0.8s cubic-bezier(0.34,1.56,0.64,1) forwards'
          : phase === 'glow' ? 'giftGlow 0.8s ease-out forwards'
          : 'giftExit 0.5s ease-in forwards',
      }}>
        <GiftBoxImage styleId={result.wrapStyleId ?? 0} size={160} />
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600, letterSpacing: '0.05em' }}>
          {phase === 'appear' ? t('gift.yourGiftReady') : phase === 'glow' ? '✨' : ''}
        </div>
      </div>
    </div>
  )
}

// ── Share Links Modal ──────────────────────────────────────────────────────

export function ShareLinksModal({ result, onClose }: { result: GiftSendResult; onClose: () => void }) {
  const { t } = useTranslation()
  const { account, address: senderAddr } = useAuthContext()
  const senderNick = account?.nickname ?? t('gift.someone')
  // DNA hue from sender address
  const dnaHue = useMemo(() => {
    if (!senderAddr) return 200
    let h = 0x811c9dc5
    const s = senderAddr.toLowerCase()
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    return (h >>> 0) % 360
  }, [senderAddr])
  const [entered, setEntered] = useState(false)
  // Default to details view; user can tap "View QR →" to switch.
  // Old default was QR — changed because details is more informative
  // when re-opening from history.
  const [qrMode, setQrMode] = useState(false)
  const qrCardRef = useRef<HTMLDivElement>(null)
  const link = result.links[0] ?? ''

  // iOS-friendly body scroll lock. Without this, touchmove on the backdrop
  // scrolls the underlying page on iOS Safari. Also needed when the modal
  // sheet itself has scrollable content — iOS doesn't reliably stop
  // propagation from an inner overflow:auto container to the body.
  useEffect(() => {
    const scrollY = window.scrollY
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction,
    }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
    return () => {
      document.body.style.position = prev.position
      document.body.style.top = prev.top
      document.body.style.width = prev.width
      document.body.style.overflow = prev.overflow
      document.body.style.touchAction = prev.touchAction
      window.scrollTo(0, scrollY)
    }
  }, [])
  const images = result.box.image_urls?.length ? result.box.image_urls : result.box.urls ?? []
  const thumb = images[0]

  // Load Google Fonts for memo + pixel nickname
  useEffect(() => {
    const fonts = ['Press Start 2P']
    if (result.memoFont) fonts.push(result.memoFont)
    fonts.forEach(f => {
      const id = `gfont-${f.replace(/\s/g, '-')}`
      if (document.getElementById(id)) return
      const el = document.createElement('link')
      el.id = id
      el.rel = 'stylesheet'
      el.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}&display=swap`
      document.head.appendChild(el)
    })
  }, [result.memoFont])

  // Trigger entrance animation + celebration sound after mount
  useEffect(() => {
    requestAnimationFrame(() => setEntered(true))
    // Play celebration chime — uses shared AudioContext
    try {
      const ctx = getAudioCtx()
      if (ctx) {
        ctx.resume().then(() => {
          const notes = [523.25, 659.25, 783.99, 1046.50] // C5 E5 G5 C6
          notes.forEach((freq, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
            gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.05)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.6)
            osc.connect(gain).connect(ctx.destination)
            osc.start(ctx.currentTime + i * 0.12)
            osc.stop(ctx.currentTime + i * 0.12 + 0.6)
          })
          // Sparkle shimmer
          setTimeout(() => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'triangle'
            osc.frequency.setValueAtTime(2000, ctx.currentTime)
            osc.frequency.exponentialRampToValueAtTime(4000, ctx.currentTime + 0.15)
            gain.gain.setValueAtTime(0.06, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
            osc.connect(gain).connect(ctx.destination)
            osc.start(); osc.stop(ctx.currentTime + 0.3)
          }, 500)
        })
      }
    } catch {}
  }, [])

  const [sharing, setSharing] = useState(false)
  const [qrCopied, setQrCopied] = useState(false)
  const [qrPreview, setQrPreview] = useState<string | null>(null)
  const sharingRef = useRef(false)

  async function handleShare() {
    if (sharingRef.current) return
    sharingRef.current = true
    if (qrMode && qrCardRef.current) {
      setSharing(true)
      try {
        // Capture the QR card as an image with safe margin for social media cropping
        const captureIsDark = document.documentElement.classList.contains('dark')
          || (!document.documentElement.classList.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches)
        const captureBg = captureIsDark ? '#0d0d1a' : '#f5f3ef'
        const opts = { pixelRatio: 2, backgroundColor: captureBg }
        await toPng(qrCardRef.current, opts).catch(() => {}) // warm-up pass
        const cardDataUrl = await toPng(qrCardRef.current, opts)
        // Add safe margin: render card centered on a larger canvas (prevents X/Twitter crop)
        const cardImg = new Image()
        await new Promise<void>((resolve) => { cardImg.onload = () => resolve(); cardImg.src = cardDataUrl })
        const margin = 60
        const canvas = document.createElement('canvas')
        canvas.width = cardImg.width + margin * 2
        canvas.height = cardImg.height + margin * 2
        const cx = canvas.getContext('2d')!
        cx.fillStyle = captureBg
        cx.fillRect(0, 0, canvas.width, canvas.height)
        cx.drawImage(cardImg, margin, margin)
        const dataUrl = canvas.toDataURL('image/png')
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const file = new File([blob], 'gift-qr.png', { type: 'image/png' })
        const isAndroid = /Android/i.test(navigator.userAgent)
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
        // iOS: share sheet has "Save to Photos" — works great
        if (isIOS && navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] }).catch(() => {})
        } else {
          // Android & desktop: direct download is most reliable
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `gift-${Date.now()}.png`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          // Also copy to clipboard on desktop
          if (!isAndroid) {
            try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) } catch {}
          }
          setQrCopied(true); setTimeout(() => setQrCopied(false), 2500)
        }
      } catch {} finally {
        setSharing(false); sharingRef.current = false
      }
    } else {
      sharingRef.current = false
      if (navigator.share) {
        navigator.share({ title: t('gift.shareTitle', { name: result.box.name }), url: link }).catch(() => {})
      } else {
        navigator.clipboard.writeText(link)
      }
    }
  }

  // Generate confetti particles once
  const confetti = useMemo(() => {
    const colors = ['#FFD700', '#FFA500', '#FF6347', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']
    const shapes = ['●', '■', '◆', '★', '▲']
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      color: colors[i % colors.length],
      shape: shapes[i % shapes.length],
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 1.5 + Math.random() * 1.5,
      size: 6 + Math.random() * 8,
      drift: -30 + Math.random() * 60,
    }))
  }, [])

  return (
    <div style={{
      ...overlayStyle,
      opacity: entered ? 1 : 0,
      transition: 'opacity 0.3s ease-out',
      touchAction: 'none',
    }} onClick={onClose}>
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(-20px) rotate(0deg) scale(0); opacity: 1; }
          20% { transform: translateY(30px) rotate(120deg) scale(1); opacity: 1; }
          100% { transform: translateY(calc(50vh + 40px)) rotate(720deg) scale(0.3); opacity: 0; }
        }
        @keyframes modalEnter {
          0% { transform: scale(0.6) translateY(40px); opacity: 0; }
          50% { transform: scale(1.02) translateY(-5px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes checkPop {
          0% { transform: scale(0) rotate(-180deg); opacity: 0; }
          60% { transform: scale(1.3) rotate(10deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes shimmerGold {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes glowRing {
          0% { box-shadow: 0 0 0 0 rgba(255,215,0,0.4); }
          50% { box-shadow: 0 0 30px 8px rgba(255,215,0,0.15); }
          100% { box-shadow: 0 0 0 0 rgba(255,215,0,0); }
        }
      `}</style>

      {/* Confetti burst */}
      {entered && confetti.map(c => (
        <div key={c.id} style={{
          position: 'fixed', top: '40%', left: `${c.left}%`,
          fontSize: c.size, color: c.color, pointerEvents: 'none', zIndex: 210,
          animation: `confettiFall ${c.duration}s ease-out ${c.delay}s both`,
          transform: `translateX(${c.drift}px)`,
        }}>
          {c.shape}
        </div>
      ))}

      <div style={{
        ...sheetStyle, maxWidth: 480, padding: 0,
        // Override sheetStyle defaults so this modal is its OWN scroll
        // container (rather than the overflow:auto on the body of the
        // outer sheet propagating). maxHeight + overflowY on the sheet
        // wrapper, touchAction:auto to let the content receive touches.
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        touchAction: 'auto',
        WebkitOverflowScrolling: 'touch',
        animation: entered ? 'modalEnter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both, glowRing 2s ease-out 0.5s both' : 'none',
        border: '1px solid rgba(255,215,0,0.3)',
      }} onClick={e => e.stopPropagation()}>

        {/* Gold shimmer top accent */}
        <div style={{
          height: 3,
          background: 'linear-gradient(90deg, transparent, #FFD700, #FFA500, #FFD700, transparent)',
          backgroundSize: '200% 100%',
          animation: 'shimmerGold 2s linear infinite',
        }} />

        {/* Header */}
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, #FFD700, #FFA500)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'checkPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both',
              boxShadow: '0 2px 12px rgba(255,215,0,0.4)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>{t('gift.ready')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('gift.shareAccessHint')}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              // Larger hit area — 44x44 is Apple HIG tap target minimum.
              width: 44, height: 44,
              marginRight: -12,
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 22,
              flexShrink: 0,
            }}
          >✕</button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {!qrMode ? (
            /* ── Default view: image + details ── */
            <>
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ width: 120, height: 120, flexShrink: 0, borderRadius: 10, overflow: 'hidden',
                              border: '1px solid var(--border)', background: 'var(--bg)' }}>
                  {thumb ? (
                    <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🎁</div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{result.box.name}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <tbody>
                      <tr><td style={tdLabel}>{t('gift.toLabel')}</td><td style={tdValue}>
                        {result.recipientDisplay.includes('@') ? (
                          <div>
                            <div style={{ fontWeight: 700 }}>{result.recipientDisplay.split('@')[0]}</div>
                            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 1 }}>@{result.recipientDisplay.split('@').slice(1).join('@')}</div>
                          </div>
                        ) : result.recipientDisplay}
                      </td></tr>
                      <tr><td style={tdLabel}>{t('transfer.amountLabel')}</td><td style={tdValue}>{formatIusd(result.amount)} iUSD</td></tr>
                      <tr><td style={tdLabel}>{t('gift.feeLabelShort')}</td><td style={tdValue}>{(result.box.fee_bps / 100).toFixed(1)}%</td></tr>
                      <tr><td style={tdLabel}>{t('gift.shares')}</td><td style={tdValue}>{result.numSlots}{result.numSlots > 1 ? ` · ${result.splitMode}` : ''}</td></tr>
                      {result.message && (
                        <tr><td style={tdLabel}>{t('transfer.memoLabel')}</td><td style={{
                          ...tdValue,
                          fontFamily: result.memoFont ? `'${result.memoFont}', cursive` : 'inherit',
                          fontStyle: result.memoFont ? 'normal' : 'italic',
                          fontSize: result.memoFont ? 15 : 11,
                        }}>{result.message}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {!result.isAnonymous && (
                <div style={{ fontSize: 10, color: '#22c55e', lineHeight: 1.5 }}>
                  {t('gift.notificationSent', { name: result.recipientDisplay })}
                </div>
              )}
            </>
          ) : (
            /* ── QR Card — Mystery Gift Box (pixel font, light/dark aware) ── */
            (() => {
              const isDark = document.documentElement.classList.contains('dark')
                || (!document.documentElement.classList.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches)
              const cardBg = isDark ? '#0d0d1a' : '#f5f3ef'
              const textPrimary = isDark ? '#fff' : '#1a1a1a'
              const sparkleColor = isDark ? '#FFD700' : '#d4a017'
              const borderColor = isDark ? 'rgba(255,215,0,0.15)' : 'rgba(180,150,80,0.2)'
              const qrTheme = isDark ? 'dark' as const : 'light' as const
              const sc = result.wrapParams?.scale ?? 1.0
              return (
                <div ref={qrCardRef} style={{
                  background: cardBg, borderRadius: 16, padding: '28px 24px',
                  border: `1px solid ${borderColor}`,
                  position: 'relative', overflow: 'hidden',
                  fontFamily: "'Press Start 2P', 'Silkscreen', monospace",
                }}>
                  <style>{`
                    @keyframes qrSparkle { 0%,100%{opacity:0.2} 50%{opacity:0.8} }
                    @keyframes qrBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.02)} }
                  `}</style>

                  {/* Sparkle dots */}
                  {[{t:8,l:12,d:2.1},{t:20,l:85,d:1.7},{t:70,l:8,d:2.5},{t:55,l:90,d:1.9},{t:90,l:50,d:2.3}].map((s, i) => (
                    <div key={i} style={{
                      position: 'absolute', top: `${s.t}%`, left: `${s.l}%`,
                      width: 3, height: 3, borderRadius: '50%', background: sparkleColor,
                      animation: `qrSparkle ${s.d}s ease-in-out infinite`,
                      animationDelay: `${i * 0.4}s`, pointerEvents: 'none',
                    }} />
                  ))}

                  {/* Title — pixel font */}
                  <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <div style={{ fontSize: 7, letterSpacing: '0.06em', color: `hsl(${dnaHue}, 60%, ${isDark ? 55 : 40}%)`, marginBottom: 6 }}>
                      {t('gift.fromSender', { name: senderNick.toUpperCase() })}
                    </div>
                    <div style={{ fontSize: 8, color: isDark ? '#d4a017' : '#9a7b1a', lineHeight: 1.6 }}>
                      {t('gift.giftWaitingShort')}
                    </div>
                  </div>

                  {/* Mystery gift box + QR side by side */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ animation: 'qrBreath 3s ease-in-out infinite' }}>
                      <GiftBoxImage styleId={result.wrapStyleId ?? 0} size={Math.round(120 * sc)} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                      <StyledQR url={link} size={110} theme={qrTheme} />
                      <div style={{ fontSize: 6, color: textPrimary, letterSpacing: '0.04em' }}>
                        {t('gift.scanToOpenShort')}
                      </div>
                      {/* Brand tagline — left-aligned with QR */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, whiteSpace: 'nowrap' }}>
                        <img src="/images/iusd.png?v=20260414" alt="" style={{ width: 10, height: 10, borderRadius: '50%' }} />
                        <span style={{ fontSize: 6, letterSpacing: '0.04em', color: textPrimary }}>
                          {t('gift.iusdPay')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()
          )}

          {/* QR screenshot preview (desktop) */}
          {qrPreview && (
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
              <img src={qrPreview} alt="Gift QR" style={{ maxWidth: '100%', borderRadius: 8 }} />
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>{t('gift.rightClickSave')}</div>
              <button onClick={() => { setQrPreview(null) }} style={{
                marginTop: 6, padding: '4px 12px', borderRadius: 6, fontSize: 10,
                background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer',
              }}>{t('gift.dismiss')}</button>
            </div>
          )}

          {/* Progress & activity (history mode only) */}
          {result.packet && <SentGiftProgressPanel packet={result.packet} />}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {qrMode ? (
              /* QR mode (default): Copy Link + Copy Image */
              <>
                <button onClick={() => { navigator.clipboard.writeText(link); setQrCopied(true); setTimeout(() => setQrCopied(false), 2000) }}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, fontSize: 12,
                    fontWeight: 700, background: 'var(--bg-elevated)', color: 'var(--text)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                  </svg>
                  {qrCopied ? t('gift.copied') : t('gift.copyLink')}
                </button>
                <button onClick={handleShare} disabled={sharing} style={{
                  flex: 1, padding: '12px', borderRadius: 10, fontSize: 12,
                  fontWeight: 700, background: 'var(--text)', color: 'var(--surface)',
                  border: 'none', cursor: sharing ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  opacity: sharing ? 0.6 : 1,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                  {sharing ? '...' : t('gift.saveImage')}
                </button>
              </>
            ) : (
              /* Details mode: Share Link + Back to QR */
              <>
                <button onClick={handleShare} disabled={sharing} style={{
                  flex: 1, padding: '12px', borderRadius: 10, border: 'none', fontSize: 13,
                  fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', cursor: sharing ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: sharing ? 0.6 : 1,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                  </svg>
                  {t('gift.shareLink')}
                </button>
                <button onClick={() => setQrMode(true)} style={{
                  padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, flexShrink: 0,
                  background: 'var(--bg-elevated)', color: 'var(--text)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>{`← ${t('gift.qrBtn')}`}</button>
              </>
            )}
          </div>
          {/* Navigation link: QR ↔ Details */}
          {qrMode ? (
            <button onClick={() => setQrMode(false)} style={{
              background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
              fontSize: 11, textAlign: 'center', width: '100%', padding: '4px',
            }}>{t('gift.viewDetails')}</button>
          ) : (
            <button onClick={() => setQrMode(true)} style={{
              background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
              fontSize: 11, textAlign: 'center', width: '100%', padding: '4px',
            }}>{t('gift.backToQr')}</button>
          )}

          {/* Close hint */}
          <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
            {t('gift.closeShareLater')}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Gift Detail Modal (from history) ──────────────────────────────────────

function GiftDetailModal({ pkt, onClose }: { pkt: SentPacket; onClose: () => void }) {
  const { t } = useTranslation()
  const giftText = useGiftBoxText()
  const { account, address: senderAddr, token } = useAuthContext()
  const senderNick = account?.nickname ?? t('gift.someone')
  const [qrMode, setQrMode] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [qrCopied, setQrCopied] = useState(false)
  const [detailTab, setDetailTab] = useState<'replies' | 'views'>('replies')
  const [replies, setReplies] = useState<any[]>([])
  const [viewers, setViewers] = useState<any[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  const qrCardRef = useRef<HTMLDivElement>(null)

  const link = pkt.claim_url ?? ''
  const thumb = pkt.gift?.image_url ?? ''
  const claimedCount = pkt.claims?.length ?? 0
  const replyCount = pkt.claims?.filter(c => c.thank_emoji || c.thank_message).length ?? 0

  const dnaHue = useMemo(() => {
    if (!senderAddr) return 200
    let h = 0x811c9dc5
    const s = senderAddr.toLowerCase()
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    return (h >>> 0) % 360
  }, [senderAddr])

  // Load memo font
  useEffect(() => {
    const fonts = ['Press Start 2P']
    if (pkt.memo_font) fonts.push(pkt.memo_font)
    fonts.forEach(f => {
      const id = `gfont-${f.replace(/\s/g, '-')}`
      if (document.getElementById(id)) return
      const el = document.createElement('link')
      el.id = id; el.rel = 'stylesheet'
      el.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}&display=swap`
      document.head.appendChild(el)
    })
  }, [pkt.memo_font])

  // Load replies and views
  useEffect(() => {
    if (!token || !pkt.packet_id) return
    setLoadingDetail(true)
    Promise.all([
      fetch(`${API_BASE}/gift/packet/${pkt.packet_id}/replies`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : { replies: [] }),
      fetch(`${API_BASE}/gift/packet/${pkt.packet_id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : { viewers: [] }),
    ]).then(([repData, pktData]) => {
      setReplies(repData.replies ?? [])
      setViewers(pktData.viewers ?? [])
    }).finally(() => setLoadingDetail(false))
  }, [token, pkt.packet_id])

  const [qrPreview, setQrPreview] = useState<string | null>(null)

  async function handleShare() {
    if (sharing) return
    if (qrMode && qrCardRef.current) {
      setSharing(true)
      try {
        // Capture QR card — warm-up pass first (images may not be rendered yet)
        const opts2 = { pixelRatio: 2, backgroundColor: '#0d0d1a' }
        await toPng(qrCardRef.current, opts2).catch(() => {})
        const dataUrl = await toPng(qrCardRef.current, opts2)
        const res = await fetch(dataUrl)
        const blob = await res.blob()
        const file = new File([blob], 'gift-qr.png', { type: 'image/png' })
        const isAndroid = /Android/i.test(navigator.userAgent)
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
        if (isIOS && navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] }).catch(() => {})
        } else {
          // Android & desktop: direct download
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `gift-${Date.now()}.png`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          if (!isAndroid) {
            try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) } catch {}
          }
          setQrCopied(true); setTimeout(() => setQrCopied(false), 2500)
        }
      } catch {} finally { setSharing(false) }
    } else {
      if (navigator.share) navigator.share({ title: t('gift.shareTitle', { name: pkt.gift?.name ?? '' }), url: link }).catch(() => {})
      else navigator.clipboard.writeText(link)
    }
  }

  const repliesWithMsg = pkt.claims?.filter(c => c.thank_emoji || c.thank_message) ?? []

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...sheetStyle, maxWidth: 480, padding: 0, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{giftText.name(pkt.box_id, pkt.gift?.name)}</div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              // Larger hit area — 44x44 is Apple HIG tap target minimum.
              width: 44, height: 44,
              marginRight: -12,
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 22,
              flexShrink: 0,
            }}
          >✕</button>
        </div>

        <div style={{ padding: '14px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!qrMode ? (
            /* Details view */
            <div style={{ display: 'flex', gap: 12 }}>
              {thumb && (
                <div style={{ width: 100, height: 100, flexShrink: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pkt.sender_message && (
                  <div style={{
                    fontFamily: pkt.memo_font ? `'${pkt.memo_font}', cursive` : 'inherit',
                    fontStyle: pkt.memo_font ? 'normal' : 'italic',
                    fontSize: pkt.memo_font ? 14 : 11,
                    color: 'var(--text)', lineHeight: 1.4,
                  }}>{pkt.sender_message}</div>
                )}
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  {formatIusd(pkt.total_amount)} <span style={{ fontSize: 10, color: 'var(--muted)' }}>iUSD</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {t('gift.sharesCount', { count: pkt.num_slots })} · {t(`gift.progressPanel.${pkt.status === 'active' ? 'inProgress' : pkt.status === 'completed' ? 'completed' : pkt.status === 'expired' ? 'expired' : 'inProgress'}`)}
                </div>
              </div>
            </div>
          ) : (
            /* QR view */
            <div ref={qrCardRef} style={{
              background: 'var(--surface)', borderRadius: 14, padding: '16px',
              border: '1px solid var(--border)',
              fontFamily: "'Press Start 2P', 'Silkscreen', monospace",
            }}>
              <div style={{ fontSize: 11, lineHeight: 1.8, marginBottom: 12 }}>
                <span style={{ color: `hsl(${dnaHue}, 60%, 42%)` }}>{senderNick}</span>
                {' '}
                <span style={{ color: '#d4a017' }}>{t('gift.hasAGiftForYou')}</span>
              </div>
              <div style={{ display: 'flex', gap: 14 }}>
                <div style={{ width: 140, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {thumb && (
                    <div style={{ width: 140, flex: 1, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  )}
                  <div style={{ fontSize: 8, color: 'var(--text)' }}>{giftText.name(pkt.box_id, pkt.gift?.name)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                  {pkt.sender_message && (
                    <div style={{ fontSize: 9, color: 'var(--text)', lineHeight: 1.6 }}>{pkt.sender_message}</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>
                    {formatIusd(pkt.total_amount)} <span style={{ fontSize: 8, color: 'var(--muted)' }}>iUSD</span>
                    <span style={{ fontSize: 8, color: 'var(--muted)', marginLeft: 6 }}>{t('gift.sharesCount', { count: pkt.num_slots })}</span>
                  </div>
                  <StyledQR url={link} size={130} theme="light" />
                  <div style={{ fontSize: 8, fontWeight: 900, color: 'var(--text)', marginTop: -2 }}>{t('gift.scanToOpen')}</div>
                </div>
              </div>
            </div>
          )}

          {/* QR screenshot preview (desktop) */}
          {qrPreview && (
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
              <img src={qrPreview} alt="Gift QR" style={{ maxWidth: '100%', borderRadius: 8 }} />
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>{t('gift.rightClickSave')}</div>
              <button onClick={() => setQrPreview(null)} style={{
                marginTop: 6, padding: '4px 12px', borderRadius: 6, fontSize: 10,
                background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer',
              }}>{t('gift.dismiss')}</button>
            </div>
          )}

          {/* Share + QR buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleShare} disabled={sharing} style={{
              flex: 1, padding: '10px', borderRadius: 10, border: 'none', fontSize: 12,
              fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', cursor: sharing ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: sharing ? 0.6 : 1,
            }}>
              {sharing ? t('gift.preparing') : qrCopied ? t('gift.imageSaved') : qrMode ? t('gift.saveImage') : t('gift.shareLink')}
            </button>
            <button onClick={() => setQrMode(v => !v)} style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, flexShrink: 0,
              background: qrMode ? 'var(--text)' : 'var(--bg-elevated)',
              color: qrMode ? 'var(--surface)' : 'var(--text)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}>
              {qrMode ? t('gift.backBtn') : t('gift.qrBtn')}
            </button>
          </div>

          {/* Stats bar */}
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted)', padding: '4px 0' }}>
            <span style={{ color: claimedCount > 0 ? '#22c55e' : 'var(--muted)' }}>
              {t('gift.openedCount', { count: claimedCount, total: pkt.num_slots })}
            </span>
            <span>{t('gift.viewsCount', { count: viewers.length || pkt.view_count || 0 })}</span>
            <span>{t('inbox.replyCount', { count: replies.length || replyCount })}</span>
          </div>

          {/* Replies / Views tabs */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', borderRadius: 8, padding: 3 }}>
            {(['replies', 'views'] as const).map(tab => (
              <button key={tab} onClick={() => setDetailTab(tab)} style={{
                flex: 1, padding: '5px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 700,
                background: detailTab === tab ? 'var(--text)' : 'transparent',
                color: detailTab === tab ? 'var(--surface)' : 'var(--muted)',
              }}>
                {tab === 'replies'
                  ? t('inbox.replyCount', { count: replies.length || replyCount })
                  : t('gift.viewsCount', { count: viewers.length || pkt.view_count || 0 })}
              </button>
            ))}
          </div>

          {loadingDetail && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: 12 }}>{t('common.loading')}</div>}

          {/* Replies tab */}
          {!loadingDetail && detailTab === 'replies' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {replies.length === 0 && repliesWithMsg.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 12 }}>{t('gift.noReplies')}</div>}
              {(replies.length > 0 ? replies : repliesWithMsg).map((c: any, i: number) => (
                <div key={i} style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{c.claimer_nickname ?? t('gift.anonymous')}</span>
                    <span style={{ fontSize: 9, color: '#22c55e' }}>+{formatIusd(c.amount)} iUSD</span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>
                    {c.thank_emoji && <span style={{ marginRight: 4 }}>{c.thank_emoji}</span>}
                    {c.thank_message}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>{timeAgo(c.claimed_at)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Views tab */}
          {!loadingDetail && detailTab === 'views' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {viewers.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 12 }}>{t('gift.noViews')}</div>}
              {viewers.map((v: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: 'var(--bg)', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ fontWeight: 500 }}>{v.viewer_nickname ?? t('gift.anonymous')}</span>
                  <span style={{ fontSize: 9, color: 'var(--muted)' }}>{timeAgo(v.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Gift Page ─────────────────────────────────────────────────────────

export function Gift() {
  const { t } = useTranslation()
  const collLabel = useCollectionLabel()
  const giftText = useGiftBoxText()
  const { token } = useAuthContext()
  const navigate = useNavigate()
  const smartClose = useSmartClose('/app')
  const [searchParams] = useSearchParams()
  const unreadSync = useUnreadSync()
  const [historySort, setHistorySort] = useState<'asc' | 'desc'>(() => {
    try { return (localStorage.getItem('ipay_gift_history_sort') as 'asc' | 'desc') ?? 'desc' } catch { return 'desc' }
  })
  useEffect(() => {
    try { localStorage.setItem('ipay_gift_history_sort', historySort) } catch {}
  }, [historySort])
  const [tab, _setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    return t === 'history' ? 'history' : 'gifts'
  })

  // Gifts tab state
  const [boxes, setBoxes] = useState<GiftBox[]>([])
  const [boxesLoading, setBoxesLoading] = useState(true)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filterCol, setFilterCol] = useState<string>('all')
  const [viewerImg, setViewerImg] = useState<{ images: string[]; idx: number } | null>(null)
  const [descBox, setDescBox] = useState<GiftBox | null>(null)
  // PacketId currently open in the received-gift preview modal. `null` = closed.
  const [previewPacketId, setPreviewPacketId] = useState<string | null>(null)
  const [sendBox, setSendBox] = useState<GiftBox | null>(null)
  const [sendResult, setSendResult] = useState<GiftSendResult | null>(null)
  const [wrapping, setWrapping] = useState<GiftSendResult | null>(null)

  // History state (paginated)
  const PAGE_SIZE = 20
  const [received, setReceived] = useState<ReceivedGift[]>([])
  const [receivedHasMore, setReceivedHasMore] = useState(false)
  const [receivedLoadingMore, setReceivedLoadingMore] = useState(false)
  const [unclaimedCount, setUnclaimedCount] = useState(0)

  // Sent tab state (paginated)
  const [sent, setSent] = useState<SentPacket[]>([])
  const [sentHasMore, setSentHasMore] = useState(false)
  const [sentLoadingMore, setSentLoadingMore] = useState(false)
  const [detailPkt, setDetailPkt] = useState<SentPacket | null>(null)
  const [loading, setLoading] = useState(false)

  // Load gift boxes — adapt from /gift/configs response (V1 field names)
  useEffect(() => {
    setBoxesLoading(true)
    fetch(`${API_BASE}/gift/configs`)
      .then(r => r.json())
      .then(d => {
        const raw: any[] = d.configs ?? d.boxes ?? []
        const mapped: GiftBox[] = raw
          .filter((c: any) => c.enabled !== false)
          .map((c: any) => ({
            box_id: c.giftId ?? c.box_id,
            name: c.title ?? c.name ?? '',
            amount: c.amount ?? 0, // already in iUSD (API converts from micro)
            fee_bps: c.feeBps ?? (c.boxFee != null && c.amount ? Math.round(c.boxFee / c.amount * 10000) : (c.fee_bps ?? 0)),
            urls: c.imageUrls?.length ? c.imageUrls : (c.thumbUrl ? [c.thumbUrl] : (c.urls ?? [])),
            enabled: c.enabled !== false,
            description: c.culture ?? c.description ?? '',
            collection: c.tier ?? c.collection ?? 'other',
            image_urls: c.imageUrls?.length ? c.imageUrls : (c.thumbUrl ? [c.thumbUrl] : (c.image_urls ?? c.urls ?? [])),
            source_url: c.source_url,
            featured: c.featured === true,
            featuredSort: c.featuredSort ?? 0,
          }))
        setBoxes(mapped)
      })
      .catch(() => {})
      .finally(() => setBoxesLoading(false))
  }, [])

  // Dashboard PromoBanner passes ?box=<id> to auto-open the SendGiftModal
  // for the advertised box. We wait for the box list to populate, then
  // find the matching entry exactly once and open it. Strip the param
  // from the URL after consuming so a back-nav doesn't re-open.
  const consumedBoxParamRef = useRef(false)
  useEffect(() => {
    if (consumedBoxParamRef.current) return
    const raw = searchParams.get('box')
    if (!raw) return
    if (boxes.length === 0) return   // wait for load
    const wantedId = parseInt(raw, 10)
    if (Number.isNaN(wantedId)) { consumedBoxParamRef.current = true; return }
    const match = boxes.find(b => b.box_id === wantedId)
    if (match) {
      setSendBox(match)
    }
    consumedBoxParamRef.current = true
    // Drop the param so closing+reopening the modal via navigation
    // doesn't re-trigger this effect.
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('box')
    navigate(`/app/gift${nextParams.toString() ? '?' + nextParams.toString() : ''}`, { replace: true })
  }, [boxes, searchParams, navigate])

  // Cursor refs for /v1/activity pagination — refs (not state) so the
  // loader callbacks stay stable across renders and the "load more" path
  // doesn't re-trigger the initial-load effect via callback identity churn.
  const receivedCursorRef = useRef<string | null>(null)
  const sentCursorRef = useRef<string | null>(null)

  // Load received gifts — via unified /v1/activity (gift_received type)
  const loadReceived = useCallback(async (append = false) => {
    if (!token) return
    if (append) setReceivedLoadingMore(true); else setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('types', 'gift_received')
      params.set('limit', String(PAGE_SIZE))
      params.set('sort', historySort)
      if (append && receivedCursorRef.current) params.set('cursor', receivedCursorRef.current)
      const r = await fetch(`${API_BASE}/activity?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      const items: ReceivedGift[] = (d.items ?? []).map(activityToReceivedGift)
      setReceived(prev => append ? [...prev, ...items] : items)
      setReceivedHasMore(!!d.hasMore)
      receivedCursorRef.current = d.nextCursor ?? null
    } catch {} finally {
      if (append) setReceivedLoadingMore(false); else setLoading(false)
    }
  }, [token, historySort])

  // Unclaimed count is derived from the received list itself (no extra API
  // call). The History page is the single authoritative consumer of
  // /v1/activity/stats; everywhere else derives counts from local data.
  useEffect(() => {
    setUnclaimedCount(received.filter(g => !g.claimed).length)
  }, [received])

  // Load sent gifts — via unified /v1/activity (gift_sent type)
  const loadSent = useCallback(async (append = false) => {
    if (!token) return
    if (append) setSentLoadingMore(true); else setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('types', 'gift_sent')
      params.set('limit', String(PAGE_SIZE))
      params.set('sort', historySort)
      if (append && sentCursorRef.current) params.set('cursor', sentCursorRef.current)
      const r = await fetch(`${API_BASE}/activity?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      const items: SentPacket[] = (d.items ?? []).map(activityToSentPacket)
      setSent(prev => append ? [...prev, ...items] : items)
      setSentHasMore(!!d.hasMore)
      sentCursorRef.current = d.nextCursor ?? null
    } catch {} finally {
      if (append) setSentLoadingMore(false); else setLoading(false)
    }
  }, [token, historySort])

  useEffect(() => {
    if (tab === 'history') {
      loadReceived()
      loadSent()
    }
  }, [tab, loadReceived, loadSent])
  useEffect(() => { loadReceived() }, [loadReceived]) // for badge count
  // Refetch both lists whenever the shared unread revision bumps so other
  // surfaces (History gift tab, Inbox Reply tab) propagate clearing to here.
  useEffect(() => {
    if (unreadSync.revision === 0) return
    if (tab === 'history') { loadReceived(); loadSent() }
    else { loadReceived() }
  }, [unreadSync.revision]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open SendGiftModal when ?sendTo= param is present
  const autoSendTo = searchParams.get('sendTo')
  useEffect(() => {
    if (autoSendTo && boxes.length > 0 && !sendBox && !sendResult && !wrapping) {
      setSendBox(boxes[0]) // open with first available box
    }
  }, [autoSendTo, boxes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered & sorted boxes
  const filtered = boxes
    .filter(b => filterCol === 'all' || b.collection === filterCol)
    .sort((a, b) => {
      // Featured first (by featuredSort), then by price
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      if (a.featured && b.featured) return (a.featuredSort ?? 0) - (b.featuredSort ?? 0)
      return sortDir === 'asc' ? a.amount - b.amount : b.amount - a.amount
    })

  const collections = ['all', ...COLLECTIONS.filter(c => boxes.some(b => b.collection === c))]



  function setTab(next: Tab) {
    _setTab(next)
    navigate(next === 'history' ? '/app/gift?tab=history' : '/app/gift', { replace: true })
  }

  return (
    <div style={{ padding: '16px 16px 80px', maxWidth: 480, margin: '0 auto', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={smartClose} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)',
          fontSize: 16, padding: '4px 6px', display: 'flex', fontFamily: 'system-ui, sans-serif',
        }}>←</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t('gift.title')}</span>
      </div>

      {/* ═══ GIFTS LIST (no tabs) ═══ */}
      {(
        <>
          {/* Filter + Sort */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <select value={filterCol} onChange={e => setFilterCol(e.target.value)}
              style={{
                flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text)', outline: 'none', minWidth: 0,
              }}>
              {collections.map(c => (
                <option key={c} value={c}>{c === 'all' ? t('gift.allCollections') : collLabel(c)}</option>
              ))}
            </select>
            <button
              onClick={() => setTab(tab === 'history' ? 'gifts' : 'history')}
              style={{
                ...sortBtn,
                color: tab === 'history' ? 'var(--surface)' : 'var(--text)',
                background: tab === 'history' ? 'var(--text)' : 'var(--bg-elevated)',
                borderColor: tab === 'history' ? 'var(--text)' : 'var(--border)',
              }}>
              {tab === 'history'
                ? `← ${t('gift.giftList')}`
                : `${t('gift.historyTab')}${unclaimedCount > 0 ? ` (${unclaimedCount})` : ''}`}
            </button>
            <button onClick={() => {
                if (tab === 'history') setHistorySort(d => d === 'asc' ? 'desc' : 'asc')
                else setSortDir(d => d === 'asc' ? 'desc' : 'asc')
              }}
              style={sortBtn}
              title={tab === 'history'
                ? (historySort === 'desc' ? t('gift.newestFirst') : t('gift.oldestFirst'))
                : undefined}>
              {tab === 'history'
                ? (historySort === 'desc' ? `↓ ${t('gift.newest')}` : `↑ ${t('gift.oldest')}`)
                : (sortDir === 'asc' ? '↑' : '↓')}
            </button>
          </div>

          {tab === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Only show full-page "Loading history..." on first load
                  (when no data has been fetched yet). Subsequent refreshes
                  keep the list rendered so scroll position stays put. */}
              {loading && received.length === 0 && sent.length === 0 && (
                <div style={emptyMsg}>{t('gift.loadingHistory')}</div>
              )}

              <GiftHistoryList
                received={received}
                sent={sent}
                receivedHasMore={receivedHasMore}
                sentHasMore={sentHasMore}
                receivedLoadingMore={receivedLoadingMore}
                sentLoadingMore={sentLoadingMore}
                onLoadMoreReceived={() => loadReceived(true)}
                onLoadMoreSent={() => loadSent(true)}
                showEmpty={!loading}
                emptyMessage={t('history.noGiftHistory')}
                onReceivedClick={(item) => {
                  setPreviewPacketId(item.packet_id)
                  if ((item.unseen_activity_count ?? 0) > 0) {
                    unreadSync.markSeen(item.packet_id)
                    setReceived(prev => prev.map(r =>
                      r.packet_id === item.packet_id ? { ...r, unseen_activity_count: 0 } : r
                    ))
                  }
                }}
                onSentClick={(pkt) => {
                  // Reuse the live "Gift is Ready" UI (ShareLinksModal)
                  // by synthesizing a GiftSendResult from this packet.
                  const matchingBox = boxes.find(b => b.box_id === pkt.box_id)
                  // pkt.total_amount is already iUSD (mapped by activityToSentPacket).
                  // ShareLinksModal expects amount/fee as the *total* gift amount,
                  // mirroring the original send flow (Gift.tsx:555) — not per-slot.
                  const grossIusd = Number(pkt.total_amount ?? 0)
                  // Prefer API-provided feeBps (resolved server-side from box
                  // config); fall back to the locally-loaded box if the API
                  // didn't include it yet.
                  const feeBps = pkt.fee_bps ?? matchingBox?.fee_bps ?? 0
                  const totalFee = grossIusd * feeBps / 10000
                  const links: string[] = pkt.claim_links && pkt.claim_links.length > 0
                    ? pkt.claim_links
                    : (pkt.claim_url ? [pkt.claim_url] : [])
                  const synthesized: GiftSendResult = {
                    links,
                    box: matchingBox ?? {
                      box_id: pkt.box_id,
                      name: pkt.gift?.name ?? `Gift #${pkt.box_id}`,
                      amount: Math.round(grossIusd * 1_000_000),
                      fee_bps: feeBps,
                      urls: pkt.gift?.image_urls ?? [],
                      enabled: true,
                      description: pkt.gift?.description ?? '',
                      collection: pkt.gift?.collection ?? '',
                      image_urls: pkt.gift?.image_urls ?? [],
                    },
                    amount: grossIusd,
                    fee: totalFee,
                    numSlots: pkt.num_slots,
                    splitMode: pkt.split_mode ?? 'equal',
                    recipientDisplay: pkt.mode === 1 ? t('history.anyone') : t('history.direct'),
                    isAnonymous: false,
                    message: pkt.sender_message ?? '',
                    memoFont: pkt.memo_font ?? undefined,
                    wrapStyleId: pkt.wrap_style_id ?? 0,
                    wrapParams: pkt.wrap_params ?? undefined,
                    packet: pkt,
                  }
                  setSendResult(synthesized)
                  const unseenActivity = pkt.unseen_activity_count ?? pkt.unseen_reply_count ?? 0
                  if (unseenActivity > 0) {
                    unreadSync.markSeen(pkt.packet_id)
                    setSent(prev => prev.map(p =>
                      p.packet_id === pkt.packet_id
                        ? { ...p, unseen_activity_count: 0, unseen_reply_count: 0 }
                        : p
                    ))
                  }
                }}
              />

              {/* Detail modal for sent gift */}
              {detailPkt && <GiftDetailModal pkt={detailPkt} onClose={() => setDetailPkt(null)} />}
            </div>
          )}


          {/* Skeleton loading */}
          {tab === 'gifts' && boxesLoading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ ...cardStyle, animation: 'pulse 1.5s ease-in-out infinite' }}>
                  <div style={{ aspectRatio: '1', background: 'var(--bg)', borderRadius: '10px 10px 0 0' }} />
                  <div style={{ padding: '8px 10px 10px' }}>
                    <div style={{ height: 12, width: '70%', background: 'var(--bg)', borderRadius: 4, marginBottom: 6 }} />
                    <div style={{ height: 14, width: '50%', background: 'var(--bg)', borderRadius: 4, marginBottom: 6 }} />
                    <div style={{ height: 28, width: '100%', background: 'var(--bg)', borderRadius: 6 }} />
                  </div>
                </div>
              ))}
              <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
            </div>
          )}

          {/* Gift grid */}
          {tab === 'gifts' && !boxesLoading && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, overflow: 'hidden' }}>
            <style>{`
              .gift-card { transition: transform 0.2s ease, box-shadow 0.2s ease; }
              .gift-card:hover { transform: scale(1.03); box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important; }
              .gift-card:active { transform: scale(0.98); }
            `}</style>
            {filtered.map(box => {
              const images = box.image_urls?.length ? box.image_urls : box.urls ?? []
              const thumb = images[0]
              return (
                <div key={box.box_id} className="gift-card"
                  style={{ ...cardStyle, minWidth: 0, cursor: 'pointer', position: 'relative' }}
                  onClick={() => setSendBox(box)}>
                  {/* Collection badge — left */}
                  {box.collection && box.collection !== 'other' && (
                    <div style={{
                      position: 'absolute', top: 6, left: 6, zIndex: 2,
                      padding: '2px 7px', borderRadius: 8, fontSize: 8, fontWeight: 600,
                      background: 'rgba(0,0,0,0.55)', color: '#fff', backdropFilter: 'blur(4px)',
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}>
                      {collLabel(box.collection)}
                    </div>
                  )}
                  {/* Featured flag — right */}
                  {box.featured && (
                    <div style={{
                      position: 'absolute', top: 6, right: 6, zIndex: 2,
                      padding: '2px 7px', borderRadius: 8, fontSize: 7, fontWeight: 700,
                      background: 'rgba(255,215,0,0.85)', color: '#1a1a1a',
                      letterSpacing: '0.05em', textTransform: 'uppercase',
                    }}>
                      {t('gift.featured')}
                    </div>
                  )}
                  {/* Image — larger, no inner frame */}
                  <div style={{ position: 'relative', width: '100%', height: 0, paddingBottom: '110%',
                                borderRadius: '14px 14px 0 0', overflow: 'hidden', background: 'var(--bg)' }}>
                    {thumb ? (
                      <img src={thumb} alt={box.name} loading="lazy"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 28 }}>🎁</div>
                    )}
                  </div>
                  {/* Info below image */}
                  <div style={{ padding: '6px 10px 8px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                      {giftText.name(box.box_id, box.name)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                        {box.amount > 0 ? formatIusd(box.amount) : t('gift.flexible')}
                        <span style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 2, fontWeight: 400 }}>iUSD</span>
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--muted)' }}>
                        {t('gift.feePercent', { percent: (box.fee_bps / 100).toFixed(1) })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>}
          {tab === 'gifts' && !boxesLoading && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
              No gifts available
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {viewerImg && <ImageViewer images={viewerImg.images} startIdx={viewerImg.idx} onClose={() => setViewerImg(null)} />}
      {descBox && <DescriptionModal box={descBox} onClose={() => setDescBox(null)} />}
      {sendBox && <SendGiftModal box={sendBox} allBoxes={filtered} defaultRecipient={searchParams.get('sendTo') ?? undefined} onClose={() => setSendBox(null)}
        onSent={result => { setSendBox(null); setSendResult(null); setWrapping(result); navigate('/app/gift', { replace: true }) }} />}
      {wrapping && <WrapAnimation result={wrapping} onDone={() => { setSendResult(wrapping); setWrapping(null) }} />}
      {sendResult && <ShareLinksModal result={sendResult} onClose={() => setSendResult(null)} />}
      {previewPacketId && (
        <ReceivedGiftPreviewModal
          packetId={previewPacketId}
          onClose={() => setPreviewPacketId(null)}
        />
      )}
    </div>
  )
}

// ── Sent-gift progress & activity panel ───────────────────────────────────
// Rendered inside ShareLinksModal when the modal is opened from Gift History
// → Sent (result.packet is populated). Surfaces claim progress, per-claim
// detail with thank-you replies, and expiry/refund status.
function SentGiftProgressPanel({ packet }: { packet: SentPacket }) {
  const { t } = useTranslation()
  const claims = packet.claims ?? []
  const claimedCount = claims.length
  const totalSlots = packet.num_slots ?? 1
  const progress = totalSlots > 0 ? Math.min(claimedCount / totalSlots, 1) : 0
  const isFullyClaimed = claimedCount >= totalSlots && totalSlots > 0
  const status = packet.status ?? 'active'
  const isExpired = status === 'expired'
  const isCompleted = status === 'completed' || (isFullyClaimed && !isExpired)
  const unclaimedSlots = Math.max(0, totalSlots - claimedCount)

  // Expiry countdown (only meaningful for still-active gifts)
  const expiresAtMs = packet.expires_at ? new Date(packet.expires_at).getTime() : null
  const nowMs = Date.now()
  const msUntilExpiry = expiresAtMs != null ? expiresAtMs - nowMs : null
  const expirySoon = msUntilExpiry != null && msUntilExpiry > 0 && msUntilExpiry < 86_400_000
  const expiryLabel = (() => {
    if (msUntilExpiry == null) return null
    if (msUntilExpiry <= 0) return t('gift.progressPanel.expired')
    const hours = Math.floor(msUntilExpiry / 3_600_000)
    const days = Math.floor(hours / 24)
    if (days >= 1) return t('gift.progressPanel.daysHours', { days, hours: hours % 24 })
    if (hours >= 1) return t('gift.progressPanel.hoursMinutes', { hours, minutes: Math.floor((msUntilExpiry % 3_600_000) / 60_000) })
    return t('gift.progressPanel.minutesOnly', { minutes: Math.floor(msUntilExpiry / 60_000) })
  })()

  // Status chip styling
  let chipBg = 'rgba(59,130,246,0.12)'
  let chipBorder = 'rgba(59,130,246,0.35)'
  let chipColor = '#3b82f6'
  let chipLabel = t('gift.progressPanel.inProgress')
  if (isExpired) {
    chipBg = 'rgba(148,163,184,0.12)'
    chipBorder = 'rgba(148,163,184,0.35)'
    chipColor = '#94a3b8'
    chipLabel = unclaimedSlots > 0 ? t('gift.progressPanel.expiredRefunded') : t('gift.progressPanel.expired')
  } else if (isCompleted) {
    chipBg = 'rgba(34,197,94,0.12)'
    chipBorder = 'rgba(34,197,94,0.40)'
    chipColor = '#22c55e'
    chipLabel = t('gift.progressPanel.completed')
  } else if (expirySoon) {
    chipBg = 'rgba(245,158,11,0.12)'
    chipBorder = 'rgba(245,158,11,0.40)'
    chipColor = '#f59e0b'
    chipLabel = t('gift.progressPanel.expiresIn', { label: expiryLabel ?? '' })
  }

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Status header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {t('gift.progressPanel.progress')}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
          padding: '3px 8px', borderRadius: 20,
          background: chipBg, border: `1px solid ${chipBorder}`, color: chipColor,
        }}>{chipLabel}</span>
      </div>

      {/* Claim count + progress bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{claimedCount}</span>
            {' '}
            {t('gift.progressPanel.claimedOf', { total: totalSlots })}
          </span>
          {!isExpired && !isCompleted && expiryLabel && (
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {t('gift.progressPanel.endsIn', { label: expiryLabel })}
            </span>
          )}
        </div>
        <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            width: `${progress * 100}%`, height: '100%',
            background: isCompleted ? '#22c55e' : isExpired ? '#94a3b8' : '#3b82f6',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Refund banner — only when expired with unclaimed slots */}
      {isExpired && unclaimedSlots > 0 && (
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.28)',
          borderRadius: 8, padding: '8px 10px',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>💰</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>
              {t('gift.progressPanel.refunded', { count: unclaimedSlots })}
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>
              {t('gift.progressPanel.refundedNote')}
            </div>
          </div>
        </div>
      )}

      {/* Completion banner */}
      {isCompleted && (
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.28)',
          borderRadius: 8, padding: '8px 10px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>🎉</span>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#22c55e' }}>
            {t('gift.progressPanel.allClaimed')}
          </div>
        </div>
      )}

      {/* Claim list */}
      {claims.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            {t('gift.progressPanel.claimsHeader', { count: claims.length })}
          </div>
          {claims.map((c, i) => {
            const hasReply = !!(c.thank_emoji || c.thank_message)
            const name = c.claimer_nickname ?? c.claimer_short_id ?? t('gift.progressPanel.anon')
            return (
              <div key={`${c.slot_index}-${i}`} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '8px 10px',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
                    {c.claimer_short_id && (
                      <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
                        @{c.claimer_short_id.slice(0, 4)}◆{c.claimer_short_id.slice(-4)}
                      </span>
                    )}
                  </div>
                  {/* Amount: prominent, green — time-ago muted */}
                  <div style={{
                    marginTop: 3,
                    display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap',
                  }}>
                    <span style={{
                      fontSize: 14, fontWeight: 800, color: '#22c55e', lineHeight: 1,
                    }}>
                      +{formatIusd(c.amount)}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>iUSD</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 4 }}>
                      · {timeAgo(c.claimed_at ?? '')}
                    </span>
                  </div>
                  {hasReply && (
                    <div style={{
                      marginTop: 6, padding: '6px 8px',
                      background: 'var(--bg)', borderRadius: 6,
                      border: '1px solid var(--border)',
                      fontSize: 11, color: 'var(--text)', lineHeight: 1.4,
                      display: 'flex', gap: 6, alignItems: 'flex-start',
                    }}>
                      {c.thank_emoji && <span style={{ fontSize: 14 }}>{c.thank_emoji}</span>}
                      {c.thank_message && (
                        <span style={{ flex: 1, fontStyle: 'italic', color: 'var(--text)' }}>
                          "{c.thank_message}"
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
                  padding: '2px 6px', borderRadius: 10,
                  background: hasReply ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                  color: hasReply ? '#f59e0b' : '#22c55e',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {hasReply ? t('gift.progressPanel.replied') : t('gift.progressPanel.claimedChip')}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state — no claims yet */}
      {claims.length === 0 && !isExpired && (
        <div style={{
          fontSize: 10, color: 'var(--muted)',
          background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 8, padding: '10px 12px', textAlign: 'center',
        }}>
          {t('gift.progressPanel.noClaimsYet')}
        </div>
      )}
    </div>
  )
}

// ── Received-gift preview modal ────────────────────────────────────────────
// Popup overlay that reuses the existing /gift/show page via an iframe. Loads
// in the same origin so the IK session + localStorage token carry over
// automatically. Closing the modal unmounts the iframe and stays on the
// current Gift History view — no router navigation.
// ── Styles ──────────────────────────────────────────────────────────────────

const tdLabel: React.CSSProperties = {
  color: 'var(--muted)', fontWeight: 500, paddingRight: 10, paddingBottom: 3, whiteSpace: 'nowrap', verticalAlign: 'top',
}
const tdValue: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 600, paddingBottom: 3, verticalAlign: 'top',
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 200,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
}

const sheetStyle: React.CSSProperties = {
  width: '90%', maxWidth: 380, background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 16,
  padding: '18px 20px 22px', maxHeight: '85vh', overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--muted)',
  cursor: 'pointer', padding: 4, display: 'flex',
}

const navBtnStyle: React.CSSProperties = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
  width: 36, height: 36, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1.5px solid var(--border)',
  borderRadius: 14, overflow: 'hidden',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
}


const sortBtn: React.CSSProperties = {
  padding: '7px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap',
}


const emptyMsg: React.CSSProperties = {
  textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13,
}

const inputSt: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  color: 'var(--text)', outline: 'none',
}


const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '12px', borderRadius: 10, border: 'none',
  fontSize: 14, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', cursor: 'pointer',
}


