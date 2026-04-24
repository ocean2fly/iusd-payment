/**
 * History — /app/accounting
 * Sent + received transactions for the current user.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { StyledQR } from '../components/StyledQR'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useAuthContext } from '../hooks/AuthContext'
import { UserSeal } from '../components/UserSeal'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { API_BASE } from '../config'
import { useActivity, useActivityStats } from '../hooks/useActivity'
import { fetchInvoices, updateInvoiceStatus, clearInvoiceLocalCache } from '../lib/invoiceStore'
import { SkeletonHistory } from '../components/Skeleton'
import { upsertContactAsync } from '../lib/contactsStore'
import { showToast } from '../components/Toast'
import { GiftHistoryList } from '../components/GiftHistoryList'
import { ReceivedGiftPreviewModal } from '../components/ReceivedGiftPreviewModal'
import { ShareLinksModal } from './Gift'
import { GiftRowCard } from '../components/GiftRowCard'
import type { GiftSendResult } from './Gift'
import { activityToReceivedGift, activityToSentPacket } from '../lib/giftTypes'
import type { ReceivedGift, SentPacket } from '../lib/giftTypes'
import { useUnreadSync } from '../hooks/useUnreadSync'
import { parseTimestamp } from '../lib/dateUtils'
import { fetchPaymentFullFromChain } from '../lib/payChainStatus'

const IUSD = (micro: string | number) => (parseInt(String(micro)) / 1_000_000).toFixed(2)

function relTime(ts: string | null | undefined): string | undefined {
  if (!ts) return undefined
  const d = parseTimestamp(ts)
  if (isNaN(d.getTime())) return undefined
  const diff = Date.now() - d.getTime()
  if (diff < 60_000)         return 'just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

function formatTime(dbCreatedAt: string | null, blockHeight: number): string {
  if (dbCreatedAt) {
    const d = parseTimestamp(dbCreatedAt)
    if (!isNaN(d.getTime())) {
      const now = Date.now()
      const diff = now - d.getTime()
      if (diff < 60_000)        return 'just now'
      if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`
      if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`
      if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
      return d.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
        year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      })
    }
  }
  return blockHeight ? `block ${blockHeight}` : '—'
}

// ── Status helpers ────────────────────────────────────────────────────────────
// Stable id per (direction, status) code; resolved via t() at render time
// (module-level functions can't call hooks, so we return an id here and let
// consumers translate it).
const STATUS_SENT_ID: Record<number, string>     = { 2:'pending', 3:'confirmed', 5:'revoked', 6:'refunded', 7:'expired' }
const STATUS_RECEIVED_ID: Record<number, string> = { 2:'claimable', 3:'received', 5:'cancelled', 6:'refunded', 7:'expired' }
function getStatusLabelId(status: number, dir: 'sent'|'received'): string {
  return (dir === 'sent' ? STATUS_SENT_ID : STATUS_RECEIVED_ID)[status] ?? 'unknown'
}
function useStatusLabel() {
  // Lazy import to avoid loading i18n before the component mounts.
  const { t } = useTranslation()
  return (status: number, dir: 'sent'|'received') => {
    const id = getStatusLabelId(status, dir)
    return t(`history.payStatus.${dir}.${id}`, { defaultValue: id })
  }
}
const STATUS_COLOR: Record<number, string> = {
  0:'var(--muted)', 1:'#f59e0b', 2:'#f59e0b', 3:'#22c55e',
  4:'#ef4444', 5:'#6b7280', 6:'#a855f7', 7:'#6b7280',
}
const INV_STATUS_COLOR: Record<string,string> = {
  draft:     '#94a3b8',
  sent:      '#3b82f6',
  paying:    '#f59e0b',
  paid:      '#22c55e',
  overdue:   '#ef4444',
  refunded:  '#8b5cf6',
  cancelled: '#64748b',
}
const INV_STATUS_LABEL: Record<string,string> = {
  draft:     'Draft',
  sent:      'Awaiting Payment',
  paying:    'Awaiting Confirm',
  paid:      'Paid',
  overdue:   'Overdue',
  refunded:  'Refunded',
  cancelled: 'Cancelled',
}

interface TxItem {
  paymentId:           string
  direction:           'sent' | 'received'
  amountMicro:         string
  feeMicro:            string
  status:              number
  counterpartyShortId: string | null
  counterpartyNickname: string | null
  createdAt:           number
  dbCreatedAt:         string | null
  expiresAt:           number
  merchantInfo?:       { name?: string; invoiceNo?: string } | null
  invoiceType?:        string
  // Invoice linkage fields (sent payments via PayLink)
  invoiceToken?:       string | null
  invoiceNo?:          string | null
  invoiceNote?:        string | null
  invoicePayLink?:     string | null
  invoiceDueDate?:     string | null
  invoicePayerName?:   string | null
  invoicePaidAt?:      string | null
  invoiceTxHash?:      string | null
  invoiceFeeMode?:     string | null
  invoiceStatus?:      string | null
  merchantData?:       string | null   // raw merchant JSON from invoice_tokens
  invoiceMode?:        string | null   // 'personal' | 'business'
  claimedAt?:          string | null   // auto_claimed_at from payment_intents
}



// ── Export history as CSV ─────────────────────────────────────────────────────
function escCsv(v: any): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}
function exportHistoryCSV(items: TxItem[], invList: any[], myShortId?: string | null) {
  const rows: string[][] = []
  // Header
  rows.push(['Date','Type','Direction','Amount (iUSD)','Fee (iUSD)','Status','Invoice No','Note / Merchant','Counterparty ID','Payment ID','TX Hash'])

  // Invoices
  for (const inv of invList) {
    const date = inv.createdAt ? new Date(inv.createdAt).toISOString() : ''
    const fee  = inv.feeMode === 'recipient' ? `${((parseFloat(inv.amount)*0.005)).toFixed(6)}` : '0'
    rows.push([
      date,
      'Invoice',
      'out',
      escCsv(inv.amount ?? ''),
      fee,
      escCsv(inv.status),
      escCsv(inv.invoiceNo ?? ''),
      escCsv(inv.note ?? ''),
      escCsv(inv.payerShortId ?? ''),
      escCsv(inv.paymentId ?? ''),
      escCsv(inv.txHash ?? ''),
    ])
  }

  // Transactions
  const invPayIds = new Set(invList.map((inv: any) => String(inv.paymentId ?? '').replace(/^0x/i,'').toLowerCase()).filter(Boolean))
  for (const item of items) {
    const pid = String(item.paymentId ?? '').replace(/^0x/i,'').toLowerCase()
    if (invPayIds.has(pid)) continue  // already in invoice rows
    const date = item.dbCreatedAt
      ? parseTimestamp(item.dbCreatedAt).toISOString()
      : ''
    // CSV export runs at module scope, no t() — keep the stable English id.
    const statusLabel = getStatusLabelId(item.status, item.direction)
    const merchantNote = item.merchantInfo?.name
      ? (item.merchantInfo.invoiceNo ? `${item.merchantInfo.name} #${item.merchantInfo.invoiceNo}` : item.merchantInfo.name)
      : ''
    rows.push([
      date,
      'Transfer',
      item.direction,
      escCsv(IUSD(item.amountMicro)),
      escCsv(IUSD(item.feeMicro)),
      escCsv(statusLabel),
      '',
      escCsv(merchantNote),
      escCsv(item.counterpartyShortId ?? ''),
      escCsv(item.paymentId),
      '',
    ])
  }

  const csv = rows.map(r => r.map(escCsv).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `ipay-history-${myShortId ?? 'export'}-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ─────────────────────────────────────────────────────────────────────────────
export function History() {
  const { t } = useTranslation()
  const statusLabel = useStatusLabel()
  const navigate          = useNavigate()
  const smartClose        = useSmartClose('/app')
  const { address, token, account } = useAuthContext()
  const { requestTxBlock }          = useInterwovenKit()
  const { stats: activityStats }    = useActivityStats()
  const unreadSync                  = useUnreadSync()

  const [items,         setItems]         = useState<TxItem[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [detail,        setDetail]        = useState<TxItem | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionErr,     setActionErr]     = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<'all'|'sent'|'received'|'gift'|'invoices'|'stats'>('all')
  const [sortDir,       setSortDir]       = useState<'desc'|'asc'>('desc')
  const [invList,       setInvList]       = useState<any[]>([])
  const [selectedInvId, setSelectedInvId] = useState<string | null>(null)
  const [previewPacketId, setPreviewPacketId] = useState<string | null>(null)
  // Local ShareLinksModal state for sent-gift clicks — stays on /app/history,
  // no redirect to /app/gift. Synthesized the same way Gift.tsx does it.
  const [sentModalResult, setSentModalResult] = useState<GiftSendResult | null>(null)

  // Lightweight in-memory set of my existing contact shortIds, loaded
  // once from /contacts. Used by handleSealClick to decide whether to
  // toast "Added to contacts" (new) or "Copied" (already there). We
  // only need presence, not the full Contact records.
  const myContactsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!account?.shortId || !token) return
    let cancelled = false
    fetch(`${API_BASE}/contacts/${encodeURIComponent(account.shortId)}?limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : { contacts: [] })
      .then((data: any) => {
        if (cancelled) return
        const s = new Set<string>()
        for (const c of (data?.contacts ?? [])) {
          const sid = String(c.nickname ?? c.contactAddr ?? '').toUpperCase()
          if (sid) s.add(sid)
        }
        myContactsRef.current = s
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [account?.shortId, token])

  /**
   * Chain-side fallback hydration for the detail drawer.
   *
   * Backend /v1/activity already tries to hydrate `amountMicro` +
   * `status` via a server-side view call. When that returns 0 (DB
   * gap, version skew, cache, etc.) the drawer would previously
   * render "+0.00 iUSD". We instead call pay_v3::get_payment_full
   * directly from the browser and patch the detail state.
   *
   * Runs only when a detail drawer is open AND amountMicro is 0,
   * so there's no per-list-item RPC traffic.
   */
  useEffect(() => {
    if (!detail) return
    if (detail.amountMicro && detail.amountMicro !== '0') return
    if (!detail.paymentId) return
    let cancelled = false
    ;(async () => {
      const chain = await fetchPaymentFullFromChain(detail.paymentId)
      if (cancelled || !chain) return
      setDetail(d => (d && d.paymentId === detail.paymentId) ? {
        ...d,
        amountMicro: chain.amount,
        feeMicro: chain.fee,
        status: chain.status || d.status,
        createdAt: chain.createdAt || d.createdAt,
        expiresAt: chain.expiresAt || d.expiresAt,
      } : d)
    })()
    return () => { cancelled = true }
  }, [detail?.paymentId])

  /**
   * Click handler for the `nickname@DNA-ID` block in a history entry.
   * Copies the counterparty's shortId to the clipboard AND ensures they
   * are in the server-side contact list. Does nothing if the clicked
   * shortId belongs to the current user.
   *
   * Called with stopPropagation from a wrapper div so the row's own
   * click (which opens the detail drawer) does not also fire.
   */
  const handleSealClick = useCallback(async (shortId: string, nickname?: string | null) => {
    if (!shortId) return
    const sid = shortId.toUpperCase()
    if (account?.shortId && sid === account.shortId.toUpperCase()) {
      showToast(t('toast.thatsYou'), 'info')
      return
    }

    // Copy to clipboard (best-effort) — runs on every click.
    try {
      await navigator.clipboard.writeText(sid)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = sid
        ta.style.position = 'fixed'; ta.style.top = '-9999px'
        document.body.appendChild(ta); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {}
    }

    // Differentiate new vs existing contact so the toast is accurate.
    const wasInContacts = myContactsRef.current.has(sid)

    // Upsert runs regardless — it's idempotent on the server.
    if (account?.shortId && token) {
      upsertContactAsync(account.shortId, token, {
        shortId: sid,
        nickname: nickname || sid,
        shortSealSvg: null,
      }).catch(() => {})
      // Track locally so repeat clicks show the "Copied" branch.
      myContactsRef.current.add(sid)
    }

    if (wasInContacts) {
      showToast(t('toast.copied', { value: sid }), 'success')
    } else {
      const display = nickname && nickname !== sid ? `${nickname} (${sid})` : sid
      showToast(t('toast.addedToContacts', { name: display }), 'success')
    }
  }, [account?.shortId, token])

  // Gift history via unified /v1/activity, one hook per direction, same as
  // Gift.tsx's history tab.
  const {
    items: giftSentItemsRaw,
    hasMore: giftSentHasMore,
    loadingMore: giftSentLoadingMore,
    loadMore: loadMoreGiftSent,
    refresh: refreshGiftSent,
  } = useActivity({ types: ['gift_sent'], limit: 20, sort: sortDir })
  const {
    items: giftReceivedItemsRaw,
    hasMore: giftReceivedHasMore,
    loadingMore: giftReceivedLoadingMore,
    loadMore: loadMoreGiftReceived,
    refresh: refreshGiftReceived,
  } = useActivity({ types: ['gift_received'], limit: 20, sort: sortDir })
  const giftSentList: SentPacket[] = giftSentItemsRaw.map(activityToSentPacket)
  const giftReceivedList: ReceivedGift[] = giftReceivedItemsRaw.map(activityToReceivedGift)

  // Pagination state (cursor-based via /v1/activity)
  const PAGE_SIZE = 30
  const cursorRef = useRef<string | null>(null)
  const itemsRef = useRef<TxItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => { itemsRef.current = items }, [items])

  // Map ActivityItem (payment_sent / payment_received / payment_pending) → TxItem
  const activityToTx = useCallback((item: any): TxItem => {
    const d = item.data || {}
    const dir: 'sent' | 'received' = item.type === 'payment_sent' ? 'sent' : 'received'
    // Chain status: -1 (fetching) → 0, otherwise numeric
    const cs = typeof d.chainStatus === 'number' ? d.chainStatus : parseInt(d.chainStatus ?? '-1')
    const status = cs === -1 ? 0 : cs
    return {
      paymentId:           d.paymentId ?? item.id,
      direction:           dir,
      amountMicro:         item.amountMicro ?? '0',
      feeMicro:            d.feeMicro ?? '0',
      status,
      counterpartyShortId: item.counterparty?.shortId ?? null,
      counterpartyNickname: item.counterparty?.nickname ?? null,
      createdAt:           0,  // block height unknown; UI uses dbCreatedAt for display
      expiresAt:           0,
      dbCreatedAt:         item.at ?? null,
      merchantInfo:        d.merchantSnapshot ? (() => { try { return typeof d.merchantSnapshot === 'string' ? JSON.parse(d.merchantSnapshot) : d.merchantSnapshot } catch { return null } })() : null,
      invoiceType:         d.invoiceType ?? 'personal',
      invoiceToken:        d.invoiceToken ?? null,
      invoiceNo:           d.invoiceNo ?? null,
      invoiceNote:         d.invoiceNote ?? null,
      invoicePayLink:      d.invoicePayLink ?? null,
      invoiceDueDate:      d.invoiceDueDate ?? null,
      invoicePayerName:    d.invoicePayerName ?? null,
      invoicePaidAt:       d.invoicePaidAt ?? null,
      invoiceTxHash:       d.invoiceTxHash ?? null,
      invoiceFeeMode:      d.invoiceFeeMode ?? null,
      invoiceStatus:       d.invoiceStatus ?? null,
      merchantData:        d.merchantData ?? null,
      invoiceMode:         d.invoiceMode ?? null,
      claimedAt:           d.claimedAt ?? null,
    }
  }, [])

  // ── Load tx history via unified /v1/activity ───────────────────────────
  const load = useCallback(async (append = false) => {
    if (!address || !token) return
    if (append) setLoadingMore(true); else { setLoading(true); setError(null) }
    try {
      const params = new URLSearchParams()
      params.set('types', 'payment_sent,payment_received,payment_pending')
      params.set('limit', String(PAGE_SIZE))
      if (append && cursorRef.current) params.set('cursor', cursorRef.current)
      const res = await fetch(`${API_BASE}/activity?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`activity ${res.status}`)
      const d = await res.json()
      const mapped: TxItem[] = (d.items ?? []).map(activityToTx)
      setItems(prev => append ? [...prev, ...mapped] : mapped)
      setHasMore(!!d.hasMore)
      cursorRef.current = d.nextCursor ?? null

      // NOTE: passive auto-seed on history load was removed. It was
      // spamming /contacts with N fire-and-forget POSTs every time the
      // page loaded (one per list item), confusing Network tab output.
      // Contacts are now seeded explicitly by:
      //   (1) the nickname@DNA seal click (handleSealClick)
      //   (2) the "Import from History" button on /app/contacts
      //   (3) Transfer / Gift dropdown "From History" section — which
      //       reads from /v1/activity directly, no DB write required
    } catch (e: any) {
      setError(e.message)
    } finally {
      if (append) setLoadingMore(false); else setLoading(false)
    }
  }, [account?.address, token, address, activityToTx])

  useEffect(() => { load() }, [load])

  // Gift history is loaded via useActivity hooks above. Refresh both lists
  // whenever the red-dot revision bumps (e.g. after markSeen) so counters
  // update without a manual reload.
  useEffect(() => {
    if (unreadSync.revision === 0) return
    refreshGiftSent()
    refreshGiftReceived()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadSync.revision])

  // ── Load invoices on mount ─────────────────────────────────────────────────
  const [invRefreshing, setInvRefreshing] = useState(false)
  const reloadInvList = useCallback(async () => {
    if (!token) { setInvList([]); return }
    setInvRefreshing(true)
    fetchInvoices(token).then(setInvList).catch(() => {}).finally(() => setInvRefreshing(false))
  }, [token])
  useEffect(() => { reloadInvList() }, [token])

  // ── Revoke / Refund ───────────────────────────────────────────────────────
  async function handleRevoke(paymentId: string) {
    if (!address || !token) return
    setActionLoading(true); setActionErr(null)
    try {
      const { getPayPoolAddress, getModuleAddress } = await import('../services/contractConfig')
      const { bcsEncodeVecU8, bcsEncodeAddress } = await import('../services/orderCrypto')
      const poolAddress = getPayPoolAddress()
      const moduleAddress = getModuleAddress()
      const id = paymentId.replace(/^0x/,'')
      const plainBytes = new Uint8Array(id.match(/../g)!.map((b:string) => parseInt(b,16)))
      // Chain-side key is sha256(plain) — see lib/payKeyHash.ts. Both
      // revoke() and refund() take the hashed id as their payment_id arg.
      const idBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', plainBytes as any))
      const txMsg = {
        typeUrl: '/initia.move.v1.MsgExecute',
        value: {
          sender: address,
          moduleAddress,
          moduleName: 'pay_v3',
          functionName: 'revoke',
          typeArgs: [],
          args: [ bcsEncodeAddress(poolAddress), bcsEncodeVecU8(idBytes) ],
        }
      }
      const txRes = await requestTxBlock({ messages: [txMsg] })
      if (txRes?.code !== 0) throw new Error((txRes as any)?.rawLog ?? t('history.revokeFailed'))
      setDetail(d => d ? { ...d, status: 5 } : null)
      await load()
    } catch (e: any) { setActionErr(e.message) }
    finally { setActionLoading(false) }
  }

  async function handleRefund(paymentId: string) {
    if (!address || !token) return
    setActionLoading(true); setActionErr(null)
    try {
      const { refundPayment } = await import('../services/payRefund')
      await refundPayment(requestTxBlock as any, address, paymentId)
      setDetail(d => d ? { ...d, status: 6 } : null)
      await load()
    } catch (e: any) { setActionErr(e.message) }
    finally { setActionLoading(false) }
  }

  // Synthesize a GiftSendResult from a SentPacket and open ShareLinksModal
  // locally on this page (no navigation away from /app/history).
  function handleSentGiftClick(pkt: SentPacket) {
    const totalIusd = Number(pkt.total_amount ?? 0)
    const feeBps = pkt.fee_bps ?? 0
    const totalFee = totalIusd * feeBps / 10000
    const links: string[] = pkt.claim_links && pkt.claim_links.length > 0
      ? pkt.claim_links
      : (pkt.claim_url ? [pkt.claim_url] : [])
    const synthesized: GiftSendResult = {
      links,
      box: {
        box_id: pkt.box_id,
        name: pkt.gift?.name ?? `Gift #${pkt.box_id}`,
        amount: Math.round(totalIusd * 1_000_000),
        fee_bps: feeBps,
        urls: pkt.gift?.image_urls ?? [],
        enabled: true,
        description: pkt.gift?.description ?? '',
        collection: pkt.gift?.collection ?? '',
        image_urls: pkt.gift?.image_urls ?? [],
      } as any,
      amount: totalIusd,
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
    setSentModalResult(synthesized)
    if ((pkt.unseen_activity_count ?? pkt.unseen_reply_count ?? 0) > 0) {
      unreadSync.markSeen(pkt.packet_id)
    }
  }

  // ── Detail view ───────────────────────────────────────────────────────────
  if (detail) {
    const statusCol  = STATUS_COLOR[detail.status] ?? 'var(--muted)'
    const isSent     = detail.direction === 'sent'
    const createdStr = formatTime(detail.dbCreatedAt, detail.createdAt)
    const expiresStr = detail.dbCreatedAt
      ? new Date(parseTimestamp(detail.dbCreatedAt).getTime() + 14*24*3600*1000)
          .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})
      : `block ${detail.expiresAt}`

    // FROM / TO identity
    const fromShortId = isSent ? (account?.shortId ?? null)     : detail.counterpartyShortId
    const toShortId   = isSent ? detail.counterpartyShortId      : (account?.shortId ?? null)

    // Timeline nodes with meta merged
    type TLNode = { label: string; time?: string; active?: boolean; done?: boolean; color?: string; meta?: string }
    const tlNodes: TLNode[] = [
      { label: t('history.timeline.created'), time: createdStr, done:true, color:'#6b7280',
        meta: `${IUSD(detail.amountMicro)} iUSD${parseFloat(detail.feeMicro) > 0 ? ` · ${t('history.timeline.fee', { amount: IUSD(detail.feeMicro) })}` : ''}` },
    ]
    // For claimed payments: claimedAt = confirmed time; invoicePaidAt as fallback
    const confirmedAt = detail.claimedAt ?? detail.invoicePaidAt ?? null
    if (detail.status === 2) {
      tlNodes.push({ label: t('history.timeline.pendingClaim'), active:true, color:'#f59e0b',
        meta: isSent ? t('history.timeline.awaitingRecipient') : t('history.timeline.autoClaimed') })
    } else if (detail.status === 3) {
      tlNodes.push({ label: t('history.timeline.pendingClaim'), done:true, color:'#6b7280',
        time: relTime(confirmedAt) })
      tlNodes.push({ label: isSent ? t('history.timeline.confirmed') : t('history.timeline.received'), done:true, color:'#22c55e',
        time: relTime(confirmedAt),
        meta: t('history.timeline.expiresOn', { date: expiresStr }) })
    } else if (detail.status === 5) {
      tlNodes.push({ label: t('history.timeline.revoked'), done:true, color:'#6b7280', time: relTime(confirmedAt), meta: t('history.timeline.returnedToSender') })
    } else if (detail.status === 6) {
      tlNodes.push({ label: t('history.timeline.pendingClaim'), done:true, color:'#6b7280', time: relTime(confirmedAt) })
      tlNodes.push({ label: t('history.timeline.claimed'), done:true, color:'#6b7280', time: relTime(confirmedAt) })
      tlNodes.push({ label: t('history.timeline.refunded'), done:true, color:'#a855f7', time: relTime(confirmedAt), meta: t('history.timeline.returnedToClaimer') })
    } else if (detail.status === 7) {
      tlNodes.push({ label: t('history.timeline.expired'), done:true, color:'#6b7280', time: relTime(confirmedAt), meta: expiresStr })
    }

    return (
      <div style={page}>
        {/* Header */}
        <div style={hdr}>
          <button onClick={() => { setDetail(null); setActionErr(null) }} style={backBtn}>←</button>
          <span style={{ fontSize:13, fontWeight:700, flex:1 }}>
            {isSent ? t('history.detailSent') : t('history.detailReceived')}
          </span>
          <span style={{ fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:700,
            background: statusCol+'20', color: statusCol }}>
            {statusLabel(detail.status, detail.direction)}
          </span>
        </div>

        {/* Hero: amount + from/to */}
        <div style={{ ...card, padding:'16px 18px', gap:8 }}>
          {/* Amount */}
          <div style={{ fontSize:34, fontWeight:800, letterSpacing:'-0.03em', textAlign:'center' }}>
            {isSent ? '-' : '+'}{IUSD(detail.amountMicro)}
            <span style={{ fontSize:13, fontWeight:400, marginLeft:5, color:'var(--muted)' }}>iUSD</span>
          </div>
          {/* Merchant pill */}
          {detail.merchantInfo?.name && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                          background:'var(--bg-elevated)', borderRadius:20, padding:'4px 12px',
                          alignSelf:'center' }}>
              <span style={{ fontSize:13 }}>🏪</span>
              <span style={{ fontSize:11, fontWeight:700 }}>{detail.merchantInfo.name}</span>
              {detail.merchantInfo.invoiceNo && (
                <span style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace' }}>
                  #{detail.merchantInfo.invoiceNo}
                </span>
              )}
            </div>
          )}
          {/* From / To row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:4 }}>
            {[{ label: t('history.fromLabel'), shortId: fromShortId }, { label: t('history.toLabel'), shortId: toShortId }].map(({label, shortId}) => {
              // The counterparty seal is the one that's NOT the current user —
              // only that one gets the real nickname from activity.counterparty.
              const isCounterparty = shortId === detail.counterpartyShortId
              const nick = isCounterparty ? detail.counterpartyNickname : (account?.nickname ?? null)
              return (
                <div key={label} style={{ minWidth:0, overflow:'hidden' }}>
                  <div style={{ fontSize:8, color:'var(--muted)', fontWeight:700,
                                letterSpacing:'0.12em', marginBottom:4 }}>{label}</div>
                  {shortId
                    ? (
                      <div
                        role="button"
                        title={t('history.copySaveTitle')}
                        onClick={(e) => { e.stopPropagation(); handleSealClick(shortId, nick) }}
                        style={{ cursor: 'pointer' }}
                      >
                        <UserSeal shortId={shortId} compact style={{ borderRadius:7 }} />
                      </div>
                    )
                    : <div style={{ fontSize:10, color:'var(--muted)', fontStyle:'italic' }}>—</div>
                  }
                </div>
              )
            })}
          </div>
        </div>

        {/* Journey + Meta merged */}
        <div style={card}>
          <div style={sectionLabel}>{t('history.paymentJourney')}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:0, marginTop:8 }}>
            {tlNodes.map((node, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                {/* Dot + line */}
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                              width:14, flexShrink:0 }}>
                  <div style={{
                    width: node.active ? 10 : 8, height: node.active ? 10 : 8,
                    borderRadius:'50%', marginTop:3, flexShrink:0,
                    background: node.active || node.done ? (node.color ?? '#22c55e') : 'var(--border)',
                    border: node.active ? `2px solid ${node.color ?? '#f59e0b'}` : 'none',
                    boxShadow: node.active ? `0 0 8px ${node.color ?? '#f59e0b'}80` : 'none',
                  }}/>
                  {i < tlNodes.length - 1 && (
                    <div style={{ width:2, flex:1, minHeight:16, margin:'3px 0',
                                  background:'var(--border)', opacity:0.5 }}/>
                  )}
                </div>
                {/* Content: label + time right-aligned + meta below */}
                <div style={{ flex:1, paddingBottom: i < tlNodes.length - 1 ? 10 : 0 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                    <span style={{ fontSize:12, fontWeight: node.active ? 700 : 500,
                                   color: node.active ? (node.color ?? 'var(--text)') : 'var(--text)',
                                   opacity: node.done || node.active ? 1 : 0.4 }}>
                      {node.label}
                    </span>
                    {node.time && (
                      <span style={{ fontSize:10, color:'var(--muted)' }}>{node.time}</span>
                    )}
                  </div>
                  {node.meta && (
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:1 }}>{node.meta}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Expires row for pending state */}
          {detail.status === 2 && (
            <div style={{ marginTop:8, paddingTop:8, borderTop:'1px solid var(--border)',
                          display:'flex', justifyContent:'space-between', fontSize:10 }}>
              <span style={{ color:'var(--muted)' }}>{t('history.expires')}</span>
              <span>{expiresStr}</span>
            </div>
          )}
        </div>

        {/* Actions card */}
        <div style={{ ...card, gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.1em',
                          color:'var(--muted)', flex:1 }}>{t('history.paymentId')}</div>
            <button onClick={() => navigator.clipboard.writeText(detail.paymentId)}
              style={{ ...btnGhost, fontSize:9, padding:'3px 8px' }}>{t('history.copyBtn')}</button>
          </div>
          <div style={{ fontFamily:'monospace', fontSize:9, wordBreak:'break-all',
                        color:'var(--muted)', lineHeight:1.6 }}>{detail.paymentId}</div>
          {/* Action buttons */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {detail.direction === 'sent' && detail.status === 2 && (
              <button onClick={() => handleRevoke(detail.paymentId)} disabled={actionLoading}
                style={{ flex:1, padding:'8px', borderRadius:8, fontSize:11, fontWeight:600,
                         border:'1px solid rgba(239,68,68,0.35)', background:'rgba(239,68,68,0.07)',
                         color:'#ef4444', cursor:'pointer', opacity: actionLoading ? 0.6 : 1 }}>
                {actionLoading ? '…' : t('history.revokeBtn')}</button>
            )}
            {detail.direction === 'received' && detail.status === 3 && (
              <button onClick={() => handleRefund(detail.paymentId)} disabled={actionLoading}
                style={{ flex:1, padding:'8px', borderRadius:8, fontSize:11, fontWeight:600,
                         border:'1px solid rgba(168,85,247,0.35)', background:'rgba(168,85,247,0.07)',
                         color:'#a855f7', cursor:'pointer', opacity: actionLoading ? 0.6 : 1 }}>
                {actionLoading ? '…' : t('history.refundBtn')}</button>
            )}
            <button onClick={() => window.open(`/receipt/${encodeURIComponent(detail.paymentId)}`, '_blank')}
              style={{ flex:1, padding:'8px', borderRadius:8, border:'1px solid var(--border)',
                       background:'transparent', color:'var(--muted)', fontSize:11, cursor:'pointer' }}>
              {t('history.receiptPdf')}</button>
            {/* Invoice PDF — synchronous window.open (iOS-safe) */}
            {detail.direction === 'sent' && detail.invoiceToken && detail.invoiceMode === 'business' && (
              <button onClick={() => window.open(`/invoice/${detail.invoiceToken}`, '_blank')}
                style={{ flex:1, padding:'8px', borderRadius:8, border:'1px solid var(--border)',
                         background:'transparent', color:'var(--muted)', fontSize:11, cursor:'pointer' }}>
                {t('history.invoicePdf')}</button>
            )}
          </div>
          {actionErr && <div style={{ fontSize:10, color:'#ef4444' }}>⚠ {actionErr}</div>}
        </div>
      </div>
    )
  }

  // ── Combined All tab items (tx + invoices by date) ────────────────────────
  type ListRow = { type: 'tx'; item: TxItem; sortKey: number }
              | { type: 'inv'; inv: any;      sortKey: number }
              | { type: 'gift'; gift: any; direction: 'sent' | 'received'; sortKey: number }

  // de-dup: only hide RECEIVED payments already shown as an invoice row in invList.
  // Sent payments (even if invoice-linked) stay visible — they represent outgoing flows.
  const norm = (v: any) => String(v ?? '').replace(/^0x/i, '').trim().toLowerCase()
  const myInvTokens  = new Set(invList.map((inv: any) => norm(inv.invoiceToken ?? inv.token ?? '')).filter(Boolean))
  const myInvPayIds  = new Set(invList.map((inv: any) => norm(inv.paymentId)).filter(Boolean))

  const allRows: ListRow[] = activeTab === 'all'
    ? [
        ...items
          .filter(i => {
            if (i.direction === 'received') {
              if (i.invoiceToken && myInvTokens.has(norm(i.invoiceToken))) return false
              if (myInvPayIds.has(norm(i.paymentId))) return false
            }
            return true
          })
          .map(i => ({ type: 'tx' as const, item: i, sortKey: i.createdAt })),
        ...invList.map((inv: any) => ({ type: 'inv' as const, inv, sortKey: new Date(inv.createdAt).getTime() / 1000 })),
        ...giftReceivedList.map((g) => ({ type: 'gift' as const, gift: g, direction: 'received' as const, sortKey: g.claimed_at ? new Date(g.claimed_at).getTime() / 1000 : 0 })),
        ...giftSentList.map((g) => ({ type: 'gift' as const, gift: g, direction: 'sent' as const, sortKey: g.created_at ? new Date(g.created_at).getTime() / 1000 : 0 })),
      ].sort((a, b) => sortDir === 'desc' ? b.sortKey - a.sortKey : a.sortKey - b.sortKey)
    : []

  const filteredTxRaw = activeTab === 'sent'     ? items.filter(i => i.direction === 'sent')
                      : activeTab === 'received'  ? items.filter(i => i.direction === 'received')
                      : []
  const filteredTx = [...filteredTxRaw].sort((a, b) =>
    sortDir === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
  )

  // ── Accounting stats (invoice-first: use invoice_transactions data when available) ──
  const IUSD_MICRO = (micro: number) => (micro / 1_000_000).toFixed(2)
  const parseMicro = (v: any) => parseInt(String(v ?? 0)) || 0

  // P2P received (no invoice linkage) — avoid double-counting invoice payments
  const p2pIn     = items.filter(i => i.direction === 'received' && i.status === 3 && !i.invoiceToken)
                         .reduce((s, i) => s + parseMicro(i.amountMicro), 0)
  // Invoice income: sum paid invoices from invoice_transactions (where I am owner)
  const invIn     = invList.filter((inv: any) => inv.status === 'paid' || inv.chainStatus === 3)
                           .reduce((s: number, inv: any) => {
                             const micro = parseMicro(inv.amountMicro ?? (parseFloat(inv.amount ?? 0) * 1_000_000))
                             return s + micro
                           }, 0)
  const totalIn   = p2pIn + invIn

  // Sent payments — use gross (net + fee) so it reflects what was actually paid
  const totalOut  = items.filter(i => i.direction === 'sent' && (i.status === 2 || i.status === 3))
                         .reduce((s, i) => s + parseMicro(i.amountMicro) + parseMicro(i.feeMicro), 0)

  // Pending: unpaid invoices (draft/sent/overdue) + pending P2P receives
  const pendingInvoices = invList.filter((inv: any) => ['draft','sent','overdue'].includes(inv.status))
                                 .reduce((s: number, inv: any) => {
                                   const micro = parseMicro(inv.amountMicro ?? (parseFloat(inv.amount ?? 0) * 1_000_000))
                                   return s + micro
                                 }, 0)
  const pendingP2p      = items.filter(i => i.direction === 'received' && i.status === 2 && !i.invoiceToken)
                               .reduce((s, i) => s + parseMicro(i.amountMicro), 0)
  const net = totalIn - totalOut

  // ── List ──────────────────────────────────────────────────────────────────
  return (
    <div style={page}>
      <div style={hdr}>
        <button onClick={smartClose} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700, flex:1 }}>{t('history.title')}</span>
        {/* Export CSV */}
        {(!loading && (items.length > 0 || invList.length > 0)) && (
          <button
            onClick={() => exportHistoryCSV(items, invList, account?.shortId)}
            style={{ background:'none', border:'1px solid var(--border)', cursor:'pointer',
              color:'var(--muted)', fontSize:10, padding:'4px 10px', borderRadius:8,
              fontWeight:600, letterSpacing:'0.03em', whiteSpace:'nowrap' }}
            title={t('history.exportCsv')}>
            ↓ CSV
          </button>
        )}
        {/* Sort direction toggle */}
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          style={{ background:'none', border:'1px solid var(--border)', cursor:'pointer',
            color:'var(--muted)', fontSize:10, padding:'4px 8px', borderRadius:8,
            fontWeight:600, letterSpacing:'0.03em', whiteSpace:'nowrap' }}
          title={sortDir === 'desc' ? t('history.sortNewest') : t('history.sortOldest')}
        >
          {sortDir === 'desc' ? `↓ ${t('gift.newest')}` : `↑ ${t('gift.oldest')}`}
        </button>
        <button onClick={() => { clearInvoiceLocalCache(); load(); reloadInvList() }}
          disabled={loading || invRefreshing}
          style={{ background:'none', border:'none', cursor:'pointer',
            color:'var(--muted)', fontSize:16, opacity: (loading || invRefreshing) ? 0.4 : 0.7 }}
          title={t('history.refreshTitle')}>
          {(loading || invRefreshing) ? '…' : '↻'}
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:3, width:'100%', maxWidth:520,
                    background:'var(--surface)', border:'1px solid var(--border)',
                    borderRadius:10, padding:3 }}>
        {(['all','sent','received','gift','invoices','stats'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex:1, padding:'6px 2px', borderRadius:7, border:'none', cursor:'pointer',
            fontSize:10, fontWeight:700, letterSpacing:'0.04em',
            background: activeTab === tab ? 'var(--text)' : 'transparent',
            color:       activeTab === tab ? 'var(--surface)' : 'var(--muted)',
            transition:  'all 0.15s',
          }}>
            {tab === 'all' ? t('history.tabs.all')
              : tab === 'sent' ? t('history.tabs.sent')
              : tab === 'received' ? t('history.tabs.received')
              : tab === 'gift' ? t('history.tabs.gift')
              : tab === 'invoices' ? t('history.tabs.invoices')
              : `📊 ${t('history.tabs.stats')}`}
          </button>
        ))}
      </div>

      {/* ── Stats tab — monthly activity + accounting totals ── */}
      {activeTab === 'stats' && (
        <div style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:10 }}>
          {/* This-month activity counters (server-aggregated) */}
          {activityStats && (
            <div>
              <div style={{ fontSize:9, color:'var(--muted)', fontWeight:700,
                            letterSpacing:'0.12em', marginBottom:6, paddingLeft:2 }}>
                {t('history.stats.thisMonth')}
              </div>
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6,
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:10, padding:'12px 10px',
              }}>
                {[
                  { label: t('history.stats.giftsSent'),     value: activityStats.thisMonth.giftsSent,        color:'#f59e0b' },
                  { label: t('history.stats.giftsReceived'), value: activityStats.thisMonth.giftsReceived,    color:'#22c55e' },
                  { label: t('history.stats.paid'),          value: activityStats.thisMonth.paymentsSent,     color:'#ef4444' },
                  { label: t('history.stats.received'),      value: activityStats.thisMonth.paymentsReceived, color:'#3b82f6' },
                ].map(s => (
                  <div key={s.label} style={{ display:'flex', flexDirection:'column',
                                              alignItems:'center', gap:3 }}>
                    <span style={{ fontSize:18, fontWeight:800, color:s.color, lineHeight:1 }}>{s.value}</span>
                    <span style={{ fontSize:9, color:'var(--muted)',
                                   letterSpacing:'0.04em', textAlign:'center' }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Accounting totals */}
          <div>
            <div style={{ fontSize:9, color:'var(--muted)', fontWeight:700,
                          letterSpacing:'0.12em', marginBottom:6, paddingLeft:2 }}>
              {t('history.stats.accounting')}
            </div>
            <div className="sk-page-in" style={{ display:'grid',
                          gridTemplateColumns:'1fr 1fr', gap:7 }}>
              {[
                { label: t('history.stats.moneyIn'),  value:IUSD_MICRO(totalIn),                      color:'#22c55e', prefix:'+' },
                { label: t('history.stats.moneyOut'), value:IUSD_MICRO(totalOut),                     color:'#ef4444', prefix:'-' },
                { label: t('history.stats.net'),      value:IUSD_MICRO(Math.abs(net)),                color: net>=0 ? '#22c55e' : '#ef4444', prefix: net>=0 ? '+' : '-' },
                { label: t('history.stats.pending'),  value:IUSD_MICRO(pendingInvoices + pendingP2p), color:'#f59e0b', prefix:'~' },
              ].map(({ label, value, color, prefix }) => (
                <div key={label} style={{ background:'var(--surface)',
                                          border:'1px solid var(--border)',
                                          borderRadius:10, padding:'12px 14px' }}>
                  <div style={{ fontSize:9, color:'var(--muted)', fontWeight:700,
                                letterSpacing:'0.1em', marginBottom:4 }}>{label.toUpperCase()}</div>
                  <div style={{ fontSize:18, fontWeight:800, color, lineHeight:1 }}>
                    {prefix}{value}
                    <span style={{ fontSize:10, fontWeight:400, marginLeft:3,
                                   color:'var(--muted)' }}>iUSD</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {items.length === 0 && !loading && (
            <div style={{ textAlign:'center', fontSize:11, color:'var(--muted)',
                          padding:'16px 0' }}>
              {t('history.noTransactionsYet')}
            </div>
          )}
        </div>
      )}

      {loading && activeTab !== 'invoices' && <SkeletonHistory />}
      {error && !loading && (
        <div style={{ ...card, borderColor:'rgba(239,68,68,0.4)', background:'rgba(239,68,68,0.06)' }}>
          <div style={{ fontSize:12, color:'#ef4444' }}>⚠ {error}</div>
        </div>
      )}

      {/* ── Gift tab ───────────────────────────────────────────────── */}
      {activeTab === 'gift' && (
        <div className="sk-page-in" style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:6 }}>
          <GiftHistoryList
            received={giftReceivedList}
            sent={giftSentList}
            receivedHasMore={giftReceivedHasMore}
            sentHasMore={giftSentHasMore}
            receivedLoadingMore={giftReceivedLoadingMore}
            sentLoadingMore={giftSentLoadingMore}
            onLoadMoreReceived={loadMoreGiftReceived}
            onLoadMoreSent={loadMoreGiftSent}
            showEmpty={true}
            emptyMessage={t('history.noGiftHistory')}
            onReceivedClick={(item) => {
              setPreviewPacketId(item.packet_id)
              if ((item.unseen_activity_count ?? 0) > 0) {
                unreadSync.markSeen(item.packet_id)
              }
            }}
            onSentClick={(pkt) => handleSentGiftClick(pkt)}
          />
        </div>
      )}

      {/* ── Invoices only tab ─────────────────────────────────────────── */}
      {activeTab === 'invoices' && (
        <div className="sk-page-in" style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:6 }}>
          {invList.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12,
                          color:'var(--muted)', marginTop:48 }}>
              <div style={{ fontSize:40 }}>🧾</div>
              <div style={{ fontSize:13 }}>{t('history.noInvoices')}</div>
              <button onClick={() => navigate('/app/request')}
                style={{ fontSize:12, background:'none', border:'1px solid var(--border)',
                         borderRadius:8, padding:'8px 16px', cursor:'pointer', color:'var(--muted)' }}>
                {t('request.createFirst')}
              </button>
            </div>
          ) : invList.map((inv: any) => <InvRow key={inv.id || inv.createdAt} inv={inv} selectedInvId={selectedInvId} setSelectedInvId={setSelectedInvId} account={account} />)}
        </div>
      )}

      {/* ── All tab: tx + invoices merged ─────────────────────────────── */}
      {activeTab === 'all' && !loading && (
        <div className="sk-page-in" style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:6 }}>
          {allRows.length === 0 && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                          gap:12, color:'var(--muted)', marginTop:48 }}>
              <div style={{ fontSize:40 }}>📜</div>
              <div style={{ fontSize:13 }}>{t('history.noActivity')}</div>
            </div>
          )}
          {allRows.map((row, i) =>
            row.type === 'tx'
              ? <TxRow key={i} item={row.item} onClick={() => setDetail(row.item)} />
              : row.type === 'inv'
              ? <InvRow key={i} inv={row.inv} selectedInvId={selectedInvId} setSelectedInvId={setSelectedInvId} account={account} />
              : <GiftRow key={i} gift={row.gift} direction={row.direction}
                  onClick={() => {
                    if (row.direction === 'sent') {
                      handleSentGiftClick(row.gift as SentPacket)
                    } else {
                      setPreviewPacketId(row.gift.packet_id)
                      if ((row.gift.unseen_activity_count ?? 0) > 0) {
                        unreadSync.markSeen(row.gift.packet_id)
                      }
                    }
                  }} />
          )}
        </div>
      )}

      {/* ── Sent / Received tab ───────────────────────────────────────── */}
      {(activeTab === 'sent' || activeTab === 'received') && !loading && (
        <div className="sk-page-in" style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:6 }}>
          {filteredTx.length === 0 && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                          gap:12, color:'var(--muted)', marginTop:48 }}>
              <div style={{ fontSize:40 }}>📜</div>
              <div style={{ fontSize:13 }}>{activeTab === 'sent' ? t('history.noSentTransactions') : t('history.noReceivedTransactions')}</div>
            </div>
          )}
          {filteredTx.map(item => <TxRow key={item.paymentId} item={item} onClick={() => setDetail(item)} />)}
          {hasMore && (
            <button onClick={() => load(true)} disabled={loadingMore}
              style={{
                padding:'10px', marginTop:6, borderRadius:10,
                background:'var(--bg-elevated)', border:'1px dashed var(--border)',
                color:'var(--muted)', cursor: loadingMore ? 'wait' : 'pointer',
                fontSize:11, fontWeight:600, letterSpacing:'0.06em',
              }}>
              {loadingMore ? t('common.loading') : t('history.loadMore')}
            </button>
          )}
        </div>
      )}

      {sentModalResult && (
        <ShareLinksModal result={sentModalResult} onClose={() => setSentModalResult(null)} />
      )}
      {previewPacketId && (
        <ReceivedGiftPreviewModal
          packetId={previewPacketId}
          onClose={() => setPreviewPacketId(null)}
        />
      )}
    </div>
  )
}

