/**
 * Gift Claim Page — immersive gift opening experience.
 *
 * Two modes:
 *   1. Claim mode (has claimKey) — PREVIEW → OPENING → REVEALED → THANKED
 *   2. Share mode (no claimKey)  — read-only "show off" view
 *
 * Features:
 * - DNA-colored ribbon + bow on gift image (sender's address hue)
 * - Sender identity display (nickname@ID-DNA)
 * - Open Gift Box → ribbon untie animation → glow reveal
 * - Thank-you letter with presets + custom input
 * - Timeline of all claimers' messages
 * - Gift image carousel with zoom viewer
 * - Description details on image corner
 * - Share button
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { API_BASE } from '../config'
import { GiftBoxImage, useCollectionLabel } from './Gift'
import { QuickLogin } from '../components/QuickLogin'
import { AuthContext, useAuthContext } from '../hooks/AuthContext'
import { upsertContactAsync, loadContacts, loadContactsAsync } from '../lib/contactsStore'
import { StyledQR } from '../components/StyledQR'
import { showToast } from '../components/Toast'
// dnaColor module available for future use

// ── Helpers ─────────────────────────────────────────────────────

function formatIusd(micro: number | null | undefined): string {
  return ((micro ?? 0) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Module-level AudioContext shared across the montage effect + handleClaim.
//
// Safari / iOS Safari require a single AudioContext *created and resumed
// during a user gesture*. Any later auto-advance via setTimeout has lost
// the gesture chain, so a fresh `new AudioContext()` inside a useEffect
// is silently blocked. Fix: create the singleton on the FIRST user
// click (the "Open Gift" button's handleClaim) and reuse it for every
// subsequent montage step.
let _claimAudioCtx: AudioContext | null = null
function getClaimAudioCtx(): AudioContext | null {
  if (_claimAudioCtx && _claimAudioCtx.state !== 'closed') return _claimAudioCtx
  return null
}
function initClaimAudioCtx(): void {
  try {
    if (!_claimAudioCtx || _claimAudioCtx.state === 'closed') {
      const Ctor: any = (window as any).AudioContext || (window as any).webkitAudioContext
      _claimAudioCtx = new Ctor()
    }
    // Resume even if already created — Safari can re-suspend across tab
    // visibility changes or power-save kicks.
    _claimAudioCtx?.resume().catch(() => {})
  } catch {}
}

function fnvHash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

// @ts-ignore — kept for potential reuse
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function privId(shortId?: string | null) {
  if (!shortId || shortId.length < 8) return shortId ?? ''
  return `${shortId.slice(0, 4)}***${shortId.slice(-4)}`
}

import i18nRaw from 'i18next'
function timeAgo(ts: string) {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return i18nRaw.t('time.justNow')
  if (diff < 3_600_000) return i18nRaw.t('time.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return i18nRaw.t('time.hoursAgo', { n: Math.floor(diff / 3_600_000) })
  return i18nRaw.t('time.daysAgo', { n: Math.floor(diff / 86_400_000) })
}




// Thank-you preset IDs — the `text` is resolved at render time via
// t(`giftClaim.thankPresets.<id>`). English source of truth lives in
// en.json to avoid duplicating strings here; other locales fall back to
// this same English via i18next default.
const THANK_PRESETS: { id: string; emoji: string }[] = [
  // Gratitude
  { id: 'thankBoss',      emoji: '🫡' },
  { id: 'appreciated',    emoji: '🙏' },
  { id: 'soKind',         emoji: '❤️' },
  // Celebration
  { id: 'madeMyDay',      emoji: '🎉' },
  { id: 'youreBest',      emoji: '🔥' },
  { id: 'whatSurprise',   emoji: '✨' },
  // Love
  { id: 'loveYou',        emoji: '💋' },
  { id: 'sweetest',       emoji: '💕' },
  { id: 'heartFull',      emoji: '🥰' },
  // Festive
  { id: 'bestBirthday',   emoji: '🎂' },
  { id: 'bestGift',       emoji: '🎄' },
  { id: 'cheersYou',      emoji: '🥂' },
]

// ── Main Component ──────────────────────────────────────────────

export default function GiftClaim() {
  const { t } = useTranslation()
  const collLabel = useCollectionLabel()
  const navigate = useNavigate()
  // Normal path (came from Inbox / History / elsewhere in the SPA): use
  // useSmartClose, which will navigate(-1) back to wherever the user was.
  //
  // Edge case: user arrived via /g/:code short link. GiftClaimShort adds
  // `?_g=1` to the URL so the flag survives the full QuickLogin →
  // /app/welcome → register → returnPath round-trip (which uses bare URLs
  // that strip location.state). Without this flag the ✕ on a freshly
  // opened share link does nothing — navigate(-1) has no target after
  // multiple `replace` hops collapse the history.
  const location = useLocation()
  const fromShortLink = new URLSearchParams(location.search).get('_g') === '1'
  const smartClose = useSmartClose('/app')
  const handleClose = () => {
    if (fromShortLink) {
      try { sessionStorage.removeItem('ipay2_return_path') } catch {}
      navigate('/app', { replace: true })
    } else {
      smartClose()
    }
  }
  const [searchParams] = useSearchParams()
  const ctx = useContext(AuthContext)
  const { status, token, address, account } = useAuthContext()

  // When GiftClaim is loaded inside an iframe (e.g. the received-gift preview
  // modal on the Gift History page), the parent provides its own close
  // chrome, so we hide our own header/branding to avoid a duplicate ✕ and
  // nested "iUSD Pay" title. Same-origin iframe → accessing window.top is safe.
  const isEmbedded = typeof window !== 'undefined' && (() => {
    try { return window.self !== window.top } catch { return true }
  })()

  if (!ctx) return null

  const packetId = useMemo(() => (searchParams.get('p') ?? '').replace(/^0x/i, '').toLowerCase(), [searchParams])
  const claimKey = useMemo(() => (searchParams.get('k') ?? '').replace(/^0x/i, '').toLowerCase(), [searchParams])
  const slotIndex = useMemo(() => {
    const raw = searchParams.get('s')
    if (raw == null) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }, [searchParams])
  const isQueueMode = slotIndex === null
  // Share view = no claim key AND current user is NOT the direct recipient.
  // For mode=0 (direct) gifts, the on-chain recipient is fixed — they can
  // claim without a claim key, so the URL without &k= is still a claim URL
  // for them (common path: clicking from inbox / notification).

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [myStatus, setMyStatus] = useState<string>('none')
  const [phase, setPhase] = useState<'preview' | 'opening' | 'opened' | 'montage' | 'revealed' | 'thanked'>('preview')
  const [showReplyBox, setShowReplyBox] = useState(false)
  const [showThankPresets, setShowThankPresets] = useState(false)
  const [montageStep, setMontageStep] = useState(0) // 0-4 for 5 pages
  const [showDesc, setShowDesc] = useState(false)
  const [showZoom, setShowZoom] = useState(false)

  // Thank you state
  const [thankSent, setThankSent] = useState(false)
  const [thankSending, setThankSending] = useState(false)
  const [customThank, setCustomThank] = useState('')
  const [showThankToast, setShowThankToast] = useState(false)

  // Reaction state (share view)
  const [reactSending, setReactSending] = useState(false)
  const [reactComment, setReactComment] = useState('')
  const [postEmoji, setPostEmoji] = useState('💬')
  const [userPickedEmoji, setUserPickedEmoji] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  // Auto-cycling emoji to catch user's attention when they haven't picked
  const CYCLE_EMOJIS = ['💬','👍','❤️','🤩','🎁','🥹','🔥','✨','🎉','🥳','🌟','🙌']
  const [cycleIdx, setCycleIdx] = useState(0)
  useEffect(() => {
    if (userPickedEmoji || showEmojiPicker) return
    const t = setInterval(() => setCycleIdx(i => (i + 1) % CYCLE_EMOJIS.length), 1400)
    return () => clearInterval(t)
  }, [userPickedEmoji, showEmojiPicker])
  const [showAllMembers, setShowAllMembers] = useState(false)
  const [addedContacts, setAddedContacts] = useState<Set<string>>(new Set())
  const [toastNick, setToastNick] = useState<string | null>(null)
  const [memberFilter, setMemberFilter] = useState<'all' | 'viewed' | 'joined'>('all')
  const [commentLimit, setCommentLimit] = useState(7)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [zoomQr, setZoomQr] = useState<{ url: string; address: string; nickname: string } | null>(null)
  // Track if this page load just finished the claim flow (for staged reveal animations)
  const [justRevealed, setJustRevealed] = useState(false)
  const [openLetterId, setOpenLetterId] = useState<string | null>(null)
  const [letterReplyText, setLetterReplyText] = useState('')
  const [letterReplyBusy, setLetterReplyBusy] = useState(false)

  function fetchPacketInfo() {
    if (!packetId) { setLoading(false); setError(t('giftClaim.errInvalidLink')); return }
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch(`${API_BASE}/gift/packet/${packetId}`, { headers })
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? t('giftClaim.errNotFound'))
        setData(d)
        if (d.myClaimStatus) setMyStatus(d.myClaimStatus)
        // Phase auto-advance is gated on `token` (authenticated session), not
        // `address` (just a connected wallet). A connected-but-unsigned visitor
        // should see the unopened preview and be prompted to sign in before
        // we reveal their prior claim state — otherwise an IK-restored address
        // plus a public claims payload would silently skip the sign-in step.
        if (token && d.myClaimStatus === 'claimed') {
          setPhase(prev => (prev === 'preview' ? 'revealed' : prev))
        }
        // Sound plays on user interaction (Open button click), not on passive page load
        if (token && d.claims && address) {
          const myClaim = d.claims.find((c: any) => c.claimer_address?.toLowerCase() === address.toLowerCase())
          if (myClaim?.thank_emoji || myClaim?.thank_message) { setThankSent(true); setPhase('thanked') }
        }
      })
      .catch((e: any) => setError(e.message ?? t('giftClaim.errNotFound')))
      .finally(() => setLoading(false))
  }

  // Fetch immediately on mount. The /gift/packet endpoint tolerates an
  // anonymous request (it just can't populate myClaimStatus), so there's
  // no reason to wait for IK session restore before painting. If the
  // token arrives later, a second effect refetches to pick up the
  // per-user fields (myClaimStatus, myAmount, myTxHash).
  const prevTokenRef = useRef(token)
  useEffect(() => {
    setLoading(true); setError(null)
    fetchPacketInfo()
    prevTokenRef.current = token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packetId])

  // Refetch when the auth token transitions (login / logout) so the
  // myClaim* fields populate without a manual reload.
  useEffect(() => {
    if (prevTokenRef.current === token) return
    prevTokenRef.current = token
    fetchPacketInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Poll when opening (fast) or viewing (slow refresh for new claims/letters)
  //   - queued/processing: 1s for instant feedback while the worker runs
  //   - otherwise: 10s for passive refresh of claims + letters
  useEffect(() => {
    if (!packetId || loading) return
    const isActive = myStatus === 'queued' || myStatus === 'processing'
    const interval = isActive ? 1000 : 10000
    const timer = setInterval(fetchPacketInfo, interval)
    return () => clearInterval(timer)
  }, [myStatus, packetId, token, loading])

  // Detect claim success → show opened box (wait for user tap to start montage)
  useEffect(() => {
    if (myStatus === 'claimed' && phase === 'opening') {
      setTimeout(() => { setPhase('opened') }, 500)
    }
  }, [myStatus])

  // User taps the opened box → montage
  function startMontage() {
    if (phase !== 'opened') return
    // Mark "just revealed" window now — the polling might race with montage-end
    // and set phase=revealed without touching this flag otherwise.
    setJustRevealed(true)
    setTimeout(() => setJustRevealed(false), 16000)
    // Play "reveal begins" chord — user tap is a valid audio gesture on Safari
    initClaimAudioCtx()
    try {
      const ctx = getClaimAudioCtx()
      if (!ctx) throw new Error('no audio ctx')
      ctx.resume().then(() => {
        const notes = [523.25, 659.25, 783.99]
        notes.forEach((freq, i) => {
          const o = ctx.createOscillator(); const g = ctx.createGain()
          o.type = 'sine'; o.frequency.value = freq
          g.gain.setValueAtTime(0, ctx.currentTime + i * 0.08)
          g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * 0.08 + 0.04)
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.45)
          o.connect(g).connect(ctx.destination)
          o.start(ctx.currentTime + i * 0.08); o.stop(ctx.currentTime + i * 0.08 + 0.45)
        })
      })
    } catch {}
    setPhase('montage'); setMontageStep(0)
  }

  // Per-step sound effect for the reveal montage. Each page gets its own
  // musical identity so the slideshow has a proper score rather than
  // silence + one final chord. Skips gracefully if AudioContext fails.
  //
  // IMPORTANT: we reuse the module-level AudioContext that handleClaim
  // created during the user's click. Safari won't let us build a fresh
  // context inside a setTimeout-triggered effect — the gesture chain is
  // broken there and the new context starts suspended with no way to
  // resume it.
  useEffect(() => {
    if (phase !== 'montage') return
    const hasMemo = !!data?.message
    // pageIdx normalizes: 0=memo, 1=name, 2=image, 3=shares, 4=amount
    const pageIdx = hasMemo ? montageStep : montageStep + 1
    try {
      const ctx = getClaimAudioCtx()
      if (!ctx) return
      ctx.resume().then(() => {
        // All sounds are kept gentle: sine/triangle only, max gain 0.05,
        // slow attack so nothing snaps. Aim: "chime", not "alert".
        const playChord = (
          notes: number[],
          type: OscillatorType = 'sine',
          gap = 0.12,
          dur = 0.85,
          vol = 0.035,
        ) => {
          notes.forEach((freq, i) => {
            const o = ctx.createOscillator()
            const g = ctx.createGain()
            o.type = type
            o.frequency.value = freq
            g.gain.setValueAtTime(0, ctx.currentTime + i * gap)
            // Slower attack (0.08s) → softer onset, no percussive snap
            g.gain.linearRampToValueAtTime(vol, ctx.currentTime + i * gap + 0.08)
            g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + i * gap + dur)
            o.connect(g).connect(ctx.destination)
            o.start(ctx.currentTime + i * gap)
            o.stop(ctx.currentTime + i * gap + dur)
          })
        }
        switch (pageIdx) {
          case 0:
            // Memo page — soft triangle arpeggio, like a handwritten flourish
            playChord([523.25, 659.25, 783.99], 'triangle', 0.16, 0.9, 0.03)
            break
          case 1:
            // Gift name — warm sine bell (perfect fifth + octave)
            playChord([440.00, 659.25, 880.00], 'sine', 0.10, 1.0, 0.035)
            break
          case 2:
            // Image reveal — sparkly ascending triangle arpeggio
            playChord([783.99, 987.77, 1174.66, 1318.51], 'triangle', 0.08, 0.7, 0.03)
            break
          case 3:
            // Shares — gentle rising triad (no square, no march)
            playChord([523.25, 659.25, 783.99], 'sine', 0.13, 0.75, 0.03)
            break
          case 4:
            // Amount — warm fanfare. Softer than before, sine only.
            playChord([523.25, 659.25, 783.99, 1046.50], 'sine', 0.13, 0.9, 0.04)
            // Sparkle shimmer tail — lower gain, shorter
            setTimeout(() => {
              const o = ctx.createOscillator()
              const g = ctx.createGain()
              o.type = 'triangle'
              o.frequency.setValueAtTime(2000, ctx.currentTime)
              o.frequency.exponentialRampToValueAtTime(3600, ctx.currentTime + 0.2)
              g.gain.setValueAtTime(0, ctx.currentTime)
              g.gain.linearRampToValueAtTime(0.022, ctx.currentTime + 0.05)
              g.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.4)
              o.connect(g).connect(ctx.destination)
              o.start(); o.stop(ctx.currentTime + 0.4)
            }, 650)
            break
        }
      })
    } catch {}
  }, [phase, montageStep, data?.message])

  // Montage auto-advance: 2s per page, then → revealed
  useEffect(() => {
    if (phase !== 'montage') return
    // Determine actual pages (skip memo page if no memo)
    const hasMemo = !!data?.message
    const totalPages = hasMemo ? 5 : 4
    if (montageStep >= totalPages) {
      setPhase('revealed')
      setJustRevealed(true)
      // After all stages (~4s worth of staged fade-ins), mark as settled
      setTimeout(() => setJustRevealed(false), 6000)
      return
    }
    const timer = setTimeout(() => setMontageStep(s => s + 1), 2000)
    return () => clearTimeout(timer)
  }, [phase, montageStep, data?.message])

  // Hydrate the "already added" set from existing contacts so the ✓ marks
  // persist across refreshes. Try cached synchronous read first, then server.
  useEffect(() => {
    if (!address) return
    try {
      const cached = loadContacts(address) ?? []
      if (cached.length > 0) {
        setAddedContacts(new Set(cached.map((c: any) => c.shortId).filter(Boolean)))
      }
    } catch {}
    if (token) {
      loadContactsAsync(address, token).then((list: any[]) => {
        setAddedContacts(new Set((list ?? []).map((c: any) => c.shortId).filter(Boolean)))
      }).catch(() => {})
    }
  }, [address, token])

  async function addContact(shortId: string | null | undefined, nickname: string | null | undefined) {
    if (!shortId) return
    if (addedContacts.has(shortId)) return
    // Guard: must be signed in to save contacts to server
    if (!address || !token) {
      setToastNick(t('giftClaim.signInToSave'))
      setTimeout(() => setToastNick(null), 2200)
      return
    }
    try {
      // Await actual server call so ✓ and toast only show on success
      await upsertContactAsync(address, token, { shortId, nickname: nickname ?? undefined })
      setAddedContacts(prev => { const n = new Set(prev); n.add(shortId); return n })
      setToastNick(`${nickname ?? shortId} added to Contacts`)
      setTimeout(() => setToastNick(null), 1800)
    } catch {
      setToastNick(t('giftClaim.failedSaveContact'))
      setTimeout(() => setToastNick(null), 2200)
    }
  }

  async function handleClaim() {
    if (!packetId) { setError(t('giftClaim.errInvalidLink')); return }
    if (!token) { setError(t('giftClaim.errSignInFirst')); return }
    // FIRST thing in the click handler: unlock the shared AudioContext.
    // This is the user-gesture anchor — every subsequent setTimeout-driven
    // sound (montage pages) reuses this same context so Safari keeps
    // playing them.
    initClaimAudioCtx()
    // Play opening chime
    try {
      const ctx = getClaimAudioCtx()
      if (!ctx) throw new Error('no audio ctx')
      ctx.resume().then(() => {
        [659.25, 783.99].forEach((freq, i) => {
          const o = ctx.createOscillator(); const g = ctx.createGain()
          o.type = 'sine'; o.frequency.value = freq
          g.gain.setValueAtTime(0, ctx.currentTime + i * 0.15)
          g.gain.linearRampToValueAtTime(0.1, ctx.currentTime + i * 0.15 + 0.05)
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4)
          o.connect(g).connect(ctx.destination)
          o.start(ctx.currentTime + i * 0.15); o.stop(ctx.currentTime + i * 0.15 + 0.4)
        })
      })
    } catch {}
    const isDirect = data?.packet?.mode === 0
    if (!isDirect && !claimKey) { setError(t('giftClaim.errInvalidClaimLink')); return }

    setPhase('opening')
    setClaiming(true); setError(null)
    try {
      if (isDirect) {
        const res = await fetch(`${API_BASE}/gift/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error ?? 'Claim failed')
        if (d.status === 'claimed') { setMyStatus('claimed') }
        else setMyStatus(d.status || 'queued')
      } else if (isQueueMode) {
        const res = await fetch(`${API_BASE}/gift/claim-queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId, claimKey }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error ?? 'Claim failed')
        if (d.status === 'claimed') { setMyStatus('claimed') }
        else setMyStatus(d.status)
      } else {
        const res = await fetch(`${API_BASE}/gift/claim-slot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId, slotIndex, claimKey }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error ?? d.detail ?? 'Claim failed')
        if (d.status === 'claimed') { setMyStatus('claimed') }
        else setMyStatus(d.status || 'queued')
      }
    } catch (e: any) { setError(e.message ?? 'Claim failed'); setPhase('preview') }
    finally { setClaiming(false) }
  }

  async function sendThank(emoji: string, message: string) {
    if (!token || !packetId || thankSent) return
    setThankSending(true)
    try {
      const res = await fetch(`${API_BASE}/gift/thank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packetId, emoji, message }),
      })
      if (res.ok) {
        setThankSent(true); setPhase('thanked'); fetchPacketInfo()
        setShowReplyBox(false)
        setShowThankToast(true)
        setTimeout(() => setShowThankToast(false), 2500)
      }
      else { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Failed') }
    } catch (e: any) { setError(e.message ?? 'Failed') }
    finally { setThankSending(false) }
  }

  // goSignIn no longer needed — QuickLogin handles all login flows

  async function sendReaction(reaction: string, comment?: string) {
    if (!token || !packetId) return
    setReactSending(true)
    try {
      if (comment && comment.trim()) {
        // Text comment → /gift/comment (unlimited)
        await fetch(`${API_BASE}/gift/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId, content: comment.trim() }),
        })
        setReactComment('')
        fetchComments()
      } else {
        // Emoji-only reaction → /gift/react (upsert, one per user)
        await fetch(`${API_BASE}/gift/react`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packetId, reaction }),
        })
      }
      fetchPacketInfo()
    } catch {}
    finally { setReactSending(false) }
  }

  // Fetch threaded comments from /gift/packet/:id/comments
  const [comments, setComments] = useState<any[]>([])
  async function fetchComments() {
    if (!packetId) return
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const r = await fetch(`${API_BASE}/gift/packet/${packetId}/comments`, { headers })
      const d = await r.json()
      setComments(d.comments ?? [])
    } catch {}
  }
  useEffect(() => { if (packetId) fetchComments() }, [packetId, token])

  // ── Derived ───────────────────────────────────────────────────

  const sender = data?.sender
  const box = data?.box
  const totalShares = Number(data?.totalShares ?? data?.packet?.total_slots ?? 0)
  const claimedCount = Number(data?.claimedCount ?? data?.packet?.claimed_slots ?? 0)
  const queuedCount = Number(data?.queuedCount ?? 0)
  const processingCount = Number(data?.processingCount ?? 0)
  const remainingShares = totalShares - claimedCount - queuedCount - processingCount
  const isQueued = myStatus === 'queued' || myStatus === 'processing'
  const alreadyClaimed = myStatus === 'claimed'
  const allGone = remainingShares <= 0 && !alreadyClaimed && !isQueued && processingCount === 0 && queuedCount === 0
  const claims = data?.claims ?? []
  // Compute share-view now that `data` + `address` are known.
  const isShareView = useMemo(() => {
    if (claimKey) return false
    // Direct-mode recipient claiming from inbox — no key needed
    const mode = data?.packet?.mode
    const recipient = (data?.packet?.recipient_address ?? data?.packet?.recipient ?? '').toLowerCase()
    if (mode === 0 && address && recipient && recipient === address.toLowerCase()) return false
    return true
  }, [claimKey, data?.packet?.mode, data?.packet?.recipient_address, data?.packet?.recipient, address])

  // For share view: find the first reply with a thank message
  const lettersOnly = claims.filter((c: any) => c.thank_emoji || c.thank_message)

  // Deduplicated member lists (shared across stats row + pills collection).
  // Dedupe by BOTH shortId and nickname so same person/same-name collapses once.
  type Member = { nick: string; sid: string | null; hue: number; kind: 'claimer' | 'viewer' }
  const { dedupedClaimers, dedupedViewers } = useMemo(() => {
    const cs: Member[] = []
    const vs: Member[] = []
    const seenSid = new Set<string>()
    const seenNick = new Set<string>()
    const addIfUnique = (list: Member[], sid: string | null, nick: string | null | undefined, kind: 'claimer' | 'viewer') => {
      const s = (sid ?? '').toUpperCase()
      const n = (nick ?? '').toLowerCase().trim()
      if (!s && !n) return
      if ((s && seenSid.has(s)) || (n && seenNick.has(n))) return
      if (s) seenSid.add(s)
      if (n) seenNick.add(n)
      list.push({
        nick: nick ?? t('gift.progressPanel.anon'),
        sid: sid ?? null,
        hue: sid ? fnvHash(sid) % 360 : 180,
        kind,
      })
    }
    for (const c of (data?.claims ?? [])) {
      addIfUnique(cs, c.claimer_short_id, c.claimer_nickname, 'claimer')
    }
    for (const v of (data?.viewers ?? [])) {
      addIfUnique(vs, v.viewer_short_id, v.viewer_nickname, 'viewer')
    }
    return { dedupedClaimers: cs, dedupedViewers: vs }
  }, [data?.claims, data?.viewers])
  const reactions = data?.reactions ?? []
  const memoFont = data?.memoFont as string | null

  // Load Google Font for memo
  useEffect(() => {
    if (!memoFont) return
    const id = `gfont-${memoFont.replace(/\s/g, '-')}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(memoFont)}&display=swap`
    document.head.appendChild(link)
  }, [memoFont])

  // Auto-load-more: observe the sentinel at the bottom of the comments list.
  // When it enters the viewport (50px margin), bump the limit by 10.
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) {
        setCommentLimit(n => n + 10)
      }
    }, { rootMargin: '50px' })
    io.observe(el)
    return () => io.disconnect()
  }, [commentLimit, comments.length])

  // Removed the global first-interaction chime — it played on ANY click
  // (including unrelated scroll taps) and fired the "sad boop" on already-
  // claimed gifts. Sounds now only play on explicit actions:
  //   - Open button → handleClaim plays opening chime
  //   - Tap-to-reveal → startMontage plays ascending chord
  //   - Montage completion → celebration chord
  // Claim view no longer pre-registers any click listener.

  // DNA colors
  const senderAddr = sender?.address ?? ''
  const dnaHue = senderAddr ? fnvHash(senderAddr.toLowerCase()) % 360 : 200
  const rc = `hsl(${dnaHue}, 65%, 45%)`
  const rl = `hsl(${dnaHue}, 70%, 58%)`

  const images = box?.imageUrls ?? []
  const [imgIdx, setImgIdx] = useState(0)
  useEffect(() => {
    if (images.length <= 1) return
    const t = setInterval(() => setImgIdx(i => (i + 1) % images.length), 4000)
    return () => clearInterval(t)
  }, [images.length])

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <style>{`
        @keyframes ribbonUntie { 0%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.2)} 100%{opacity:0;transform:scale(1.5) translateY(-20px)} }
        @keyframes glowPulse { 0%{box-shadow:0 0 0 rgba(255,215,0,0)} 50%{box-shadow:0 0 40px rgba(255,215,0,0.4)} 100%{box-shadow:0 0 0 rgba(255,215,0,0)} }
        @keyframes revealAmount { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      <div style={{
        width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 18, overflow: 'hidden', color: 'var(--text)',
      }}>
        {/* DNA top bar + logo + close */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${rc}, ${rl}, ${rc})` }} />
        {/* Header is hidden when embedded in an iframe (e.g. the Gift History
            received-gift preview modal supplies its own close chrome, so we
            avoid a double "✕" and the duplicate iUSD branding). */}
        {!isEmbedded && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <img src="/images/iusd.png?v=20260414" alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text)' }}>
                iUSD <span style={{ fontWeight: 400 }}>Pay</span>
              </span>
            </div>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}
              title="Close">✕</button>
          </div>
        )}

        {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{t('giftClaim.loading')}</div>}

        {!loading && error && !data && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>
            <button onClick={handleClose} style={{ ...btnSt, marginTop: 16, width: 'auto', padding: '8px 24px' }}>{t('giftClaim.goHome')}</button>
          </div>
        )}

        {!loading && data && isShareView && (
          /* ════════════════════════════════════════════════════════════
           *  SHARE VIEW — "showing off" / celebrating the gift
           * ════════════════════════════════════════════════════════════ */
          <>
            {/* ── Total (large, above image) + Gift photo frame ─────── */}
            <div style={{ padding: '16px 20px 0' }}>
              {/* I GOT (left) + TOTAL (right) — two equal-height columns above the image */}
              {(() => {
                // Pick the claim to show: latest claim (hero) or the first one
                const heroClaim = lettersOnly[0] ?? (data?.claims ?? [])[0]
                const gotAmount = heroClaim?.amount ?? box?.amount ?? data?.packet?.amount
                const totalAmount = box?.amount ?? data?.packet?.amount
                return (
                  <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'flex-start' }}>
                    {/* I GOT — left */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, color: rc, letterSpacing: '0.14em',
                                    textTransform: 'uppercase', fontWeight: 900 }}>
                        {t('giftClaim.iGotLabel')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 30, fontWeight: 900, color: '#22c55e', lineHeight: 1,
                                       textShadow: '0 2px 10px rgba(34,197,94,0.25)' }}>
                          {formatIusd(gotAmount)}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>iUSD</span>
                      </div>
                      {heroClaim?.claimer_nickname && totalShares > 1 && (
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, fontStyle: 'italic' }}>
                          — {heroClaim.claimer_nickname}
                        </div>
                      )}
                    </div>
                    {/* TOTAL — right */}
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.12em',
                                    textTransform: 'uppercase', fontWeight: 700 }}>{t('gift.total')}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2, justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                          {formatIusd(totalAmount)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>iUSD</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                        {totalShares > 1 ? t('giftClaim.sharesCountLabel', { count: totalShares }) : t('giftClaim.onlyOneShare')}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Gift photo frame — no border, cover-fit (matches gallery) */}
              <div style={{
                position: 'relative', width: '100%', aspectRatio: '1/1',
                borderRadius: 14, overflow: 'hidden',
                background: 'var(--bg)',
                cursor: 'pointer',
              }} onClick={() => setShowZoom(true)}>
                {images.length > 0 && (
                  <img src={images[imgIdx]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                {/* Signature overlay — only on first image, deterministic position per sender.
                    Emojis stripped so it reads as a proper celebrity inscription. */}
                {imgIdx === 0 && (() => {
                  // Strip emoji from memo (all Unicode emoji blocks + variation selectors)
                  const cleanMessage = (data?.message ?? '')
                    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                  // Deterministic corner + angle per sender (4 slots × 3 slight rotations)
                  const posSeed = fnvHash((senderAddr || sender?.shortId || 'x') + 'sig')
                  const slot = posSeed % 4
                  const angleIdx = (posSeed >> 3) % 5
                  const tiltDeg = ([-3, -1.5, 0, 1.5, 3] as const)[angleIdx]
                  // 4 corner slots: TL / TR / BL / BR
                  const slotStyles = [
                    { top: 18, left: 18, right: 'auto' as const, bottom: 'auto' as const, textAlign: 'left' as const },
                    { top: 18, right: 18, left: 'auto' as const, bottom: 'auto' as const, textAlign: 'right' as const },
                    { bottom: 60, left: 18, right: 'auto' as const, top: 'auto' as const, textAlign: 'left' as const },
                    { bottom: 60, right: 18, left: 'auto' as const, top: 'auto' as const, textAlign: 'right' as const },
                  ]
                  const slotStyle = slotStyles[slot]
                  return (
                    <div style={{
                      position: 'absolute',
                      ...slotStyle,
                      maxWidth: '75%',
                      pointerEvents: 'none',
                      fontFamily: memoFont ? `'${memoFont}', cursive` : '"Brush Script MT", "Comic Sans MS", cursive',
                      textShadow: '0 2px 8px rgba(0,0,0,0.75)',
                      transform: `rotate(${tiltDeg}deg)`,
                      transformOrigin: slotStyle.textAlign === 'right' ? 'right center' : 'left center',
                    }}>
                      <div style={{
                        fontSize: memoFont ? 22 : 20,
                        lineHeight: 1.1,
                        color: '#FFD700',
                        fontWeight: 700,
                      }}>
                        {t('giftClaim.fromSenderOverlay', { name: sender?.nickname ?? t('gift.someone') })}
                      </div>
                      {cleanMessage && (
                        <div style={{
                          fontSize: memoFont ? 18 : 16,
                          color: '#fff',
                          fontWeight: 600,
                          lineHeight: 1.3,
                          marginTop: 6,
                          pointerEvents: 'auto',
                        }} onClick={e => { e.stopPropagation(); addContact(sender?.shortId, sender?.nickname) }}>
                          {cleanMessage}
                        </div>
                      )}
                    </div>
                  )
                })()}
                {/* Image carousel dots */}
                {images.length > 1 && (
                  <div style={{
                    position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', gap: 4,
                  }}>
                    {images.map((_: any, i: number) => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: i === imgIdx ? '#fff' : 'rgba(255,255,255,0.4)',
                      }} />
                    ))}
                  </div>
                )}
                {/* Zoom button — bottom-right (above stats strip) */}
                <button onClick={(e) => { e.stopPropagation(); setShowZoom(true) }} style={{
                  position: 'absolute', top: 12, right: 12, width: 28, height: 28,
                  borderRadius: '50%', background: 'rgba(0,0,0,0.45)', border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </button>
                {/* Details button — above stats strip */}
                {box?.description && (
                  <button onClick={(e) => { e.stopPropagation(); setShowDesc(true) }} style={{
                    position: 'absolute', bottom: 10, right: 10, padding: '3px 8px',
                    borderRadius: 6, background: 'rgba(0,0,0,0.5)', border: 'none',
                    cursor: 'pointer', fontSize: 9, color: '#fff', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 3,
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    {t('giftClaim.detailsBtn')}
                  </button>
                )}
              </div>

              {/* Gift title — directly below image, own line, left-aligned */}
              {box?.name && (
                <div style={{
                  marginTop: 10, fontSize: 14, fontWeight: 700, color: 'var(--text)',
                  lineHeight: 1.3, textAlign: 'left',
                }}>
                  {t(`giftBox.${(box as any).id ?? (box as any).box_id}.name`, { defaultValue: box.name })}
                </div>
              )}

              {/* Stats row — below title, outside image */}
              <div style={{
                marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                fontSize: 11, color: 'var(--muted)',
              }}>
                <span><b style={{ color: 'var(--text)' }}>{claimedCount}/{totalShares}</b> {t('giftClaim.claimedLabel')}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <button onClick={() => setMemberFilter(memberFilter === 'viewed' ? 'all' : 'viewed')}
                  style={{
                    background: memberFilter === 'viewed' ? `hsla(${dnaHue},50%,50%,0.15)` : 'transparent',
                    border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 11,
                    padding: '3px 10px', borderRadius: 10, fontWeight: 500,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  {dedupedViewers.length} {t('giftClaim.viewedLabel')}
                </button>
                <span style={{ opacity: 0.4 }}>·</span>
                <button onClick={() => setMemberFilter(memberFilter === 'joined' ? 'all' : 'joined')}
                  style={{
                    background: memberFilter === 'joined' ? 'rgba(34,197,94,0.15)' : 'transparent',
                    border: 'none', color: '#22c55e', cursor: 'pointer', fontSize: 11,
                    padding: '3px 10px', borderRadius: 10, fontWeight: 500,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  {dedupedClaimers.length} {t('giftClaim.chasedLabel')}
                </button>
              </div>
            </div>

            {/* ── Members collection — a, b, c, …, last [more] format ── */}
            {(() => {
              // Apply filter (uses hoisted dedupedClaimers/dedupedViewers above)
              const members: Member[] =
                memberFilter === 'viewed' ? dedupedViewers
                : memberFilter === 'joined' ? dedupedClaimers
                : [...dedupedClaimers, ...dedupedViewers]
              if (members.length === 0) return null
              // Show a, b, c, ..., last [more]
              const SHOW_LIMIT = 5
              let display: (Member | '…')[] = []
              if (members.length <= SHOW_LIMIT) {
                display = members
              } else {
                // first N-1, then …, then last one
                display = [...members.slice(0, SHOW_LIMIT - 1), '…', members[members.length - 1]]
              }
              const hasMore = members.length > SHOW_LIMIT

              const labelStyle = (m: Member) => ({
                display: 'inline-flex', alignItems: 'center',
                padding: '4px 10px', borderRadius: 12, fontSize: 11,
                background: `hsla(${m.hue}, 50%, 50%, 0.1)`,
                color: `hsl(${m.hue}, 45%, 45%)`,
                border: `1px solid hsla(${m.hue}, 50%, 50%, 0.2)`,
                fontWeight: 500, whiteSpace: 'nowrap' as const,
                cursor: m.sid ? 'pointer' : 'default' as const,
              })

              return (
                <div style={{ padding: '10px 20px 0' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                    {display.map((m, i) =>
                      m === '…' ? (
                        <span key={`dots-${i}`} style={{ color: 'var(--muted)', fontSize: 12, padding: '0 4px' }}>…</span>
                      ) : (
                        <span key={i} onClick={() => addContact(m.sid, m.nick)} style={labelStyle(m)}>
                          {m.nick}
                          {m.sid && addedContacts.has(m.sid) && <span style={{ marginLeft: 3, color: '#22c55e' }}>✓</span>}
                        </span>
                      )
                    )}
                    {hasMore && (
                      <button onClick={() => setShowAllMembers(true)} style={{
                        padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        color: 'var(--muted)', cursor: 'pointer',
                      }}>
                        {t('giftClaim.moreBtn')}
                      </button>
                    )}
                  </div>
                  {/* Modal with all members */}
                  {showAllMembers && (
                    <div onClick={() => setShowAllMembers(false)} style={{
                      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
                    }}>
                      <div onClick={e => e.stopPropagation()} style={{
                        background: 'var(--surface)', borderRadius: 14, padding: 20,
                        maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto',
                        border: '1px solid var(--border)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--muted)' }}>
                            {t('giftClaim.membersHeader', { count: members.length })}
                          </div>
                          <button onClick={() => setShowAllMembers(false)} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--muted)', fontSize: 18,
                          }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {members.map((m, i) => (
                            <span key={i} onClick={() => addContact(m.sid, m.nick)} style={labelStyle(m)}>
                              {m.nick}
                              {m.sid && addedContacts.has(m.sid) && <span style={{ marginLeft: 3, color: '#22c55e' }}>✓</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Tip the claimer — profile QR card, placed above Letters */}
            {(() => {
              const hero = lettersOnly[0] ?? (data?.claims ?? [])[0]
              if (!hero?.claimer_short_id) return null
              const heroHue = fnvHash(hero.claimer_short_id) % 360
              const heroColor = `hsl(${heroHue}, 65%, 45%)`
              const profileUrl = `${window.location.origin}/profile/${hero.claimer_short_id}`
              return (
                <div style={{ padding: '14px 20px 6px' }}>
                  <div style={{
                    background: `linear-gradient(135deg, hsla(${heroHue},55%,55%,0.08), hsla(${heroHue},55%,35%,0.12))`,
                    border: `1px solid hsla(${heroHue},55%,50%,0.22)`,
                    borderRadius: 14, padding: '14px 16px',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <div onClick={() => setZoomQr({ url: profileUrl, address: hero.claimer_address, nickname: hero.claimer_nickname ?? 'them' })}
                      style={{
                        background: '#fff', borderRadius: 10, padding: 6,
                        boxShadow: `0 4px 16px hsla(${heroHue},55%,40%,0.3)`, flexShrink: 0,
                        cursor: 'zoom-in', position: 'relative',
                      }}>
                      <StyledQR url={profileUrl} address={hero.claimer_address} size={96} theme="light" />
                      <div style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.55)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                                    textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                        {t('giftClaim.loveWhatYouSee')}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                        <span onClick={() => addContact(hero.claimer_short_id, hero.claimer_nickname)}
                          style={{ color: heroColor, cursor: 'pointer' }}>
                          {t('giftClaim.giftThemLine', { name: hero.claimer_nickname ?? t('giftClaim.anonName') })}
                          {addedContacts.has(hero.claimer_short_id) && <span style={{ marginLeft: 3, color: '#22c55e' }}>✓</span>}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                        {t('giftClaim.scanOr')}{' '}
                        <a href={profileUrl}
                           onClick={(e) => { e.preventDefault(); navigate(`/profile/${hero.claimer_short_id}`) }}
                           style={{
                             color: heroColor, fontWeight: 700, textDecoration: 'underline',
                             cursor: 'pointer',
                           }}>
                          {t('giftClaim.scanOrOpenProfile')}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* ── Letters timeline — click to reply inline ─────── */}
            {lettersOnly.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: 10 }}>
                  {t('giftClaim.lettersHeader', { count: lettersOnly.length })}
                </div>
                <style>{`@keyframes letterSlideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }`}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lettersOnly.map((c: any, i: number) => {
                    const cHue = c.claimer_short_id ? fnvHash(c.claimer_short_id) % 360
                               : c.claimer_nickname ? fnvHash(c.claimer_nickname) % 360 : 180
                    const letterId = c.claimer_address ?? c.slot_index ?? `${i}`
                    const isOpen = openLetterId === letterId
                    return (
                      <div key={i} style={{
                        background: 'var(--surface)', border: `1px solid ${isOpen ? `hsl(${cHue},50%,50%)` : 'var(--border)'}`,
                        borderRadius: 12, padding: '10px 12px',
                        animation: `letterSlideIn 0.3s ease-out ${i * 0.05}s both`,
                        transition: 'border-color 0.2s',
                      }}>
                        <div onClick={() => { setOpenLetterId(isOpen ? null : letterId); setLetterReplyText('') }}
                             style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                          <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            background: `linear-gradient(135deg, hsl(${cHue},50%,55%), hsl(${cHue},50%,40%))`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14, color: '#fff',
                          }}>{c.thank_emoji || '💌'}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                              <span onClick={(e) => { e.stopPropagation(); addContact(c.claimer_short_id, c.claimer_nickname) }}
                                style={{ fontSize: 11, fontWeight: 600, color: `hsl(${cHue},45%,45%)`, cursor: c.claimer_short_id ? 'pointer' : 'default' }}>
                                {c.claimer_nickname ?? t('gift.anonymous')}
                                {c.claimer_short_id && addedContacts.has(c.claimer_short_id) && <span style={{ marginLeft: 3, color: '#22c55e' }}>✓</span>}
                              </span>
                              {c.amount != null && (
                                <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 600, background: 'rgba(34,197,94,0.08)', padding: '1px 6px', borderRadius: 8 }}>
                                  +{formatIusd(c.amount)} iUSD
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.thank_message}</div>
                            {c.claimed_at && <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>{timeAgo(c.claimed_at)}</div>}
                          </div>
                        </div>
                        {/* Inline reply form */}
                        {isOpen && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)',
                                        display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                            <input value={letterReplyText}
                              onChange={e => setLetterReplyText(e.target.value.slice(0, 120))}
                              placeholder={t('giftClaim.replyToPlaceholder', { name: c.claimer_nickname ?? t('giftClaim.anonName') })}
                              autoFocus
                              style={{
                                flex: 1, padding: '8px 10px', borderRadius: 8,
                                border: '1px solid var(--border)', background: 'var(--bg)',
                                color: 'var(--text)', fontSize: 12, outline: 'none',
                              }} />
                            <button onClick={async () => {
                              const text = letterReplyText.trim()
                              if (!text || !token) return
                              setLetterReplyBusy(true)
                              try {
                                await fetch(`${API_BASE}/gift/comment`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ packetId, content: `@${c.claimer_nickname ?? 'them'}: ${text}` }),
                                })
                                setLetterReplyText('')
                                setOpenLetterId(null)
                                fetchPacketInfo()
                              } catch {}
                              setLetterReplyBusy(false)
                            }}
                              disabled={!letterReplyText.trim() || letterReplyBusy || !token}
                              style={{
                                padding: '8px 14px', borderRadius: 8, border: 'none',
                                fontSize: 11, fontWeight: 700,
                                background: `hsl(${cHue},50%,48%)`, color: '#fff',
                                cursor: letterReplyText.trim() && token ? 'pointer' : 'not-allowed',
                                opacity: letterReplyText.trim() && token ? 1 : 0.4,
                              }}>
                              {letterReplyBusy ? '…' : t('giftClaim.replyBtn')}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Single unified reactions + comment area ────── */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px 4px' }}>
              <style>{`
                @keyframes emojiBounce { 0%{transform:scale(1)} 50%{transform:scale(1.3)} 100%{transform:scale(1)} }
                @keyframes emojiCycle {
                  0%   { opacity: 0; transform: scale(0.6) rotate(-30deg); }
                  25%  { opacity: 1; transform: scale(1.15) rotate(0deg); }
                  75%  { opacity: 1; transform: scale(1.15) rotate(0deg); }
                  100% { opacity: 0; transform: scale(0.6) rotate(30deg); }
                }
                @keyframes emojiHalo {
                  0%,100% { box-shadow: 0 0 0 0 hsla(var(--dh), 70%, 60%, 0.5),
                                        0 0 16px hsla(var(--dh), 80%, 65%, 0.45); }
                  50%     { box-shadow: 0 0 0 6px hsla(var(--dh), 70%, 60%, 0),
                                        0 0 28px hsla(var(--dh), 90%, 70%, 0.9); }
                }
                @keyframes emojiSheen {
                  0%   { transform: translateX(-120%) rotate(25deg); }
                  100% { transform: translateX(120%) rotate(25deg); }
                }
              `}</style>
              {token ? (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                              borderRadius: 10, padding: '8px 10px', position: 'relative' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Emoji avatar — auto-cycles until user picks, click to open picker */}
                    <button onClick={() => setShowEmojiPicker(v => !v)}
                      style={{
                        ['--dh' as any]: `${dnaHue}`,
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        background: `linear-gradient(135deg, hsl(${dnaHue},60%,60%), hsl(${dnaHue},60%,40%))`,
                        border: 'none', cursor: 'pointer', fontSize: 20, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative', overflow: 'hidden',
                        animation: userPickedEmoji ? undefined : 'emojiHalo 1.8s ease-in-out infinite',
                      } as React.CSSProperties}>
                      {/* Cycling emoji swap */}
                      {userPickedEmoji ? (
                        <span>{postEmoji}</span>
                      ) : (
                        <span key={cycleIdx}
                          style={{ animation: 'emojiCycle 1.4s ease-in-out both', display: 'inline-block' }}>
                          {CYCLE_EMOJIS[cycleIdx]}
                        </span>
                      )}
                      {/* Sheen — diagonal white highlight sweep */}
                      {!userPickedEmoji && (
                        <span style={{
                          position: 'absolute', top: 0, left: 0, width: '60%', height: '100%',
                          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
                          animation: 'emojiSheen 2.2s ease-in-out infinite',
                          pointerEvents: 'none',
                        }} />
                      )}
                    </button>
                    {/* Text input */}
                    {(() => {
                      // If user hasn't picked, use the currently cycling emoji as the "active" one
                      const activeEmoji = userPickedEmoji ? postEmoji : CYCLE_EMOJIS[cycleIdx]
                      const canPost = !!reactComment.trim() || userPickedEmoji
                      const doPost = () => {
                        if (!canPost) return
                        const body = reactComment.trim() ? `${activeEmoji} ${reactComment.trim()}` : activeEmoji
                        sendReaction('💬', body)
                        setPostEmoji('💬')
                        setUserPickedEmoji(false)
                      }
                      return (
                        <>
                          <input value={reactComment}
                            onChange={e => setReactComment(e.target.value.slice(0, 100))}
                            placeholder={t('giftClaim.postToPlaceholder', { name: sender?.nickname ?? t('gift.someone') })}
                            onKeyDown={e => { if (e.key === 'Enter') doPost() }}
                            style={{
                              flex: 1, padding: '6px 0', border: 'none', background: 'transparent',
                              color: 'var(--text)', fontSize: 13, outline: 'none',
                            }} />
                          <button onClick={doPost} disabled={!canPost || reactSending}
                            style={{
                              padding: '8px 16px', borderRadius: 8, border: 'none',
                              fontSize: 11, fontWeight: 700,
                              background: rc, color: '#fff',
                              cursor: canPost ? 'pointer' : 'not-allowed',
                              opacity: canPost ? 1 : 0.35,
                            }}>
                            {t('giftClaim.postBtn')}
                          </button>
                        </>
                      )
                    })()}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'right', marginTop: 4 }}>
                    {reactComment.length}/100
                  </div>
                  {/* Emoji picker popover */}
                  {showEmojiPicker && (
                    <>
                      <div onClick={() => setShowEmojiPicker(false)}
                        style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                      <div style={{
                        position: 'absolute', bottom: '100%', left: 0, zIndex: 50, marginBottom: 6,
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)', padding: 8,
                        display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, maxWidth: 300,
                      }}>
                        {['💬','👍','❤️','🤩','🎁','🥹','🔥','✨','🎉','😂','😍','🙌','👏','💯','🚀','🥳',
                          '😎','🤗','💖','🌟','🎊','💝','🌹','🍀','🫶','🥰','😊','🙏','💐','☀️','🎂','🎈']
                          .map(ej => (
                          <button key={ej} onClick={() => { setPostEmoji(ej); setUserPickedEmoji(true); setShowEmojiPicker(false) }}
                            style={{
                              width: 32, height: 32, borderRadius: 6, border: 'none',
                              background: postEmoji === ej ? 'var(--bg-elevated)' : 'transparent',
                              cursor: 'pointer', fontSize: 18,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                            {ej}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <QuickLogin actionLabel="Leave a message" accentColor={rc} />
              )}

              {/* Merged reactions + comments list, sorted by time */}
              {(() => {
                // Extract leading emoji + rest-of-text from content like "🎁 nice gift"
                const splitEmojiBody = (content: string | null | undefined): [string, string] => {
                  if (!content) return ['💬', '']
                  const trimmed = content.trim()
                  const sp = trimmed.indexOf(' ')
                  if (sp === -1) return [trimmed, ''] // emoji-only
                  const head = trimmed.slice(0, sp)
                  const rest = trimmed.slice(sp + 1)
                  // Heuristic: if head is short (≤4 chars) and not ASCII, treat as emoji
                  const isShortNonAscii = head.length <= 4 && /[^\x00-\x7F]/.test(head)
                  if (isShortNonAscii) return [head, rest]
                  return ['💬', trimmed]
                }
                const reactionItems = (reactions ?? []).map((r: any) => ({
                  kind: 'r' as const,
                  key: `r-${r.id ?? r.reactor_address}`,
                  nick: r.reactor_nickname ?? t('gift.progressPanel.anon'),
                  sid: r.reactor_short_id as string | null,
                  emoji: r.reaction || '💬',
                  body: r.comment,
                  at: r.created_at,
                }))
                const commentItems = (comments ?? []).map((c: any) => {
                  const [ej, body] = splitEmojiBody(c.content)
                  return {
                    kind: 'c' as const,
                    key: `c-${c.id}`,
                    nick: c.author_nickname ?? 'Anon',
                    sid: c.author_short_id as string | null,
                    emoji: ej,
                    body,
                    at: c.created_at,
                  }
                })
                const merged = [...reactionItems, ...commentItems]
                  .filter(x => x.body || x.emoji)
                  .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
                if (merged.length === 0) return null
                const shown = merged.slice(0, commentLimit)
                const hasMore = merged.length > commentLimit
                return (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {shown.map(m => {
                      const hue = m.sid ? fnvHash(m.sid) % 360 : 180
                      return (
                        <div key={m.key} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                          padding: '8px 10px', borderRadius: 10,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                        }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                            background: `linear-gradient(135deg, hsl(${hue},50%,55%), hsl(${hue},50%,40%))`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, color: '#fff',
                          }}>{m.emoji}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span onClick={() => addContact(m.sid, m.nick)}
                                style={{ fontSize: 11, fontWeight: 600, color: `hsl(${hue}, 45%, 45%)`, cursor: m.sid ? 'pointer' : 'default' }}>
                                {m.nick}
                                {m.sid && addedContacts.has(m.sid) && <span style={{ marginLeft: 3, color: '#22c55e' }}>✓</span>}
                              </span>
                              <span style={{ fontSize: 8, color: 'var(--muted)' }}>{timeAgo(m.at)}</span>
                            </div>
                            {m.body && <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 2, lineHeight: 1.4 }}>{m.body}</div>}
                          </div>
                        </div>
                      )
                    })}
                    {hasMore && (
                      <div ref={loadMoreRef} style={{
                        padding: '8px', borderRadius: 8,
                        color: 'var(--muted)', fontSize: 10, textAlign: 'center',
                        letterSpacing: '0.08em', opacity: 0.6,
                      }}>
                        Loading more…
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Share button — lets viewers re-broadcast the /gift/show URL */}
            <div style={{ padding: '14px 20px 4px', display: 'flex', justifyContent: 'center' }}>
              <ShareButton3D rc={rc} onClick={async () => {
                const hero = lettersOnly[0] ?? (data?.claims ?? [])[0]
                const amount = formatIusd(hero?.amount ?? box?.amount ?? data?.packet?.amount)
                const senderNick = sender?.nickname ?? 'a friend'
                const giftName = box?.name ?? 'a gift'
                const sharesPart = totalShares > 1 ? ` · ${totalShares} shares` : ' (exclusive)'
                const claimerNick = hero?.claimer_nickname ?? 'someone'
                const text = `${claimerNick} received "${giftName}" from ${senderNick} — ${amount} iUSD${sharesPart}`
                const url = `${window.location.origin}/gift/show?p=${packetId}`
                if (navigator.share) {
                  navigator.share({ title: t('giftClaim.shareTitle', { name: senderNick }), text, url }).catch(() => {})
                } else {
                  try {
                    await navigator.clipboard.writeText(`${text}\n${url}`)
                    showToast(t('toast.linkCopied'), 'success')
                  } catch {
                    // Last-ditch fallback for older Safari / non-secure contexts
                    const ta = document.createElement('textarea')
                    ta.value = `${text}\n${url}`
                    ta.style.position = 'fixed'; ta.style.top = '-9999px'
                    document.body.appendChild(ta); ta.select()
                    document.execCommand('copy')
                    document.body.removeChild(ta)
                    showToast(t('toast.linkCopied'), 'success')
                  }
                }
              }} />
            </div>

            {/* Sender credit */}
            <div style={{ padding: '10px 20px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                {t('giftClaim.sentWithLoveBy')}{' '}
                <span onClick={() => addContact(sender?.shortId, sender?.nickname)}
                  style={{ fontWeight: 600, color: rc, cursor: 'pointer' }}>
                  {sender?.nickname ?? t('gift.someone')}
                  {sender?.shortId && addedContacts.has(sender.shortId) && <span style={{ marginLeft: 3, color: '#22c55e' }}>✓</span>}
                </span>
              </div>
            </div>
          </>
        )}

        {!loading && data && !isShareView && (
          /* ════════════════════════════════════════════════════════════
           *  CLAIM VIEW — interactive gift opening
           * ════════════════════════════════════════════════════════════ */
          <>
            {/* ══ PREVIEW PHASE: Mystery Gift Box ══ */}
            {phase === 'preview' && (
              <div style={{
                padding: '24px 20px', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              }}>
                <style>{`
                  @keyframes mysteryBreath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.02)} }
                  @keyframes mysterySparkle { 0%,100%{opacity:0.15} 50%{opacity:0.7} }
                `}</style>
                {/* "From [sender]" — pixel font */}
                <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" />
                <div style={{ fontFamily: "'Press Start 2P', monospace" }}>
                  <div style={{ fontSize: 14, color: rc, letterSpacing: '0.06em' }}>
                    FROM {(sender?.nickname ?? 'Someone').toUpperCase()}
                  </div>
                  <div style={{ fontSize: 10, color: allGone ? 'var(--muted)' : '#d4a017', marginTop: 10, lineHeight: 1.6 }}>
                    {allGone ? 'All shares have been claimed' : 'A gift is waiting for you'}
                  </div>
                </div>

                {/* Mystery gift box — reuse GiftBoxImage component (identical to Gift sent page) */}
                <div style={{ animation: allGone ? 'none' : 'mysteryBreath 3s ease-in-out infinite', filter: allGone ? 'grayscale(0.8) opacity(0.5)' : 'none' }}>
                  <GiftBoxImage styleId={data.wrapStyleId ?? 0} size={200} glow={!allGone} />
                </div>
              </div>
            )}

            {/* ══ MONTAGE PHASE: page-by-page reveal ══ */}
            {phase === 'montage' && (() => {
              const hasMemo = !!data?.message
              const totalPages = hasMemo ? 5 : 4
              // Map montageStep to actual content page
              // With memo: 0=memo, 1=name, 2=image, 3=shares, 4=amount
              // Without memo: 0=name, 1=image, 2=shares, 3=amount
              const pageIdx = hasMemo ? montageStep : montageStep + 1 // normalize to 0-4 where 0=memo

              return (
                <div style={{
                  padding: '40px 20px', minHeight: 300, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', position: 'relative',
                  cursor: 'pointer',
                }} onClick={() => setMontageStep(s => s + 1)}>
                  <style>{`
                    @keyframes montageFadeIn { from{opacity:0;transform:scale(0.9) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }
                    @keyframes montageBlurIn { from{opacity:0;filter:blur(20px);transform:scale(0.6)} to{opacity:1;filter:blur(0);transform:scale(1)} }
                    @keyframes montageCountUp { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }
                  `}</style>

                  {/* Page 0 (with memo): Sender's Message */}
                  {pageIdx === 0 && data.message && (
                    <div style={{ textAlign: 'center', animation: 'montageFadeIn 0.8s ease-out' }}>
                      <div style={{
                        fontSize: memoFont ? 22 : 16,
                        fontFamily: memoFont ? `'${memoFont}', cursive` : 'inherit',
                        fontStyle: memoFont ? 'normal' : 'italic',
                        color: 'var(--text)', lineHeight: 1.7, maxWidth: 320,
                      }}>
                        {data.message}
                      </div>
                      <div style={{ fontSize: 11, color: rc, marginTop: 16 }}>
                        — {sender?.nickname ?? 'Someone'}
                      </div>
                    </div>
                  )}

                  {/* Page 1: Gift Name */}
                  {pageIdx === 1 && (
                    <div style={{ textAlign: 'center', animation: 'montageFadeIn 0.6s ease-out' }}>
                      {box?.collection && (
                        <div style={{ fontSize: 10, color: rc, padding: '2px 10px', borderRadius: 10,
                                      background: `${rc}15`, display: 'inline-block', marginBottom: 8,
                                      letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                          {collLabel(box.collection)}
                        </div>
                      )}
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>
                        {box?.name ?? 'A Special Gift'}
                      </div>
                    </div>
                  )}

                  {/* Page 2: Gift Image */}
                  {pageIdx === 2 && images.length > 0 && (
                    <div style={{ animation: 'montageBlurIn 1.2s ease-out' }}>
                      <img src={images[0]} alt="" style={{
                        width: 240, height: 240, objectFit: 'contain', borderRadius: 14,
                        boxShadow: `0 0 30px ${rc}40`,
                      }} />
                    </div>
                  )}
                  {pageIdx === 2 && images.length === 0 && (
                    <div style={{ fontSize: 64, animation: 'montageFadeIn 0.8s ease-out' }}>🎁</div>
                  )}

                  {/* Page 3: Shares */}
                  {pageIdx === 3 && (
                    <div style={{ textAlign: 'center', animation: 'montageFadeIn 0.8s ease-out' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                        {totalShares === 1
                          ? 'An exclusive gift just for you'
                          : `You're 1 of ${totalShares} lucky recipients`}
                      </div>
                    </div>
                  )}

                  {/* Page 4: Amount (the big reveal) + confetti */}
                  {pageIdx === 4 && (
                    <>
                      <style>{`
                        @keyframes confettiFall { 0%{transform:translate(0,-20px) rotate(0);opacity:0} 10%{opacity:1} 100%{transform:translate(var(--cx),var(--cy)) rotate(720deg);opacity:0} }
                      `}</style>
                      {/* Confetti particles */}
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                        {Array.from({ length: 28 }).map((_, i) => {
                          const colors = ['#FFD700','#FF6347','#22c55e','#3b82f6','#a855f7','#ec4899','#FFA500']
                          const c = colors[i % colors.length]
                          const cx = (Math.random() - 0.5) * 360
                          const cy = 180 + Math.random() * 240
                          const delay = Math.random() * 0.4
                          const shape = i % 3
                          return (
                            <div key={i} style={{
                              position: 'absolute',
                              left: '50%', top: '30%',
                              width: shape === 0 ? 8 : shape === 1 ? 6 : 10,
                              height: shape === 0 ? 8 : shape === 1 ? 14 : 10,
                              background: c, borderRadius: shape === 2 ? '50%' : 2,
                              animation: `confettiFall 1.8s cubic-bezier(0.2,0.6,0.4,1) ${delay}s forwards`,
                              ['--cx' as any]: `${cx}px`,
                              ['--cy' as any]: `${cy}px`,
                            } as React.CSSProperties} />
                          )
                        })}
                      </div>
                      <div style={{ textAlign: 'center', animation: 'montageCountUp 1s cubic-bezier(0.34,1.56,0.64,1)', position: 'relative', zIndex: 2 }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>{t('giftClaim.youReceived')}</div>
                        <div style={{ fontSize: 48, fontWeight: 900, color: '#22c55e',
                          textShadow: '0 0 30px rgba(34,197,94,0.6)' }}>
                          +{formatIusd(data?.myAmount ?? box?.amount ?? data?.packet?.amount)}
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>iUSD</div>
                      </div>
                    </>
                  )}

                  {/* Progress dots */}
                  <div style={{ position: 'absolute', bottom: 16, display: 'flex', gap: 6 }}>
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: i === montageStep ? '#fff' : 'rgba(255,255,255,0.25)',
                        transition: 'background 0.3s',
                      }} />
                    ))}
                  </div>

                  {/* Skip button */}
                  <button onClick={(e) => { e.stopPropagation(); setMontageStep(totalPages) }}
                    style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none',
                             color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>
                    Skip ›
                  </button>
                </div>
              )
            })()}

            {/* ══ REVEALED/THANKED: New two-column layout with staged reveal ══ */}
            {(phase === 'revealed' || phase === 'thanked') && (
              <div style={{ padding: '16px 16px 0', animation: 'slideUp 0.5s ease-out' }}>
                <style>{`
                  @keyframes revealStage { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
                `}</style>
                {(() => {
                  // Staged reveal only fires the first time after a claim flow completes.
                  // On reload, justRevealed is false — everything appears instantly.
                  // Stage 0: image + signature (0s)
                  // Stage 1: from sender + memo (1s)
                  // Stage 2: +amount I GOT (2s)
                  // Stage 3: title + details/share (3s)
                  const stageStyle = (delay: number): React.CSSProperties => justRevealed ? {
                    opacity: 0,
                    animation: `revealStage 0.7s ease-out ${delay}s forwards`,
                  } : {}
                  return (
                <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'stretch' }}>
                  {/* Left: Image + title + details (aligned with share on right col) */}
                  <div style={{ width: 140, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <div style={{
                      position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 12,
                      overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)',
                      cursor: images.length > 0 ? 'pointer' : 'default',
                      ...stageStyle(0),
                    }} onClick={() => images.length > 0 && setShowZoom(true)}>
                      {images.length > 0 && (
                        <img src={images[imgIdx]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      )}
                      {images.length > 1 && (
                        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 3 }}>
                          {images.map((_: any, i: number) => (
                            <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i === imgIdx ? rc : 'rgba(255,255,255,0.4)' }} />
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Title below image */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, textAlign: 'center', marginTop: 6,
                                  ...stageStyle(3) }}>
                      {box?.name ?? 'Gift'}
                    </div>
                    {/* details + Share side-by-side at bottom of left col */}
                    <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6,
                                  ...stageStyle(3) }}>
                      {box?.description && (
                        <button onClick={() => setShowDesc(true)} style={{
                          padding: '5px 10px', background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)', borderRadius: 8,
                          cursor: 'pointer', fontSize: 10, color: 'var(--muted)',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                          </svg>
                          details
                        </button>
                      )}
                      <ShareButton3D rc={rc} onClick={async () => {
                        const amount = formatIusd(data?.myAmount ?? box?.amount ?? data?.packet?.amount)
                        const senderNick = sender?.nickname ?? 'a friend'
                        const giftName = box?.name ?? 'a gift'
                        const sharesPart = totalShares > 1 ? ` ${totalShares} shares` : ' (exclusive)'
                        const myNick = account?.nickname || 'I'
                        let text = `${myNick} received "${giftName}" from ${senderNick} — ${amount} iUSD${sharesPart}`
                        if (customThank.trim() || thankSent) {
                          const replyText = thankSent
                            ? (data?.claims?.find((c: any) => c.claimer_address?.toLowerCase() === address?.toLowerCase())?.thank_message ?? '')
                            : customThank.trim()
                          if (replyText) text += `\n\n💌 "${replyText}"`
                        }
                        // Always share the canonical /gift/show path (no claim key)
                        const url = `${window.location.origin}/gift/show?p=${packetId}`
                        if (navigator.share) {
                          navigator.share({ title: t('giftClaim.shareTitle', { name: senderNick }), text, url }).catch(() => {})
                        } else {
                          navigator.clipboard.writeText(`${text}\n${url}`)
                        }
                      }} />
                    </div>
                  </div>

                  {/* Right: From + memo + amount (stacked tight) */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* From + memo — stage 1 */}
                    <div style={stageStyle(1)}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('giftClaim.from')}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: rc, lineHeight: 1.1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                        {sender?.nickname ?? 'Someone'}
                      </div>
                      {data.message && (
                        <div style={{
                          fontSize: memoFont ? 16 : 13,
                          fontFamily: memoFont ? `'${memoFont}', cursive` : 'inherit',
                          fontStyle: memoFont ? 'normal' : 'italic',
                          color: 'var(--text)', lineHeight: 1.5, opacity: 0.9, marginTop: 6,
                        }}>
                          {data.message}
                        </div>
                      )}
                    </div>
                    {/* Amount + shares — stage 2 (I GOT big reveal) */}
                    <div style={{ marginTop: 2, ...stageStyle(2) }}>
                      <div>
                        <span style={{ fontSize: 22, fontWeight: 900, color: '#22c55e' }}>
                          +{formatIusd(data?.myAmount ?? box?.amount ?? data?.packet?.amount)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>iUSD</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {totalShares > 1 ? t('giftClaim.sharesCountLabel', { count: totalShares }) : t('giftClaim.onlyOneShare')}
                      </div>
                    </div>
                  </div>
                </div>
                  )
                })()}
              </div>
            )}

            {/* ── Action area ──────────────────────────────── */}
            <div style={{ padding: '0 20px 16px' }}>
              {error && <div style={{ fontSize: 10, color: '#ef4444', textAlign: 'center', marginBottom: 8 }}>{error}</div>}

              {/* Opening — three-frame box animation (closed → open1 → open2 → wait for tap) */}
              {(phase === 'opening' || phase === 'opened') && (() => {
                const ws = (data?.wrapStyleId ?? 0) % 12
                const color = ['red','orange','lime','yellow','blue','forest','teal','pink','purple','silver','gold','darkblue'][ws]
                // Determine which frame to show
                const frame = phase === 'opened' ? 'open2'
                  : myStatus === 'claimed' ? 'open2'
                  : myStatus === 'processing' ? 'open1'
                  : 'box' // queued or initial
                const isOpened = phase === 'opened'
                return (
                  <div onClick={isOpened ? startMontage : undefined}
                    style={{
                      padding: '24px 20px', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', gap: 14,
                      cursor: isOpened ? 'pointer' : 'default',
                    }}>
                    <style>{`
                      @keyframes boxShake { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-3deg)} 40%{transform:rotate(3deg)} 60%{transform:rotate(-2deg)} 80%{transform:rotate(2deg)} }
                      @keyframes openedGlow { 0%,100%{filter:drop-shadow(0 0 14px ${rc}55) drop-shadow(0 4px 10px rgba(0,0,0,0.3))} 50%{filter:drop-shadow(0 0 28px ${rc}99) drop-shadow(0 4px 10px rgba(0,0,0,0.3))} }
                      @keyframes tapPulse { 0%,100%{opacity:0.7} 50%{opacity:1} }
                    `}</style>
                    {/* Gift box with frame transition */}
                    <div style={{
                      animation: isOpened ? 'openedGlow 1.8s ease-in-out infinite'
                        : frame === 'box' ? 'boxShake 0.5s ease-in-out infinite' : 'none',
                      transition: 'all 0.5s ease',
                    }}>
                      <img src={`/images/gift-assets/${frame}_${ws}_${color}.png`}
                        alt="" style={{
                          width: 180, height: 'auto',
                          filter: isOpened ? undefined : `drop-shadow(0 0 16px ${rc}40) drop-shadow(0 4px 10px rgba(0,0,0,0.3))`,
                          transition: 'all 0.4s ease',
                        }} />
                    </div>
                    {!isOpened && (
                      <>
                        {/* Progress bar */}
                        <div style={{ width: '50%', height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{
                            width: '100%', height: '100%', borderRadius: 2,
                            background: `linear-gradient(90deg, transparent, ${rc}, transparent)`,
                            backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
                          }} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {myStatus === 'claimed' ? t('giftClaim.giftReceivedChip')
                            : myStatus === 'processing' ? 'Opening your gift...'
                            : 'Waiting in queue...'}
                        </div>
                      </>
                    )}
                    {isOpened && (
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: rc,
                        animation: 'tapPulse 1.2s ease-in-out infinite',
                        letterSpacing: '0.08em', marginTop: 4,
                      }}>
                        ✨ Tap to reveal ✨
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Reply section — collapsed by default, expand on click */}
              {(phase === 'revealed' || phase === 'thanked') && (
                <div style={{ padding: '0 16px 14px', position: 'relative' }}>
                  {/* Ephemeral toast after sending reply */}
                  {showThankToast && (
                    <div style={{
                      position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
                      background: '#22c55e', color: '#fff',
                      fontSize: 11, fontWeight: 600, padding: '6px 14px', borderRadius: 20,
                      boxShadow: '0 6px 16px rgba(34,197,94,0.4)', zIndex: 20,
                      animation: 'thankToast 2.5s ease-out forwards',
                    }}>
                      <style>{`@keyframes thankToast{0%{opacity:0;transform:translate(-50%,-10px)}10%,80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-6px)}}`}</style>
                      ✓ Reply sent
                    </div>
                  )}
                  {thankSent ? null : !showReplyBox ? (
                    <button onClick={() => setShowReplyBox(true)}
                      style={{
                        width: '100%', padding: '11px 14px', borderRadius: 12,
                        background: `linear-gradient(135deg, hsla(${dnaHue},20%,95%,0.15), var(--bg-elevated))`,
                        border: `1px solid var(--border)`, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        💌 Say something to <span style={{ fontWeight: 700, color: rc }}>{sender?.nickname ?? 'sender'}</span>
                      </span>
                      <span style={{ fontSize: 10, color: rc, fontWeight: 600 }}>{t('giftClaim.reply')}</span>
                    </button>
                  ) : (
                    <div style={{
                      background: `linear-gradient(135deg, hsla(${dnaHue},20%,95%,0.15), var(--bg-elevated))`,
                      border: '1px solid var(--border)', borderRadius: 12, padding: '12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                          To <span style={{ fontWeight: 700, color: rc }}>{sender?.nickname ?? 'sender'}</span>
                        </span>
                        <div style={{ position: 'relative' }}>
                          <button onClick={() => setShowThankPresets(s => !s)} style={{
                            padding: '4px 10px', fontSize: 10, borderRadius: 8, cursor: 'pointer',
                            border: '1px solid var(--border)', background: 'var(--surface)',
                            color: 'var(--muted)', fontWeight: 600,
                          }}>{t('gift.quickPicks')} ▾</button>
                          {showThankPresets && (
                            <>
                              <div onClick={() => setShowThankPresets(false)}
                                style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                              <div style={{
                                position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
                                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.25)', minWidth: 200, maxHeight: 260, overflowY: 'auto',
                                WebkitOverflowScrolling: 'touch',
                              }}>
                                {THANK_PRESETS.map((p, i) => {
                                  const text = t(`giftClaim.thankPresets.${p.id}`)
                                  return (
                                    <button key={i}
                                      onClick={() => { setCustomThank(`${p.emoji} ${text}`); setShowThankPresets(false) }}
                                      style={{
                                        display: 'block', width: '100%', padding: '9px 12px', background: 'none',
                                        border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                                        textAlign: 'left', fontSize: 12, color: 'var(--text)',
                                      }}>{p.emoji} {text}</button>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <textarea value={customThank} onChange={e => setCustomThank(e.target.value)}
                        placeholder="Write a note..."
                        maxLength={100} rows={2}
                        style={{
                          width: '100%', padding: '10px 12px', borderRadius: 10,
                          border: '1px solid var(--border)', background: 'var(--surface)',
                          color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'none',
                          fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
                        }} />
                      <button onClick={() => {
                        const msg = customThank.trim()
                        if (msg) sendThank(msg.match(/^(\p{Emoji})/u)?.[1] ?? '💌', msg.replace(/^(\p{Emoji})\s*/u, ''))
                      }}
                        disabled={!customThank.trim() || thankSending}
                        style={{
                          width: '100%', marginTop: 8, padding: '11px', borderRadius: 10,
                          border: 'none', fontSize: 13, fontWeight: 700,
                          background: rc, color: '#fff',
                          cursor: customThank.trim() ? 'pointer' : 'not-allowed',
                          opacity: customThank.trim() ? 1 : 0.35,
                        }}>
                        {thankSending ? 'Sending...' : 'Reply'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Claim buttons (preview phase only) */}
              {phase === 'preview' && !isQueued && (
                <>
                  {alreadyClaimed ? (
                    <button style={{ ...btnSt, opacity: 0.5, cursor: 'default' }} disabled>{t('giftClaim.alreadyClaimed')}</button>
                  ) : allGone ? (
                    <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: 'var(--muted)' }}>
                      All shares have been claimed
                    </div>
                  ) : status === 'registered' && token ? (
                    <button style={btnSt} onClick={handleClaim} disabled={claiming}>
                      {claiming ? 'Opening...' : 'Open'}
                    </button>
                  ) : (
                    /* QuickLogin: handles connected/disconnected, desktop/mobile, social/wallet */
                    <QuickLogin actionLabel="Open" accentColor={rc} />
                  )}
                </>
              )}
            </div>

            {/* ── Letters timeline (card style) ──────────────── */}
            {lettersOnly.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: 10 }}>
                  {t('giftClaim.lettersHeader', { count: lettersOnly.length })}
                </div>
                <style>{`@keyframes letterSlideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }`}</style>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lettersOnly.map((c: any, i: number) => {
                    const cHue = c.claimer_nickname ? fnvHash(c.claimer_nickname) % 360 : 180
                    return (
                      <div key={i} style={{
                        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                        padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start',
                        animation: `letterSlideIn 0.3s ease-out ${i * 0.05}s both`,
                      }}>
                        {/* DNA avatar circle */}
                        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: `linear-gradient(135deg, hsl(${cHue},50%,55%), hsl(${cHue},50%,40%))`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, color: '#fff',
                        }}>{c.thank_emoji || '💌'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: `hsl(${cHue},45%,45%)` }}>
                              {c.claimer_nickname ?? 'Anonymous'}
                            </span>
                            {c.amount != null && (
                              <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 600, background: 'rgba(34,197,94,0.08)', padding: '1px 6px', borderRadius: 8 }}>
                                +{formatIusd(c.amount)} iUSD
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{c.thank_message}</div>
                          {c.claimed_at && <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>{timeAgo(c.claimed_at)}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Share button moved into left column of revealed view — see above */}
          </>
        )}
      </div>

      {/* ── Image Zoom Viewer ─────────────────────────────────── */}
      {/* "Added to Contacts" toast */}
      {/* Zoom QR modal — click to dismiss */}
      {zoomQr && (() => {
        const zHue = fnvHash(zoomQr.address || zoomQr.nickname) % 360
        return (
          <div onClick={() => setZoomQr(null)} style={{
            position: 'fixed', inset: 0, zIndex: 400,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 24, animation: 'fadeIn 0.2s ease-out',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: '#fff', borderRadius: 20, padding: 20,
              boxShadow: `0 20px 60px hsla(${zHue},60%,40%,0.5)`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            }}>
              <StyledQR url={zoomQr.url} address={zoomQr.address} size={280} theme="light" />
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                {zoomQr.nickname}
              </div>
              <div style={{ fontSize: 11, color: '#666' }}>{t('giftClaim.scanProfile')}</div>
            </div>
            <button onClick={() => setZoomQr(null)} style={{
              marginTop: 20, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff', padding: '8px 24px', borderRadius: 20, cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
            }}>
              Close
            </button>
          </div>
        )
      })()}

      {toastNick && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 500, background: '#22c55e', color: '#fff',
          fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 20,
          boxShadow: '0 8px 20px rgba(34,197,94,0.4)',
          animation: 'contactToast 1.8s ease-out forwards',
        }}>
          <style>{`@keyframes contactToast{0%{opacity:0;transform:translate(-50%,-10px)}12%,80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-8px)}}`}</style>
          ✓ {toastNick}
        </div>
      )}
      {showZoom && images.length > 0 && (
        <div
          onClick={() => setShowZoom(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease-out',
          }}>
          <button onClick={() => setShowZoom(false)} style={{
            position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)',
            border: 'none', borderRadius: '50%', width: 36, height: 36,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 18, zIndex: 2,
          }}>✕</button>
          {/* Prev/Next arrows for multi-image */}
          {images.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setImgIdx(i => (i - 1 + images.length) % images.length) }} style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
                width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 18, zIndex: 2,
              }}>‹</button>
              <button onClick={(e) => { e.stopPropagation(); setImgIdx(i => (i + 1) % images.length) }} style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
                width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 18, zIndex: 2,
              }}>›</button>
            </>
          )}
          <img
            onClick={e => e.stopPropagation()}
            src={images[imgIdx]}
            alt=""
            style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }}
          />
          {/* Counter */}
          {images.length > 1 && (
            <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                          fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
              {imgIdx + 1} / {images.length}
            </div>
          )}
        </div>
      )}

      {/* ── Description popup ─────────────────────────────────── */}
      {showDesc && box?.description && (
        <div onClick={() => setShowDesc(false)} style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 360, background: 'var(--surface)', borderRadius: 14,
            border: '1px solid var(--border)', padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{t(`giftBox.${(box as any).id ?? (box as any).box_id}.name`, { defaultValue: box.name })}</span>
              <button onClick={() => setShowDesc(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>
            {box.collection && <div style={{ fontSize: 10, color: rc, marginBottom: 6 }}>{collLabel(box.collection)}</div>}
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{t(`giftBox.${(box as any).id ?? (box as any).box_id}.description`, { defaultValue: box.description })}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 3D Share Button ─────────────────────────────────────────────────────
// Uses a solid colored sphere with dark edge — stays visible on both light/dark bg.
function ShareButton3D({ rc, onClick }: { rc: string; onClick: () => void }) {
  // Derive a darker shade for the edge (no alpha — keeps contrast on light bg)
  // rc is hsl(hue, 65%, 45%); build a darker hsl(hue, 65%, 25%) edge
  const darkEdge = rc.replace(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/, (_m, h, _s) => `hsl(${h}, 70%, 22%)`)
  const hilite = rc.replace(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/, (_m, h) => `hsl(${h}, 80%, 70%)`)
  return (
    <button onClick={onClick} title="Share"
      style={{
        width: 34, height: 34, borderRadius: '50%',
        border: `1.5px solid ${darkEdge}`,
        background: `radial-gradient(circle at 32% 28%, ${hilite} 0%, ${rc} 45%, ${darkEdge} 100%)`,
        boxShadow: `0 3px 8px rgba(0,0,0,0.35), inset 0 1px 2px rgba(255,255,255,0.5)`,
        color: '#ffffff', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        transition: 'transform 0.15s',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.92)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onTouchStart={e => (e.currentTarget.style.transform = 'scale(0.92)')}
      onTouchEnd={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))' }}>
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
    </button>
  )
}

const btnSt: React.CSSProperties = {
  width: '100%', padding: '14px', borderRadius: 12, border: 'none',
  fontSize: 14, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)',
  cursor: 'pointer',
}
