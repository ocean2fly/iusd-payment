/**
 * InBox — /app/inbox
 * Lists all PENDING_CLAIM payments addressed to the current user.
 * User picks a destination address and claims via relayer (sponsor pays gas).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useAuthContext } from '../hooks/AuthContext'
import { useInboxBadge } from '../hooks/useInboxBadge'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { buildClaimTx } from '../services/orderBuilder'
import { ikSign } from '../services/ikSigner'
import { UserSeal } from '../components/UserSeal'
import { API_BASE } from '../config'
import { useActivity } from '../hooks/useActivity'
import { SkeletonInBox } from '../components/Skeleton'
import { upsertContact, loadContacts } from '../lib/contactsStore'
import { giftCoverNode } from './Gift'
import { GiftRowCard } from '../components/GiftRowCard'
import { ReceivedGiftPreviewModal } from '../components/ReceivedGiftPreviewModal'
import { useUnreadSync } from '../hooks/useUnreadSync'
import { parseTimestamp } from '../lib/dateUtils'

const IUSD = (micro: string | number) => (parseInt(String(micro)) / 1_000_000).toFixed(2)

interface InboxPayment {
  paymentId:    string
  amountMicro:  string
  feeMicro:     string
  amountIusd:   string
  senderShortId: string | null
  expiresAt:    number   // block height
  claimKey:     string
  dbCreatedAt?: string   // ISO datetime from DB
  invoiceToken?: string | null
  invoiceNo?:    string | null
  invoiceNote?:  string | null
}

export function InBox() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const smartClose = useSmartClose('/app')
  const { address, token, account } = useAuthContext()
  const { refresh: refreshBadge } = useInboxBadge()
  const unreadSync = useUnreadSync()

  const { requestTxBlock, offlineSigner } = useInterwovenKit()
  const [payments,     setPayments]     = useState<InboxPayment[]>([])
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [giftReceived, setGiftReceived] = useState<any[]>([])
  const [giftPending, setGiftPending] = useState<any[]>([])
  const [giftSent, setGiftSent] = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // Reply detail modal
  const [replyModal, setReplyModal] = useState<{ packetId: string; gift: any } | null>(null)
  const [previewPacketId, setPreviewPacketId] = useState<string | null>(null)
  const [replyList, setReplyList] = useState<any[]>([])
  const [replyLoading, setReplyLoading] = useState(false)

  const [inboxFilter, setInboxFilter] = useState<'all'|'payment'|'gift'|'reply'>('all')

  // Reply tab: fetch gift_reply activity items (aggregated replies/comments on
  // gifts I'm involved with, excluding my own replies). Lazy-loaded — only
  // triggers when user opens the Reply tab.
  const {
    items: replyItems,
    loading: replyTabLoading,
    loadingMore: replyLoadingMore,
    hasMore: replyHasMore,
    loadMore: loadMoreReplies,
    refresh: refreshReplies,
  } = useActivity({
    types: ['gift_reply'],
    limit: 20,
    auto: inboxFilter === 'reply',
  })

  // Claim state
  const [claiming,  setClaiming]  = useState<string | null>(null)  // paymentId being claimed
  const [claimErr,  setClaimErr]  = useState('')
  const [claimDone, setClaimDone] = useState<string | null>(null)   // txHash on success

  const defaultClaimAddr = account?.defaultClaimAddress ?? address ?? ''
  const [claimAddrModal, setClaimAddrModal] = useState<{p: InboxPayment; input: string} | null>(null)
  const [claimAddrSigning, setClaimAddrSigning] = useState(false)
  // autoClaimEnabled comes from server (account.autoClaimEnabled)
  const [autoClaimPref, setAutoClaimPref] = useState(() => !!account?.autoClaimEnabled)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [historySortAsc, setHistorySortAsc] = useState(false)
  // Sync from server when account loads
  useEffect(() => { setAutoClaimPref(!!account?.autoClaimEnabled) }, [account?.autoClaimEnabled])
  function toggleAutoClaimPref() {
    const next = !autoClaimPref
    setAutoClaimPref(next)
    if (token) {
      fetch(`${API_BASE}/account/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body: JSON.stringify({ autoClaimEnabled: next }),
      }).then(async r => {
        if (next && r.ok) {
          const d = await r.json()
          if (d.escalated > 0) {
            // Reload inbox after 3s to reflect claimed payments
            setTimeout(() => load(), 3000)
          }
        }
      }).catch(() => {})
    }
  }

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const types = 'payment_pending,payment_received,gift_pending,gift_received,gift_sent'
      const res = await fetch(`${API_BASE}/activity?types=${types}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load inbox')
      const items: any[] = Array.isArray(data?.items) ? data.items : []

      const nextPayments: InboxPayment[] = []
      const nextHistory: any[] = []
      const nextGiftReceived: any[] = []
      const nextGiftPending: any[] = []
      const nextGiftSent: any[] = []

      for (const it of items) {
        const d = it.data ?? {}
        const cp = it.counterparty ?? {}
        if (it.type === 'payment_pending') {
          nextPayments.push({
            paymentId:     d.paymentId,
            amountMicro:   it.amountMicro ?? '0',
            feeMicro:      d.feeMicro ?? '0',
            amountIusd:    (parseInt(String(it.amountMicro ?? '0')) / 1_000_000).toFixed(6),
            senderShortId: cp.shortId ?? null,
            expiresAt:     Number(d.expiresAt ?? 0),
            claimKey:      d.claimKey ?? '',
            dbCreatedAt:   it.at,
            invoiceToken:  d.invoiceToken ?? null,
            invoiceNo:     d.invoiceNo ?? null,
            invoiceNote:   d.invoiceNote ?? null,
          })
        } else if (it.type === 'payment_received') {
          nextHistory.push({
            paymentId:     d.paymentId,
            amountMicro:   it.amountMicro ?? '0',
            feeMicro:      d.feeMicro ?? '0',
            status:        d.chainStatus ?? 3,
            senderShortId: cp.shortId ?? null,
            dbCreatedAt:   it.at,
            invoiceToken:  d.invoiceToken ?? null,
            invoiceNo:     d.invoiceNo ?? null,
            invoiceNote:   d.invoiceNote ?? null,
            invoiceMode:   d.invoiceMode ?? null,
          })
        } else if (it.type === 'gift_received') {
          nextGiftReceived.push({
            packet_id:      d.packetId,
            box_id:         d.boxId,
            amount:         parseInt(String(it.amountMicro ?? '0')),
            claimed:        true,
            claimed_at:     it.at,
            sender_nickname: cp.nickname ?? null,
            sender_message: d.senderMessage ?? '',
            wrap_style_id:  d.wrapStyleId ?? 0,
            wrap_params:    d.wrapParams ?? null,
            expires_at:     d.expiresAt ?? null,
            gift: {
              name:      d.gift?.name ?? `Gift #${d.boxId}`,
              image_url: d.gift?.imageUrl ?? '',
              collection: d.gift?.collection ?? 'other',
            },
          })
        } else if (it.type === 'gift_pending') {
          nextGiftPending.push({
            packet_id:      d.packetId,
            box_id:         d.boxId,
            amount:         parseInt(String(it.amountMicro ?? '0')),
            sender_nickname: cp.nickname ?? null,
            sender_message: d.senderMessage ?? '',
            wrap_style_id:  d.wrapStyleId ?? 0,
            wrap_params:    d.wrapParams ?? null,
            expires_at:     d.expiresAt ?? null,
            gift: {
              name:      d.gift?.name ?? `Gift #${d.boxId}`,
              image_url: d.gift?.imageUrl ?? '',
              collection: d.gift?.collection ?? 'other',
            },
          })
        } else if (it.type === 'gift_sent') {
          const replyCount = Number(d.replyCount ?? 0)
          const unseen = Number(d.unseenReplyCount ?? 0)
          // Inbox is strictly "incoming". A sent gift only belongs here
          // when someone replied to it — the reply IS the incoming
          // signal. Gifts that are merely active/pending/completed
          // without replies live in /app/history or /app/gift, not
          // here. See the "inbox = incoming" principle in the design.
          if (replyCount > 0) {
            // Claims come across as d.claims — forward them so the
            // GiftRowCard can render the real "X/Y claimed" progress
            // instead of falling through to 0.
            const claimsArr = Array.isArray(d.claims) ? d.claims : []
            nextGiftSent.push({
              packet_id:          d.packetId,
              box_id:             d.boxId,
              num_slots:          Number(d.numSlots ?? 1),
              total_amount:       parseInt(String(it.amountMicro ?? '0')),
              status:             it.status ?? 'active',
              claims:             claimsArr,
              // Top-level count for sites that read g.claimed_count directly.
              claimed_count:      Number(d.claimedCount ?? claimsArr.length),
              reply_count:        replyCount,
              unseen_reply_count: unseen,
              unseen_activity_count: Number(d.unseenActivityCount ?? 0),
              wrap_style_id:      d.wrapStyleId ?? 0,
              wrap_params:        d.wrapParams ?? null,
              expires_at:         d.giftExpiresAt ?? null,
              gift: {
                name:      d.gift?.name ?? `Gift #${d.boxId}`,
                image_url: d.gift?.imageUrl ?? '',
                collection: d.gift?.collection ?? 'other',
              },
            })
          }
        }
      }

      setPayments(nextPayments)
      // Auto-add senders to contacts
      if (address) {
        nextPayments.forEach((p: any) => {
          if (p.senderShortId) {
            upsertContact(address, {
              shortId:      p.senderShortId,
              nickname:     p.senderShortId,
              shortSealSvg: null,
            })
          }
        })
      }
      const pendingIds = new Set<string>(nextPayments.map(p => p.paymentId))
      setHistoryItems(nextHistory.filter(p => !pendingIds.has(p.paymentId)))
      setGiftReceived(nextGiftReceived)
      setGiftPending(nextGiftPending)
      setGiftSent(nextGiftSent)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, address])


  useEffect(() => { load() }, [load])
  // Refetch when the shared unread revision bumps so red dots clear here too.
  useEffect(() => {
    if (unreadSync.revision === 0) return
    load()
    if (inboxFilter === 'reply') refreshReplies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadSync.revision])

  async function handleClaim(p: InboxPayment) {
    if (!address || !p.claimKey) {
      setClaimErr('No claim key available — please reload')
      return
    }
    setClaimErr('')
    const pid = p.paymentId
    setClaiming(pid)
    try {
      // Pre-check: verify payment is still PENDING_CLAIM on chain before signing
      // (auto-claim may have already claimed it since inbox was loaded)
      try {
        const statusRes = await fetch(`${API_BASE}/invoice/chain/payment-status?paymentId=${pid}`)
        if (statusRes.ok) {
          const statusData = await statusRes.json()
          if (statusData.chainStatus === 3) {
            // Already claimed (by relayer or another device) — refresh inbox
            setPayments(prev => prev.filter(x => x.paymentId !== pid))
            setClaimErr(t('inbox.alreadyClaimedRefreshed'))
            setClaiming(null)
            return
          }
        }
      } catch { /* pre-check is best-effort; proceed to attempt claim */ }

      // Build claim tx — pays to msg.sender (your connected wallet)
      const { txMsg } = await buildClaimTx(address, p.paymentId, p.claimKey)
      // User signs via IK; feegrant covers gas (no INIT needed)
      const txRes = await requestTxBlock({ messages: [txMsg] })
      if (txRes?.code !== 0 && txRes?.code !== undefined) {
        const rawLog = String((txRes as any)?.rawLog ?? '')
        // E_INVALID_TRANSITION (0x30066) = already claimed
        if (rawLog.includes('0x30066') || rawLog.includes('30066') || rawLog.includes('INVALID_TRANSITION')) {
          setPayments(prev => prev.filter(x => x.paymentId !== pid))
          setClaimErr(t('inbox.alreadyClaimedRemoved'))
          setClaiming(null)
          return
        }
        throw new Error(rawLog || 'Transaction failed')
      }
      setClaimDone((txRes as any)?.txHash ?? 'ok')
      setPayments(prev => prev.filter(x => x.paymentId !== pid))
      refreshBadge()
    } catch (e: any) {
      const msg = String(e?.message ?? '')
      if (msg.includes('0x30066') || msg.includes('30066') || msg.includes('INVALID_TRANSITION')) {
        setPayments(prev => prev.filter(x => x.paymentId !== pid))
        setClaimErr('Already claimed — removed from inbox.')
      } else {
        setClaimErr(msg || 'Claim failed')
      }
    } finally {
      setClaiming(null)
    }
  }


  // ── Success banner ────────────────────────────────────────────────────────
  // Auto-redirect to dashboard 3s after claim
  const [claimCountdown, setClaimCountdown] = useState(3)
  useEffect(() => {
    if (!claimDone) return
    setClaimCountdown(3)
    const t = setInterval(() => setClaimCountdown(n => {
      if (n <= 1) { clearInterval(t); navigate('/app', { replace: true }); return 0 }
      return n - 1
    }), 1000)
    return () => clearInterval(t)
  }, [claimDone])

  // ── Reply tab aggregation ─────────────────────────────────────────────
  // Group reply events by packetId so each gift gets ONE row (with a
  // "+N more" hint), instead of one row per thank-message/comment event.
  // Groups are sorted by the most recent reply timestamp (desc).
  //
  // IMPORTANT: must stay ABOVE the `if (claimDone) return` early exit
  // below. If any hook is declared after that return, flipping claimDone
  // changes the hook count between renders and React aborts with
  // "Rendered fewer hooks than during the previous render" (prod #300).
  const replyGroups = useMemo(() => {
    const byPacket = new Map<string, any[]>()
    for (const r of replyItems) {
      const pid = (r.data?.parentGiftId as string | undefined) ?? null
      if (!pid) continue
      const arr = byPacket.get(pid)
      if (arr) arr.push(r)
      else byPacket.set(pid, [r])
    }
    const groups = Array.from(byPacket.entries()).map(([packetId, items]) => {
      items.sort((a, b) => {
        const ta = parseTimestamp(a.at)?.getTime() ?? 0
        const tb = parseTimestamp(b.at)?.getTime() ?? 0
        return tb - ta
      })
      return { packetId, items, latestAt: parseTimestamp(items[0].at)?.getTime() ?? 0 }
    })
    groups.sort((a, b) => b.latestAt - a.latestAt)
    return groups
  }, [replyItems])

  if (claimDone) {
    return (
      <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column',
                    alignItems:'center', justifyContent:'center', padding:'24px 16px', gap:16, color:'var(--text)' }}>
        <div style={{ fontSize:52 }}>✅</div>
        <div style={{ fontSize:20, fontWeight:700 }}>{t('inbox.claimed')}</div>
        <div style={{ fontSize:13, color:'var(--muted)', textAlign:'center' }}>
          Funds sent to your address.
        </div>
        <div style={{ fontSize:11, color:'var(--muted)' }}>Redirecting in {claimCountdown}s…</div>
        <button onClick={() => navigate('/app', { replace:true })} style={btnFill}>
          Go to Dashboard →
        </button>
      </div>
    )
  }

  return (
    <>
    <div className="inbox-page" style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  padding:'24px 12px 100px', gap:12, boxSizing:'border-box',
                  width:'100%', maxWidth:600, margin:'0 auto', overflowX:'hidden' }}>
      <style>{`
        .inbox-page > * { max-width: 100% !important; box-sizing: border-box !important; }
        .inbox-page input, .inbox-page button { max-width: 100% !important; }
        .inbox-page div { overflow-wrap: break-word; word-break: break-word; }
      `}</style>

      {/* Header */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', alignItems:'center', gap:10,
                    paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
        <button onClick={smartClose} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700 }}>{t('inbox.title')}</span>
        <button onClick={load} style={{ marginLeft:'auto', background:'none', border:'none',
          cursor:'pointer', color:'var(--muted)', fontSize:13 }}>
          {t('inbox.refresh')}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:3, width:'100%', maxWidth:480,
                    background:'var(--surface)', border:'1px solid var(--border)',
                    borderRadius:10, padding:3 }}>
        {(['all','payment','gift','reply'] as const).map(f => (
          <button key={f} onClick={() => { setInboxFilter(f); if (f === 'reply') refreshReplies() }} style={{
            flex:1, padding:'5px 2px', borderRadius:7, border:'none', cursor:'pointer',
            fontSize:10, fontWeight:700,
            background: inboxFilter === f ? 'var(--text)' : 'transparent',
            color: inboxFilter === f ? 'var(--surface)' : 'var(--muted)',
            transition: 'all 0.15s',
          }}>
            {f === 'all' ? t('inbox.filter.all') : f === 'payment' ? t('inbox.filter.payment') : f === 'gift' ? t('inbox.filter.gift') : t('inbox.filter.reply')}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <SkeletonInBox />}

      {/* Error */}
      {error && !loading && (
        <div style={{ ...card, borderColor:'rgba(239,68,68,0.4)', background:'rgba(239,68,68,0.06)' }}>
          <div style={{ fontSize:12, color:'#ef4444' }}>⚠ {error}</div>
          <button onClick={load} style={btnGhost}>{t('scan.retry')}</button>
        </div>
      )}

      {/* ── Reply tab ── */}
      {inboxFilter === 'reply' && (
        <div style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:10 }}>
          {replyTabLoading && <div style={{ fontSize:12, color:'var(--muted)', textAlign:'center', padding:'24px 0' }}>{t('inbox.loadingReplies')}</div>}
          {!replyTabLoading && replyGroups.length === 0 && (
            <div style={{ fontSize:12, color:'var(--muted)', textAlign:'center', padding:'24px 0' }}>
              {t('inbox.noRepliesHint')}
            </div>
          )}
          {replyGroups.map((group) => {
            const latest = group.items[0]
            const d = latest.data || {}
            const isSentParent = d.parentKind === 'sent'
            const emoji = d.replyEmoji as string | null
            const msg = d.replyMessage as string
            const author = d.replyAuthor as string
            const moreCount = group.items.length - 1
            return (
              <div key={group.packetId}
                onClick={() => {
                  unreadSync.markSeen(group.packetId)
                  navigate(`/gift/claim?p=${group.packetId}`)
                }}
                style={{
                  background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:12, padding:'10px 12px', cursor:'pointer',
                  display:'flex', alignItems:'center', gap:10,
                }}>
                {giftCoverNode({
                  claimed: true,
                  expiresAt: null,
                  wrapStyleId: (d.wrapStyleId as number | undefined) ?? 0,
                  wrapParams: d.wrapParams ?? null,
                  imageUrl: d.parentGiftImage as string | undefined,
                  size: 44,
                })}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text)',
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                                display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>
                      {d.parentGiftName ?? 'Gift'}
                    </span>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:10,
                      color: isSentParent ? '#f59e0b' : '#22c55e',
                      background: isSentParent ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                      border: `1px solid ${isSentParent ? 'rgba(245,158,11,0.4)' : 'rgba(34,197,94,0.4)'}`,
                      whiteSpace:'nowrap',
                    }}>
                      {isSentParent ? 'your gift' : 'gift you claimed'}
                    </span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>
                    <b>{author}</b>:{' '}
                    {emoji ? <span style={{ marginRight:2 }}>{emoji}</span> : null}
                    {msg
                      ? <>"{msg}"</>
                      : <span style={{ color:'var(--muted)', fontStyle:'italic' }}>(no message)</span>}
                  </div>
                  {moreCount > 0 && (
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>
                      +{moreCount} more repl{moreCount === 1 ? 'y' : 'ies'}
                    </div>
                  )}
                  <div style={{ fontSize:9, color:'var(--muted)', marginTop:2 }}>
                    {parseTimestamp(latest.at)?.toLocaleString() ?? ''}
                  </div>
                </div>
              </div>
            )
          })}
          {replyHasMore && (
            <button onClick={() => loadMoreReplies()} disabled={replyLoadingMore}
              style={{
                padding:'10px', borderRadius:10,
                background:'var(--bg-elevated)', border:'1px dashed var(--border)',
                color:'var(--muted)', cursor: replyLoadingMore ? 'wait' : 'pointer',
                fontSize:11, fontWeight:600, letterSpacing:'0.06em',
              }}>
              {replyLoadingMore ? t('common.loading') : t('inbox.loadMoreReplies')}
            </button>
          )}
        </div>
      )}

      {/* ── Gift section ── */}
      {inboxFilter !== 'reply' && !loading && inboxFilter !== 'payment' && (giftPending.length > 0 || giftReceived.length > 0 || giftSent.length > 0) && (
        <>
          {/* Pending gifts — not yet claimed */}
          {giftPending.length > 0 && (
            <>
              <div style={{ width:'100%', maxWidth:520, fontSize:9, fontWeight:700,
                            color:'#f59e0b', letterSpacing:'0.12em', paddingLeft:4 }}>
                {t('inbox.newGiftsSection', { count: giftPending.length })}
              </div>
              {giftPending.map((g: any, i: number) => (
                <div key={`gp${i}`} style={{ width:'100%', maxWidth:520 }}>
                  <GiftRowCard
                    kind="pending"
                    variant="inbox"
                    packetId={g.packet_id}
                    boxId={g.box_id}
                    wrapStyleId={g.wrap_style_id}
                    wrapParams={g.wrap_params}
                    expiresAt={g.expires_at ?? null}
                    giftName={g.gift?.name}
                    giftImageUrl={g.gift?.image_url}
                    senderNickname={g.sender_nickname ?? null}
                    senderMessage={g.sender_message}
                    amount={Number(g.amount) / 1e6}
                    onClick={() => navigate(`/gift/claim?p=${g.packet_id}`)}
                  />
                </div>
              ))}
            </>
          )}

          {/* Received gifts — already claimed */}
          {giftReceived.length > 0 && (
            <>
              <div style={{ width:'100%', maxWidth:520, fontSize:9, fontWeight:700,
                            color:'var(--muted)', letterSpacing:'0.12em', paddingLeft:4 }}>
                {t('inbox.giftsSection', { count: giftReceived.length })}
              </div>
              {giftReceived.map((g: any, i: number) => (
                <div key={`g${i}`} style={{ width:'100%', maxWidth:520 }}>
                  <GiftRowCard
                    kind="received"
                    variant="inbox"
                    packetId={g.packet_id}
                    boxId={g.box_id}
                    wrapStyleId={g.wrap_style_id}
                    wrapParams={g.wrap_params}
                    expiresAt={g.expires_at ?? null}
                    giftName={g.gift?.name}
                    giftImageUrl={g.gift?.image_url}
                    senderNickname={g.sender_nickname ?? null}
                    senderMessage={g.sender_message}
                    claimed={true}
                    claimedAt={g.claimed_at}
                    amount={g.amount != null ? Number(g.amount) / 1e6 : 0}
                    onClick={() => navigate(`/gift/claim?p=${g.packet_id}`)}
                  />
                </div>
              ))}
            </>
          )}

          {/* Sent gifts with replies */}
          {giftSent.length > 0 && (
            <>
              <div style={{ width:'100%', maxWidth:520, fontSize:9, fontWeight:700,
                            color:'var(--muted)', letterSpacing:'0.12em', paddingLeft:4, marginTop:4 }}>
                {t('inbox.sentSection', { count: giftSent.length })}
              </div>
              {giftSent.map((g: any, i: number) => (
                <div key={`gs${i}`} style={{ width:'100%', maxWidth:520 }}>
                  <GiftRowCard
                    kind="sent"
                    variant="inbox"
                    packetId={g.packet_id}
                    boxId={g.box_id}
                    wrapStyleId={g.wrap_style_id}
                    wrapParams={g.wrap_params}
                    expiresAt={g.expires_at ?? null}
                    giftName={g.gift?.name}
                    giftImageUrl={g.gift?.image_url}
                    status={g.status}
                    amount={Number(g.total_amount) / 1e6}
                    numSlots={g.num_slots}
                    claimedCount={g.claims?.length ?? g.claimed_count ?? 0}
                    claimedAt={g.created_at}
                    /* Red-dot in Inbox ONLY for unseen incoming replies.
                       Progress (new claims on a sent gift) is not a
                       notification event — the sender doesn't need to be
                       pinged every time someone else grabs a share. */
                    unseenActivityCount={g.unseen_reply_count ?? 0}
                    onClick={() => {
                      // Always allow viewing a sent gift. If there are
                      // replies, open the reply modal (same as before);
                      // otherwise open the gift preview via the shared
                      // /gift/show viewer so the sender can re-check
                      // status / copy the claim link.
                      if (g.reply_count > 0) {
                        setReplyModal({ packetId: g.packet_id, gift: g })
                        setReplyLoading(true)
                        fetch(`${API_BASE}/gift/packet/${g.packet_id}/replies`, {
                          headers: { Authorization: `Bearer ${token}` },
                        })
                          .then(r => r.json())
                          .then(d => { setReplyList(d.replies ?? []); g.unseen_reply_count = 0 })
                          .catch(() => setReplyList([]))
                          .finally(() => setReplyLoading(false))
                      } else {
                        setPreviewPacketId(g.packet_id)
                      }
                    }}
                  />
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* ── History section (shown first) ── */}
      {inboxFilter !== 'reply' && !loading && inboxFilter !== 'gift' && historyItems.length > 0 && (
        <>
          <div style={{ width:'100%', maxWidth:520, display:'flex', alignItems:'center',
                        paddingLeft:4 }}>
            <span style={{ fontSize:9, fontWeight:700, color:'var(--muted)', letterSpacing:'0.12em' }}>
              {t('inbox.historyLabel', { count: historyItems.length })}
            </span>
            <button onClick={() => setHistorySortAsc(v => !v)}
              style={{ marginLeft:'auto', background:'none', border:'1px solid var(--border)',
                       borderRadius:6, cursor:'pointer', padding:'3px 7px', display:'flex',
                       alignItems:'center', gap:4, color:'var(--muted)', fontSize:10 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M6 12h12M9 18h6"/>
              </svg>
              {historySortAsc ? t('gift.oldest') : t('gift.newest')}
            </button>
          </div>
          {[...historyItems]
            .sort((a: any, b: any) => {
              const ta = a.dbCreatedAt ? new Date(a.dbCreatedAt).getTime() : 0
              const tb = b.dbCreatedAt ? new Date(b.dbCreatedAt).getTime() : 0
              return historySortAsc ? ta - tb : tb - ta
            })
            .map((p: any) => {
            const statusLabel: Record<number,string> = {
              3: t('inbox.statusReceived'),
              5: t('inbox.statusCancelled'),
              6: t('inbox.statusRefunded'),
              7: t('inbox.statusExpired'),
            }
            const statusColor: Record<number,string> = { 3:'#22c55e', 5:'#6b7280', 6:'#8b5cf6', 7:'#6b7280' }
            const col = statusColor[p.status] ?? 'var(--muted)'
            const lbl = statusLabel[p.status] ?? t('inbox.statusDone')
            const isOpen = selectedHistoryId === p.paymentId
            const feeIusd = (parseInt(String(p.feeMicro ?? 0)) / 1_000_000).toFixed(6)
            const dateStr = p.dbCreatedAt
              ? parseTimestamp(p.dbCreatedAt)
                  .toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})
              : '—'
            return (
              <div key={p.paymentId} style={{
                ...card, opacity: isOpen ? 1 : 0.85, padding:0, overflow:'hidden',
                border: isOpen ? `1px solid ${col}50` : '1px solid var(--border)',
                transition: 'border-color 0.15s',
              }}>
                {/* Compact header — clickable */}
                <button onClick={() => setSelectedHistoryId(isOpen ? null : p.paymentId)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
                           background:'transparent', border:'none', cursor:'pointer',
                           textAlign:'left', width:'100%', WebkitTapHighlightColor:'transparent' }}>
                  <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                                background: p.invoiceToken ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)',
                                display:'flex', alignItems:'center', justifyContent:'center',
                                fontSize:12, color: p.invoiceToken ? '#3b82f6' : '#22c55e' }}>
                    {p.invoiceToken ? '🧾' : '↓'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    {p.invoiceToken && (
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                        <span style={{ fontSize:9, fontWeight:700, color: p.invoiceMode === 'business' ? '#3b82f6' : '#22c55e', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                          {p.invoiceMode === 'business' ? t('inbox.businessInvoice') : t('inbox.personalPayment')}
                        </span>
                        {p.invoiceNo && (
                          <span style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace' }}>#{p.invoiceNo}</span>
                        )}
                      </div>
                    )}
                    <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                      <span style={{ fontSize:18, fontWeight:800 }}>+{IUSD(p.amountMicro)}</span>
                      <span style={{ fontSize:10, color:'var(--muted)' }}>iUSD</span>
                    </div>
                    {p.senderShortId && (
                      <div style={{ fontSize:10, color:'var(--muted)', marginTop:1 }}>
                        {t('inbox.fromId', { id: `${p.senderShortId.slice(0,4)}◆${p.senderShortId.slice(-4)}` })}
                      </div>
                    )}
                    {p.invoiceNote && (
                      <div style={{ fontSize:9, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.invoiceNote}</div>
                    )}
                    <div style={{ fontSize:9, color:'var(--muted)', marginTop:1 }}>{dateStr}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <span style={{ fontSize:10, padding:'3px 9px', borderRadius:20, fontWeight:700,
                                   background:col+'25', color:col }}>{lbl}</span>
                    <span style={{ fontSize:11, color:'var(--muted)',
                                   transform: isOpen ? 'rotate(90deg)' : 'none',
                                   transition:'transform 0.15s', display:'block' }}>›</span>
                  </div>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div style={{ borderTop:'1px solid var(--border)', padding:'10px 14px',
                                display:'flex', flexDirection:'column', gap:8 }}>
                    {p.senderShortId && (
                      <div>
                        <div style={{ fontSize:10, color:'var(--muted)', fontWeight:600,
                                       textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{t('inbox.fromLabel')}</div>
                        <UserSeal shortId={p.senderShortId} compact style={{ borderRadius:6 }} />
                      </div>
                    )}
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                      <span style={{ color:'var(--muted)' }}>{t('transfer.amountLabel')}</span>
                      <span style={{ fontWeight:600 }}>+{IUSD(p.amountMicro)} iUSD</span>
                    </div>
                    {parseFloat(feeIusd) > 0 && (
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                        <span style={{ color:'var(--muted)' }}>{t('inbox.feePaid')}</span>
                        <span style={{ color:'var(--muted)' }}>{feeIusd} iUSD</span>
                      </div>
                    )}
                    <div style={{ background:'var(--bg)', borderRadius:6, padding:'6px 8px', overflow:'hidden' }}>
                      <div style={{ fontSize:9, color:'var(--muted)', fontWeight:700,
                                    letterSpacing:'0.1em', marginBottom:3 }}>PAYMENT ID</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                        <span style={{ fontSize:9, fontFamily:'monospace', color:'var(--muted)',
                                       flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis',
                                       whiteSpace:'nowrap' }}>{p.paymentId}</span>
                        <button onClick={() => navigator.clipboard.writeText(p.paymentId)}
                          style={{ flexShrink:0, fontSize:9, padding:'2px 7px', borderRadius:4,
                                   background:'var(--surface)', border:'1px solid var(--border)',
                                   cursor:'pointer', color:'var(--muted)' }}>📋</button>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button
                        onClick={() => window.open(`/receipt/${encodeURIComponent(p.paymentId)}`, '_blank')}
                        style={{ fontSize:11, color:'var(--muted)', background:'none',
                                 border:'1px solid var(--border)', borderRadius:7, padding:'6px 12px',
                                 cursor:'pointer' }}>
                        {t('inbox.receipt')}
                      </button>
                      {p.invoiceToken && p.invoiceMode === 'business' && (
                        <button
                          onClick={() => window.open(`/invoice/${p.invoiceToken}`, '_blank')}
                          style={{ fontSize:11, color:'var(--muted)', background:'none',
                                   border:'1px solid var(--border)', borderRadius:7, padding:'6px 12px',
                                   cursor:'pointer' }}>
                        {t('inbox.invoice')}
                        </button>
                      )}
                      {p.status === 3 && address && (
                        <button
                          onClick={async () => {
                            if (!confirm(t('inbox.refundConfirm'))) return
                            try {
                              const { refundPayment } = await import('../services/payRefund')
                              await refundPayment(requestTxBlock as any, address, p.paymentId)
                              setHistoryItems(prev => prev.map((x: any) =>
                                x.paymentId === p.paymentId ? { ...x, status: 6 } : x))
                            } catch (e: any) { alert(t('inbox.refundFailed', { msg: e?.message ?? e })) }
                          }}
                          style={{ fontSize:11, fontWeight:700, color:'#a855f7',
                                   background:'rgba(168,85,247,0.07)',
                                   border:'1px solid rgba(168,85,247,0.35)',
                                   borderRadius:7, padding:'6px 12px', cursor:'pointer' }}>
                          {t('inbox.refund')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* ── Pending payments ── */}
      {inboxFilter !== 'reply' && !loading && inboxFilter !== 'gift' && payments.length > 0 && (
        <div style={{ width:'100%', maxWidth:520, fontSize:9, fontWeight:700,
                      color:'var(--muted)', letterSpacing:'0.12em',
                      paddingLeft:4, marginTop:8 }}>
          PENDING · {payments.length}
        </div>
      )}
      {inboxFilter !== 'reply' && !loading && inboxFilter !== 'gift' && payments.map((p, _pi) => (
        <div key={p.paymentId} className="sk-page-in" style={{ ...card, animationDelay: `${_pi * 60}ms` }}>
          {/* Amount hero */}
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ fontSize:28, fontWeight:800, letterSpacing:'-0.02em' }}>
              {IUSD(p.amountMicro)}
            </span>
            <span style={{ fontSize:12, color:'var(--muted)', fontWeight:400 }}>iUSD</span>
            <span style={{ marginLeft:'auto', fontSize:11, color:'var(--muted)' }}>
              Expires {p.dbCreatedAt
                ? new Date(parseTimestamp(p.dbCreatedAt).getTime() + 14*24*3600*1000)
                    .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})
                : 'in ~14 days'}
            </span>
          </div>
          {/* Invoice info (if linked) */}
          {(p.invoiceNo || p.invoiceNote) && (
            <div style={{ padding:'6px 10px', background:'var(--bg)',
                          borderRadius:8, fontSize:11, lineHeight:1.5 }}>
              {p.invoiceNo && <span style={{ fontWeight:700, fontFamily:'monospace',
                                             marginRight:8, color:'var(--text)' }}>{p.invoiceNo}</span>}
              {p.invoiceNote && <span style={{ color:'var(--muted)' }}>{p.invoiceNote}</span>}
            </div>
          )}

          {/* FROM / TO */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div style={{ minWidth:0, overflow:'hidden' }}>
              <div style={{ fontSize:8, color:'var(--muted)', fontWeight:700,
                            letterSpacing:'0.12em', marginBottom:4 }}>FROM</div>
              {p.senderShortId
                ? <UserSeal shortId={p.senderShortId} compact style={{ borderRadius:7 }} />
                : <div style={{ fontSize:10, color:'var(--muted)', fontStyle:'italic' }}>{t('inbox.anonymous')}</div>}
            </div>
            <div style={{ minWidth:0, overflow:'hidden' }}>
              <div style={{ fontSize:8, color:'var(--muted)', fontWeight:700,
                            letterSpacing:'0.12em', marginBottom:4 }}>TO</div>
              {account?.shortId
                ? <UserSeal shortId={account.shortId} compact style={{ borderRadius:7 }} />
                : <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'monospace' }}>
                    {defaultClaimAddr.slice(0,10)}…
                  </div>}
            </div>
          </div>

          {/* Payment ID (compact) */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginBottom:2 }}>
            <span style={{ fontSize:8, color:'var(--muted)', fontWeight:700,
                           letterSpacing:'0.12em' }}>PAYMENT ID</span>
            <button onClick={() => navigator.clipboard.writeText(p.paymentId)}
              style={{ background:'none', border:'none', cursor:'pointer',
                       fontSize:9, color:'var(--muted)', padding:0 }}>📋</button>
          </div>
          <div style={{ fontFamily:'monospace', fontSize:9, color:'var(--muted)',
                        wordBreak:'break-all', padding:'4px 6px',
                        background:'var(--bg)', borderRadius:5 }}>
            {p.paymentId}
          </div>

          {/* Claim section */}
          {claiming === p.paymentId ? (
            <div style={{ fontSize:12, color:'var(--muted)', textAlign:'center', padding:'8px 0' }}>
              ⏳ Sending…
            </div>
          ) : (
            <>
              {/* Claim destination: own wallet by default, changeable via modal */}
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 8px',
                            background:'var(--bg)', borderRadius:8, fontSize:10 }}>
                <span style={{ color:'var(--muted)', flexShrink:0 }}>{t('inbox.claimTo')}</span>
                <span style={{ fontFamily:'monospace', flex:1, fontSize:9,
                               overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {address ? `${address.slice(0,10)}…${address.slice(-6)}` : '—'}
                </span>
                <button onClick={() => setClaimAddrModal({ p, input: '' })}
                  style={{ flexShrink:0, padding:'3px 8px', borderRadius:6, fontSize:9,
                           fontWeight:600, border:'1px solid var(--border)',
                           background:'var(--surface)', color:'var(--text)', cursor:'pointer' }}>
                  Change
                </button>
              </div>
              {claimErr && (
                <div style={{ fontSize:11, color:'#ef4444' }}>⚠ {claimErr}</div>
              )}
              {/* Auto-claim preference */}
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                              padding:'8px 0', borderTop:'1px solid var(--border)' }}>
                <div onClick={e => { e.preventDefault(); toggleAutoClaimPref() }}
                  style={{ width:36, height:20, borderRadius:10, position:'relative',
                           background: autoClaimPref ? '#22c55e' : 'var(--border)',
                           transition:'background 0.2s', flexShrink:0, cursor:'pointer' }}>
                  <div style={{ width:16, height:16, borderRadius:'50%', background:'white',
                                position:'absolute', top:2, transition:'left 0.2s',
                                left: autoClaimPref ? 18 : 2,
                                boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }}/>
                </div>
                <div>
                  <div style={{ fontSize:11, fontWeight:600 }}>{t('inbox.autoClaimFuture')}</div>
                  <div style={{ fontSize:9, color:'var(--muted)' }}>
                    Incoming payments are claimed for you automatically (~2 min)
                  </div>
                </div>
              </label>
              <div style={{ display:'flex', gap:8 }}>
                <button
                  onClick={() => handleClaim(p)}
                  disabled={!!claiming}
                  style={{ ...btnFill, flex:1, opacity: claiming ? 0.5 : 1 }}>
                  Claim {IUSD(p.amountMicro)} iUSD
                </button>
                {p.expiresAt > 0 && (
                  <div style={{ fontSize:10, color:'var(--muted)', textAlign:'center', marginTop:2, lineHeight:1.4 }}>
                    Expires {p.dbCreatedAt
                      ? new Date(parseTimestamp(p.dbCreatedAt).getTime() + 14*24*3600*1000)
                          .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})
                      : 'in ~14 days'}<br/>
                    <span style={{ fontSize:9, opacity:0.7 }}>{t('inbox.autoExpires')}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {/* Old history section removed — now shown above pending */}
    </div>

    {/* ── Reply Detail Modal ─────────────────────────────────────────────── */}
    {previewPacketId && (
      <ReceivedGiftPreviewModal
        packetId={previewPacketId}
        onClose={() => setPreviewPacketId(null)}
      />
    )}
    {replyModal && (
      <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center',
                    justifyContent:'center', background:'rgba(0,0,0,0.5)',
                    backdropFilter:'blur(4px)', padding:'20px' }}
        onClick={e => { if (e.target === e.currentTarget) setReplyModal(null) }}>
        <div style={{ background:'var(--surface)', borderRadius:20, padding:'20px',
                      maxWidth:420, width:'100%', maxHeight:'80vh', display:'flex',
                      flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
          {/* Header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginBottom:14, flexShrink:0 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>
                {replyModal.gift?.gift?.name ?? `Gift #${replyModal.gift?.box_id}`}
              </div>
              <div style={{ fontSize:10, color:'var(--muted)' }}>
                {t('inbox.replyCount', { count: replyList.length })}
              </div>
            </div>
            <button onClick={() => setReplyModal(null)}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--muted)',
                       fontSize:18, padding:'4px 8px' }}>✕</button>
          </div>

          {/* Reply list */}
          <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
            {replyLoading && (
              <div style={{ textAlign:'center', padding:20, fontSize:12, color:'var(--muted)' }}>{t('common.loading')}</div>
            )}
            {!replyLoading && replyList.length === 0 && (
              <div style={{ textAlign:'center', padding:20, fontSize:12, color:'var(--muted)' }}>No replies yet</div>
            )}
            {!replyLoading && replyList.map((r: any, i: number) => (
              <div key={i} style={{
                background:'var(--bg)', borderRadius:10, padding:'10px 12px',
                display:'flex', gap:10, alignItems:'flex-start',
              }}>
                {/* Avatar */}
                <div style={{
                  width:32, height:32, borderRadius:'50%', flexShrink:0,
                  background: `hsl(${(r.avatar_seed ?? 0) * 37 % 360}, 50%, 85%)`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:14, fontWeight:700, color:'rgba(0,0,0,0.5)',
                }}>
                  {(r.claimer_nickname ?? '?')[0].toUpperCase()}
                </div>
                {/* Content */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                    <span style={{ fontSize:12, fontWeight:600 }}>{r.claimer_nickname ?? 'Anonymous'}</span>
                    {r.claimer_short_id && (
                      <span style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace' }}>
                        @{r.claimer_short_id.slice(0,4)}…{r.claimer_short_id.slice(-4)}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:13, lineHeight:1.5 }}>
                    {r.thank_emoji && <span style={{ marginRight:4 }}>{r.thank_emoji}</span>}
                    {r.thank_message}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                    {r.amount != null && (
                      <span style={{ fontSize:9, color:'#22c55e', fontWeight:600 }}>
                        +{(Number(r.amount) / 1e6).toFixed(2)} iUSD
                      </span>
                    )}
                    {r.claimed_at && (
                      <span style={{ fontSize:9, color:'var(--muted)' }}>
                        {(() => {
                          const d = new Date(r.claimed_at)
                          if (isNaN(d.getTime())) return ''
                          const diff = Date.now() - d.getTime()
                          if (diff < 60_000) return 'just now'
                          if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
                          if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
                          return `${Math.floor(diff / 86_400_000)}d ago`
                        })()}
                      </span>
                    )}
                  </div>
                </div>
                {/* Add contact button */}
                {r.claimer_address && address && r.claimer_address.toLowerCase() !== address.toLowerCase() && (() => {
                  const sid = (r.claimer_short_id ?? '').toUpperCase()
                  const already = sid && loadContacts(address).some(c => c.shortId?.toUpperCase() === sid)
                  return already ? (
                    <span style={{ flexShrink:0, fontSize:9, color:'#22c55e', fontWeight:600, padding:'4px 8px' }}>
                      ✓ Contact
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const btn = e.currentTarget
                        upsertContact(address, {
                          shortId: r.claimer_short_id ?? '',
                          nickname: r.claimer_nickname ?? r.claimer_short_id ?? '',
                          shortSealSvg: null,
                        }, token ?? undefined)
                        btn.textContent = '✓ Added'
                        btn.disabled = true
                        btn.style.color = '#22c55e'
                        btn.style.borderColor = '#22c55e'
                      }}
                      style={{
                        flexShrink:0, padding:'4px 8px', borderRadius:6, fontSize:9,
                        fontWeight:600, border:'1px solid var(--border)',
                        background:'var(--surface)', color:'var(--text)', cursor:'pointer',
                        whiteSpace:'nowrap',
                      }}>
                      + Contact
                    </button>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* ── Change Claim Address Modal ─────────────────────────────────────── */}
    {claimAddrModal && (
      <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center',
                    justifyContent:'center', background:'rgba(0,0,0,0.5)',
                    backdropFilter:'blur(4px)', padding:'20px' }}
        onClick={e => { if (e.target === e.currentTarget) setClaimAddrModal(null) }}>
        <div style={{ background:'var(--surface)', borderRadius:20, padding:'24px',
                      maxWidth:400, width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:'0.14em',
                        color:'var(--muted)', marginBottom:12 }}>📍 CLAIM TO CUSTOM ADDRESS</div>
          <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.6, marginBottom:16 }}>
            Funds will be sent to this address instead of your connected wallet.
            Signature required to confirm.
          </div>
          <input
            value={claimAddrModal.input}
            onChange={e => setClaimAddrModal(m => m ? { ...m, input: e.target.value } : null)}
            placeholder="0x... or init1... address"
            style={{ width:'100%', boxSizing:'border-box', padding:'10px 12px',
                     background:'var(--bg-elevated)', border:'1px solid var(--border)',
                     borderRadius:10, color:'var(--text)', fontSize:12, fontFamily:'monospace',
                     outline:'none', marginBottom:12 }}
          />
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => setClaimAddrModal(null)}
              style={{ flex:1, padding:'10px', borderRadius:10, border:'1px solid var(--border)',
                       background:'transparent', color:'var(--muted)', fontSize:11, cursor:'pointer' }}>
              Cancel
            </button>
            <button
              disabled={claimAddrSigning || !claimAddrModal.input.trim()}
              onClick={async () => {
                const customAddr = claimAddrModal.input.trim()
                const p = claimAddrModal.p
                if (!customAddr || !p.claimKey) return
                setClaimAddrSigning(true)
                try {
                  // IK sign to authorize custom claim address
                  const msg = `iPay: I authorize claiming payment ${p.paymentId.slice(0,16)}… to address ${customAddr}`
                  await ikSign(offlineSigner, msg)
                  setClaimAddrModal(null)
                  // Use relayer to sponsor_claim to custom address
                  setClaiming(p.paymentId)
                  setClaimErr('')
                  const res = await fetch(`${API_BASE}/account/claim`, {
                    method: 'POST',
                    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
                    body: JSON.stringify({ paymentId: p.paymentId, claimKey: p.claimKey, claimToAddress: customAddr }),
                  })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.detail ?? data.error ?? 'Claim failed')
                  setClaimDone(data.txHash ?? 'ok')
                  setPayments(prev => prev.filter(x => x.paymentId !== p.paymentId))
                  refreshBadge()
                } catch (e: any) {
                  setClaimErr(e.message ?? 'Failed')
                } finally {
                  setClaimAddrSigning(false)
                  setClaiming(null)
                }
              }}
              style={{ flex:2, padding:'10px', borderRadius:10, border:'none', cursor:'pointer',
                       background:'var(--text)', color:'var(--surface)', fontSize:11, fontWeight:700,
                       opacity: claimAddrSigning || !claimAddrModal.input.trim() ? 0.5 : 1 }}>
              {claimAddrSigning ? '✍️ Signing…' : '✍️ Sign & Claim'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ── Styles (match Transfer.tsx) ───────────────────────────────────────────
const card: React.CSSProperties = {
  width:'100%', maxWidth:480, background:'var(--surface)',
  border:'1px solid var(--border)', borderRadius:14, padding:'16px 20px',
  display:'flex', flexDirection:'column', gap:12, boxSizing:'border-box',
}

const btnFill: React.CSSProperties = {
  background:'var(--text)', color:'var(--surface)', border:'none', borderRadius:12,
  padding:'12px 24px', fontSize:13, fontWeight:700, cursor:'pointer', textAlign:'center',
}
const btnGhost: React.CSSProperties = {
  background:'none', color:'var(--muted)', border:'1px solid var(--border)', borderRadius:12,
  padding:'10px 24px', fontSize:13, cursor:'pointer', textAlign:'center',
}
const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