// GiftRow — thin wrapper that forwards to the shared GiftRowCard component.
// Exists for a small diff at the All-tab map call site.
function GiftRow({ gift, direction, onClick }: { gift: any; direction: 'sent' | 'received'; onClick?: () => void }) {
  const isSent = direction === 'sent'
  return (
    <GiftRowCard
      kind={isSent ? 'sent' : 'received'}
      variant="inbox"
      packetId={gift.packet_id}
      boxId={gift.box_id}
      wrapStyleId={gift.wrap_style_id ?? 0}
      wrapParams={gift.wrap_params ?? null}
      expiresAt={gift.expires_at ?? null}
      giftName={gift.gift?.name}
      giftImageUrl={gift.gift?.image_url}
      senderNickname={isSent ? undefined : (gift.sender_nickname ?? null)}
      senderMessage={isSent ? undefined : gift.sender_message}
      claimed={isSent ? undefined : !!gift.claimed}
      claimedAt={gift.claimed_at ?? gift.created_at}
      status={isSent ? gift.status : undefined}
      amount={isSent ? Number(gift.total_amount ?? 0) : Number(gift.amount ?? 0)}
      numSlots={isSent ? gift.num_slots : undefined}
      claimedCount={isSent ? (gift.claims?.length ?? 0) : undefined}
      unseenActivityCount={gift.unseen_activity_count ?? gift.unseen_reply_count ?? 0}
      onClick={onClick}
    />
  )
}

function TxRow({ item, onClick }: { item: TxItem; onClick: () => void }) {
  const { t } = useTranslation()
  const statusLabel = useStatusLabel()
  const isSent = item.direction === 'sent'
  const col    = STATUS_COLOR[item.status] ?? 'var(--muted)'
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
      borderRadius:12, background: isSent ? 'var(--surface)' : 'rgba(34,197,94,0.04)',
      border:'1px solid var(--border)', cursor:'pointer', textAlign:'left', width:'100%',
    }}>
      {/* Direction icon */}
      <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                    background: isSent ? 'rgba(99,102,241,0.1)' : 'rgba(34,197,94,0.1)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, color: isSent ? '#6366f1' : '#22c55e' }}>
        {isSent ? '↑' : '↓'}
      </div>
      {/* Info */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
          <span style={{ fontSize:10, fontWeight:700, color: isSent ? '#6366f1' : '#22c55e' }}>
            {isSent ? (item.invoiceToken ? t('history.invoicePayment') : t('history.sentTo')) : t('history.receivedFrom')}
          </span>
          {isSent && item.invoiceNo && (
            <span style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace' }}>#{item.invoiceNo}</span>
          )}
        </div>
        {item.merchantInfo?.name
          ? <div style={{ fontSize:11, fontWeight:600 }}>
              {isSent && item.invoiceToken ? '🧾' : '🏪'} {item.merchantInfo.name}
            </div>
          : item.counterpartyShortId
            ? (
              /* No stopPropagation here — clicking the seal on a row
                 should open the detail drawer, not trigger contact add.
                 The contact-add affordance lives in the detail drawer. */
              <UserSeal shortId={item.counterpartyShortId} compact style={{ borderRadius:5, maxWidth:160 }} />
            )
            : <div style={{ fontSize:10, color:'var(--muted)' }}>—</div>
        }
        {item.invoiceNote && (
          <div style={{ fontSize:9, color:'var(--muted)', marginTop:1, overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.invoiceNote}</div>
        )}
        <div style={{ fontSize:9, color:'var(--muted)', marginTop:2 }}>
          {formatTime(item.dbCreatedAt, item.createdAt)}
        </div>
      </div>
      {/* Amount + status */}
      <div style={{ textAlign:'right', flexShrink:0 }}>
        <div style={{ fontSize:14, fontWeight:700,
                      color: isSent ? 'var(--text)' : '#22c55e' }}>
          {isSent ? '-' : '+'}{IUSD(item.amountMicro)} iUSD
        </div>
        <span style={{ fontSize:9, padding:'2px 6px', borderRadius:20, fontWeight:600,
          background: col+'20', color: col }}>
          {statusLabel(item.status, item.direction)}
        </span>
      </div>
    </button>
  )
}

// ── InvRow — compact invoice list item (expandable) ──────────────────────────
function InvRow({ inv, selectedInvId, setSelectedInvId, account: _account }: {
  inv: any
  selectedInvId: string | null
  setSelectedInvId: (id: string | null) => void
  account?: any
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const col    = INV_STATUS_COLOR[inv.status] ?? '#6b7280'
  const invKey = inv.id || inv.invoiceNo || inv.createdAt
  const isOpen = selectedInvId === invKey
  const tokenFromLink = typeof inv.payLink === 'string'
    ? (inv.payLink.match(/\/pay\/([a-zA-Z0-9]+)/)?.[1] ?? null)
    : null
  const invoiceDisplayId = inv.invoiceNo || inv.invoiceToken || tokenFromLink || '—'
  const isOverdue = inv.status === 'overdue' || (inv.dueDate && new Date(inv.dueDate+'T23:59:59') < new Date() && inv.status === 'sent')
  const canCancel = ['draft','sent','overdue'].includes(inv.status) && inv.invoiceToken
  const API_BASE_VAL = import.meta.env.VITE_API_URL ?? 'https://api.iusd-pay.xyz/v1'

  return (
    <div style={{ borderRadius:12, overflow:'hidden',
                  border:`1px solid ${isOpen ? col+'60' : 'var(--border)'}`,
                  background:'var(--surface)', transition:'border-color 0.15s' }}>
      {/* Compact header row */}
      <button onClick={() => setSelectedInvId(isOpen ? null : invKey)}
        style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                 background:'transparent', border:'none', cursor:'pointer',
                 textAlign:'left', width:'100%', WebkitTapHighlightColor:'transparent' }}>
        <div style={{ width:26, height:26, borderRadius:'50%', flexShrink:0,
                      background:'rgba(59,130,246,0.12)',
                      display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>🧾</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {invoiceDisplayId}
            {inv.note ? <span style={{ fontWeight:400, color:'var(--muted)' }}> · {inv.note}</span> : ''}
          </div>
          <div style={{ fontSize:9, color:'var(--muted)', marginTop:1 }}>
            {new Date(inv.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}
            {inv.dueDate ? <span style={{ color: isOverdue ? '#ef4444' : 'var(--muted)' }}> · {t('history.due')} {new Date(inv.dueDate+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})}{isOverdue ? ' ⚠' : ''}</span> : ''}
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          {inv.amount && <div style={{ fontSize:12, fontWeight:700 }}>{inv.amount} iUSD</div>}
          <span style={{ fontSize:9, padding:'1px 6px', borderRadius:20, fontWeight:600,
                         background:col+'20', color:col }}>{t(`request.status.${inv.status}`, { defaultValue: INV_STATUS_LABEL[inv.status] ?? inv.status })}</span>
        </div>
        <span style={{ fontSize:11, color:'var(--muted)', flexShrink:0,
                       transform: isOpen ? 'rotate(90deg)' : 'none', transition:'transform 0.15s' }}>›</span>
      </button>

      {/* Expanded detail */}
      {isOpen && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'10px 14px',
                      display:'flex', flexDirection:'column', gap:8 }}>
          {/* QR + info */}
          <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
            {inv.payLink && (
              <div style={{ flexShrink:0 }}>
                <StyledQR url={inv.payLink} address={inv.invoiceToken ?? inv.payLink} size={100} />
              </div>
            )}
            <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--text)', lineHeight:1 }}>
                {inv.amount ?? '—'} <span style={{ fontSize:10, fontWeight:400, color:'var(--muted)' }}>iUSD</span>
              </div>
              <div style={{ fontSize:10, fontFamily:'monospace', color:'var(--muted)' }}>{invoiceDisplayId}</div>
              {inv.note && <div style={{ fontSize:11 }}>{inv.note}</div>}
              {inv.taxNum && <div style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace' }}>Tax: {inv.taxNum}</div>}
              {inv.dueDate && <div style={{ fontSize:9, color: isOverdue ? '#ef4444' : 'var(--muted)' }}>
                {t('history.due')} {new Date(inv.dueDate+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}{isOverdue ? ' ⚠' : ''}
              </div>}
              <div style={{ fontSize:9, color:'var(--muted)' }}>
                {new Date(inv.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
              </div>
            </div>
          </div>
          {/* Pay link */}
          {inv.payLink && (
            <div style={{ display:'flex', gap:6, alignItems:'center',
                          background:'var(--bg)', borderRadius:7, padding:'6px 8px' }}>
              <span style={{ fontSize:9, fontFamily:'monospace', flex:1, overflow:'hidden',
                             textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--muted)' }}>
                {inv.payLink}
              </span>
              <button onClick={() => { navigator.clipboard.writeText(inv.payLink); setCopied(true); setTimeout(()=>setCopied(false),1500) }}
                style={{ flexShrink:0, fontSize:9, padding:'2px 8px', borderRadius:5,
                         background:'var(--surface)', border:'1px solid var(--border)',
                         cursor:'pointer', color:'var(--text)' }}>
                {copied ? '✓' : '📋'}</button>
              <button onClick={() => { if (navigator.share) navigator.share({ title: inv.invoiceNo, url: inv.payLink }).catch(()=>{}); else navigator.clipboard.writeText(inv.payLink) }}
                style={{ flexShrink:0, fontSize:9, padding:'2px 8px', borderRadius:5,
                         background:'var(--text)', border:'none', cursor:'pointer',
                         color:'var(--surface)', fontWeight:700 }}>{t('request.share')}</button>
            </div>
          )}
          {/* ↓ Invoice PDF — synchronous window.open (iOS-safe) */}
          {(inv.invoiceMode === 'business' || (inv.invoiceMode !== 'personal' && !!inv.merchant)) && (
            <button onClick={() => window.open(`/invoice/${inv.invoiceToken}`, '_blank')}
              style={{ fontSize:10, color:'var(--muted)', background:'none',
                       border:'1px solid var(--border)', borderRadius:7, padding:'5px 12px',
                       cursor:'pointer', alignSelf:'flex-start' }}>
              ↓ Invoice PDF
            </button>
          )}

          {canCancel && (
            <button onClick={async () => {
                if (!confirm(t('history.cancelInvoiceConfirm'))) return
                try {
                  const tok = Object.entries(localStorage).find(([k])=>k.startsWith('ipay2_session_'))?.[1] ?? ''
                  await fetch(`${API_BASE_VAL}/invoice/${inv.invoiceToken}/revoke`, {
                    method:'POST', headers:{ Authorization:`Bearer ${tok}` }
                  })
                  if (tok) await updateInvoiceStatus(inv.invoiceToken, { status: 'cancelled' }, tok).catch(() => {})
                  setSelectedInvId(null); setTimeout(() => window.location.reload(), 300)
                  setSelectedInvId(null)
                } catch(e: any) { alert(t('history.cancelFailed', { msg: e.message })) }
              }}
              style={{ fontSize:10, color:'#ef4444', background:'none',
                       border:'1px solid #ef444440', borderRadius:7, padding:'5px 12px',
                       cursor:'pointer', alignSelf:'flex-start' }}>
              ✕ {t('history.cancelInvoice')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
  display:'flex', flexDirection:'column', alignItems:'center',
  padding:'16px 12px 100px', gap:12, boxSizing:'border-box',
  overflow:'hidden', width:'100%',
}
const hdr: React.CSSProperties = {
  width:'100%', maxWidth:480, display:'flex', alignItems:'center', gap:10,
  paddingBottom:10, borderBottom:'1px solid var(--border)',
}
const card: React.CSSProperties = {
  width:'100%', maxWidth:480, background:'var(--surface)',
  border:'1px solid var(--border)', borderRadius:14, padding:'12px 14px',
  display:'flex', flexDirection:'column', gap:10, boxSizing:'border-box',
  overflow:'hidden',
}
const sectionLabel: React.CSSProperties = {
  fontSize:9, fontWeight:700, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--muted)',
}
const btnGhost: React.CSSProperties = {
  background:'none', color:'var(--muted)', border:'1px solid var(--border)',
  borderRadius:10, padding:'7px 14px', fontSize:12, cursor:'pointer',
}
const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
