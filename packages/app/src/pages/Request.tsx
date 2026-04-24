/**
 * Request — /app/request
 * Unified payment request flow for Personal and Business modes.
 * Two-step: Input → Generated (QR + link + auto-invoice for business).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import QRCodeStyling from 'qr-code-styling'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { UserSeal } from '../components/UserSeal'
import { useAuthContext } from '../hooks/AuthContext'
import { StyledQR, createIusdQrOptions } from '../components/StyledQR'
import { uiPayStatusFromChain } from '../lib/paymentStatus'
import { API_BASE } from '../config'
import { fetchInvoices, saveInvoice, updateInvoiceStatus } from '../lib/invoiceStore'
import { openInvoicePdf } from '../lib/pdfTemplates'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { showToast } from '../components/Toast'

// ── Types ─────────────────────────────────────────────────────────────────
export interface MerchantProfile {
  name:          string
  logoUrl:       string
  color:         string
  description:   string
  email:         string
  phone:         string
  website:       string
  address:       string
  taxId:         string
  fontFamily:    string
  invoicePrefix: string
  invoiceStart:  number
}

// Merchant profile and invoice counter are server-side only (no localStorage)
const INVOICE_KEY   = 'ipay2_invoice_counter' // kept for one-time cleanup only
const APP_ORIGIN    = 'https://iusd-pay.xyz'
const FEE_RATE      = 0.005

// ── Invoice list helpers ──────────────────────────────────────────────────
// Updated in sync with INV_STATUS_LABEL
const INV_STATUS_COLOR: Record<string,string> = {
  draft:'#6b7280', sent:'#f59e0b', paying:'#f59e0b', paid:'#22c55e',
  overdue:'#ef4444', refunded:'#6b7280', cancelled:'#6b7280'
}
// Keys into settings.* / request.status.* — resolved by t() at render time,
// since module-level constants can't call hooks. The render-side code uses
// t(`request.status.${status}`) with these keys as fallback IDs.
const INV_STATUS_LABEL: Record<string,string> = {
  draft:'Draft', sent:'Awaiting Payment', paying:'Awaiting Confirm',
  paid:'Paid', overdue:'Overdue', refunded:'Refunded', cancelled:'Cancelled'
}
const FEE_CAP       = 5.0   // max 5 iUSD per transaction

const DEFAULT_MERCHANT: MerchantProfile = {
  name:'', logoUrl:'', color:'#6366f1', description:'',
  email:'', phone:'', website:'', address:'', taxId:'',
  fontFamily:'inherit', invoicePrefix:'INV-', invoiceStart:1,
}

// Derive next invoice number from existing invoices — no localStorage
let _invoiceNoMemory = 0  // in-memory counter for current session; reset on page reload (fresh from server)
export function initInvoiceNo(invoices: any[], m: MerchantProfile): void {
  const prefix = m.invoicePrefix?.trim() || 'INV-'
  let max = (m.invoiceStart ?? 1) - 1
  for (const inv of invoices) {
    const no = String(inv.invoiceNo ?? '')
    if (no.startsWith(prefix)) {
      const n = parseInt(no.slice(prefix.length))
      if (!isNaN(n) && n > max) max = n
    }
  }
  _invoiceNoMemory = max + 1
  try { localStorage.removeItem(INVOICE_KEY) } catch {} // one-time cleanup
}
export function bumpInvoiceNo(m: MerchantProfile): string {
  const prefix = m.invoicePrefix?.trim() || 'INV-'
  const n = _invoiceNoMemory > 0 ? _invoiceNoMemory : (m.invoiceStart ?? 1)
  _invoiceNoMemory = n + 1
  return `${prefix}${String(n).padStart(4,'0')}`
}

function defaultDueDate() {
  const d = new Date(); d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0,10)
}
function genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => b.toString(16).padStart(2,'0')).join('')
}

// ── Main Component ─────────────────────────────────────────────────────────
export function Request() {
  const { t } = useTranslation()
  const navigate               = useNavigate()
  const smartClose             = useSmartClose('/app')
  const { account, token }     = useAuthContext()
  const { address: walletAddress, requestTxBlock } = useInterwovenKit()
  const [refundingInvId, setRefundingInvId] = useState<string|null>(null)
  const [refundErr, setRefundErr] = useState<string|null>(null)
  const [claimNowLoading, setClaimNowLoading] = useState(false)
  async function handleRefundInvoice(inv: any) {
    if (!walletAddress || !inv.paymentId) return
    if (!confirm(`Refund ${inv.amount ?? ''} iUSD to the payer?`)) return
    setRefundingInvId(inv.id); setRefundErr(null)
    try {
      const { refundPayment } = await import('../services/payRefund')
      await refundPayment(requestTxBlock as any, walletAddress, inv.paymentId)
      if (token && inv.invoiceToken) {
        await updateInvoiceStatus(inv.invoiceToken, { status: 'refunded' }, token).catch(() => {})
      }
      setAllInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'refunded' } : i))
    } catch (e: any) { setRefundErr(e?.message ?? 'Refund failed') }
    finally { setRefundingInvId(null) }
  }
  const [mode, setMode]        = useState<'personal'|'business'>('personal')
  const [, forceUpdate]        = useState(0)
  const [generating, setGenerating] = useState(false)
  const [genError,   setGenError]   = useState<string|null>(null)
  void generating; void genError  // used by button state

  const [chainTxHash] = useState<string|null>(null)  // reserved for future use
  const [freeQuota, setFreeQuota] = useState<boolean|null>(null)
  const [autoClaim, setAutoClaim] = useState(() => !!account?.autoClaimEnabled)
  useEffect(() => { setAutoClaim(!!account?.autoClaimEnabled) }, [account?.autoClaimEnabled])

  // Fetch free quota for business mode display — self-scoped via Bearer
  // token so the caller's init1 address stays out of the URL.
  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/invoice/chain/quota`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setFreeQuota(d.hasFreeQuota === true))
      .catch(() => {})
  }, [token])
  const [merchant, setMerchant]= useState<MerchantProfile>(DEFAULT_MERCHANT)
  const [view, setView]        = useState<'input'|'generated'>('input')
  const [copied, setCopied]    = useState(false)

  // Input fields
  const [amount,   setAmount]  = useState('')
  const [note,     setNote]    = useState('')
  const [taxNum,   setTaxNum]  = useState('')
  const [dueDate,  setDueDate] = useState(defaultDueDate())
  const [payer,       setPayer]      = useState('')   // shortId (business only)
  const [payerNick,   setPayerNick]  = useState<string|null>(null)
  const [payerRealName, setPayerRealName] = useState('')  // optional real name set by merchant

  // Generated state
  const [payStatus, setPayStatus] = useState<'awaiting'|'paying'|'paid'|'refunded'|'revoked'|'expired'>('awaiting')
  const [pollCountdown, setPollCountdown] = useState(5)
  const [genTime, setGenTime] = useState('')
  const [generated, setGenerated] = useState<{
    payLink: string
    invoiceNo: string
    invoiceToken: string
    shortSealSvg: string | null
    taxNum?: string
  } | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)

  // Load merchant profile from server only (no localStorage fallback)
  useEffect(() => {
    if (account?.merchantData) {
      const m = { ...DEFAULT_MERCHANT, ...(account.merchantData as MerchantProfile) }
      setMerchant(m)
      if (m.name) setMode('business')
    }
    // else: no merchant profile on server → stay in personal mode
  }, [account?.merchantData])

  // Resolve payer shortId
  useEffect(() => {
    if (!payer || payer.length < 8) { setPayerNick(null); return }
    const t = setTimeout(() => {
      fetch(`${API_BASE}/account/${payer.toUpperCase()}`)
        .then(r => r.json())
        .then(d => setPayerNick(d.account?.nickname ?? null))
        .catch(() => setPayerNick(null))
    }, 500)
    return () => clearTimeout(t)
  }, [payer])

  // Fetch my shortSealSvg once
  const [mySeal, setMySeal] = useState<string|null>(null)
  const [pageTab, setPageTab] = useState<'new'|'history'>('new')
  const [selectedInvId, setSelectedInvId] = useState<string | null>(null)
  const [allInvoices, setAllInvoices] = useState<any[]>([])
  // Payer name inline editor (for paid invoices — merchant edits for reimbursement)
  const [editingPayerInvId, setEditingPayerInvId] = useState<string|null>(null)
  const [editingPayerName,  setEditingPayerName]  = useState('')
  // Reload invoices from DB when switching to Invoices tab
  const [invRefreshing, setInvRefreshing] = useState(false)
  const reloadInvoices = useCallback(async () => {
    if (!token) return
    setInvRefreshing(true)
    const invs = await fetchInvoices(token).catch(() => [])
    setAllInvoices(invs)
    // Sync in-memory invoice counter from server list
    if (merchant) initInvoiceNo(invs, merchant)
    setInvRefreshing(false)
  }, [token, merchant])
  useEffect(() => { reloadInvoices() }, [view, pageTab])
  useEffect(() => {
    if (!account?.shortId || !token) return
    fetch(`${API_BASE}/account/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setMySeal(d.shortSealSvg ?? null)
        // Sync auto-claim toggle with global account setting
        if (typeof d.autoClaimEnabled === 'boolean') setAutoClaim(d.autoClaimEnabled)
      })
      .catch(() => {
        setMySeal(account?.shortSealSvg ?? null)
      })
  }, [account?.shortId, token])

  const amtNum  = parseFloat(amount) || 0
  const feeCapped = Math.min(amtNum * FEE_RATE, FEE_CAP)
  const youGet  = mode === 'business'
    ? amtNum - feeCapped         // business: payer absorbs fee (capped)
    : amtNum                     // personal: amount is what sender types

  async function generate() {
    setGenError(null)
    if (!account?.shortId) return
    if (amtNum < 0.1) { setGenError('Minimum invoice amount is 0.1 iUSD'); return }
    const invNo = mode === 'business' ? bumpInvoiceNo(merchant) : ''
    const invToken = genToken()

    // Business mode: all params stored server-side → short tamper-proof URL /pay/{token}
    // Personal mode: URL params (no server registration needed)
    let payLink: string

    if (mode === 'business') {
      // Short URL: /pay/{invToken} — all data fetched from DB
      payLink = `${APP_ORIGIN}/pay/${invToken}`
      const newInv = {
        id:           invToken.slice(0,12) + Date.now().toString(36),
        invoiceNo:    invNo,
        amount,
        dueDate,
        note,
        payerShortId: payer || undefined,
        payerName:    payerRealName.trim() || payerNick || undefined,
        status:       'sent',
        payLink,
        createdAt:    new Date().toISOString(),
        sentAt:       new Date().toISOString(),
        myShortId:    account.shortId,
        invoiceToken: invToken,
        invoiceMode:  'business',
        merchant:     merchant.name ? JSON.stringify(merchant) : null,
      }
      // Save to DB (async, non-blocking)
      if (token) saveInvoice(newInv as any, token).catch(() => {})
      // ① Register token + all invoice data server-side (DB cache)
      const registerBody = {
        token:             invToken,
        invoiceNo:         invNo,
        recipientShortId:  account.shortId,
        amount,
        feeMode:           'recipient',
        note:              note || invNo || null,
        merchant:          merchant.name || null,
        dueDate,
        invoiceMode:       'business',
      }
      if (token) {
        fetch(`${API_BASE}/invoice/register`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify(registerBody),
        }).catch(() => {})
      }

      // invoice_v1 on-chain creation removed — pay_v3 auto-claim handles merchant payments
    } else {
      // Personal mode: register server-side → clean /pay/{invToken} URL
      payLink = `${APP_ORIGIN}/pay/${invToken}`
      if (token) {
        fetch(`${API_BASE}/invoice/register`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
          body: JSON.stringify({
            token:             invToken,
            invoiceNo:         '',
            recipientShortId:  account.shortId,
            amount,
            feeMode:           'recipient',
            note:              note || null,
            merchant:          null,
            dueDate,
            invoiceMode:       'personal',
          }),
        }).catch(() => {})
      }
      // Personal mode: also save to localStorage so it appears in Invoices list
      const newInvPersonal = {
        id:           invToken.slice(0,12) + Date.now().toString(36),
        invoiceNo:    '',
        amount,
        dueDate,
        note,
        status:       'sent',
        payLink,
        createdAt:    new Date().toISOString(),
        sentAt:       new Date().toISOString(),
        myShortId:    account.shortId,
        invoiceToken: invToken,
      }
      // Save to DB (async, non-blocking)
      if (token) saveInvoice(newInvPersonal as any, token).catch(() => {})
    }

    setGenTime(new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))
    setGenerated({ payLink, invoiceNo: invNo, invoiceToken: invToken, shortSealSvg: mySeal, taxNum })
    setView('generated')
    setGenerating(false)
  }

  function reset() {
    setView('input')
    setGenerated(null)
    setCopied(false)
    if (mode === 'business') {
      setNote('')
      setPayer('')
      setPayerNick(null)
      setDueDate(defaultDueDate())
      // amount stays for quick repeat
    }
  }

  function copyLink() {
    if (!generated) return
    navigator.clipboard.writeText(generated.payLink)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function share() {
    if (!generated) return
    const title = mode === 'business'
      ? `${merchant.name || 'Payment'} — ${amount ? amount + ' iUSD' : 'Request'}`
      : `Payment request${amount ? ': ' + amount + ' iUSD' : ''}`
    if (navigator.share) {
      navigator.share({ title, url: generated.payLink }).catch(() => {})
    } else copyLink()
  }

  // ── Download pay card as PNG ─────────────────────────────────────────────
  async function downloadPayCard() {
    if (!generated) return
    const isDark = document.documentElement.classList.contains('dark')

    // 1. Render QR to blob (same iUSD center-logo style as on-screen QR)
    const qr = new QRCodeStyling(
      createIusdQrOptions({
        data: generated.payLink,
        size: 300,
        theme: isDark ? 'dark' : 'light',
      }),
    )
    const rawData = await qr.getRawData('png')
    if (!rawData) return
    const blob = rawData instanceof Blob ? rawData : new Blob([rawData as unknown as ArrayBuffer], { type: 'image/png' })
    const blobUrl = URL.createObjectURL(blob)
    const img = new Image(); img.src = blobUrl
    await new Promise(r => { img.onload = r })
    URL.revokeObjectURL(blobUrl)

    // 2. Draw card canvas
    const W = 480, H = 620
    const canvas = document.createElement('canvas')
    canvas.width = W * 2; canvas.height = H * 2  // @2x for retina
    const ctx = canvas.getContext('2d')!
    ctx.scale(2, 2)

    // Background
    ctx.fillStyle = isDark ? '#141414' : '#f7f7f5'
    ctx.fillRect(0, 0, W, H)

    // Card body
    ctx.fillStyle = isDark ? '#1e1e1e' : '#ffffff'
    roundRect(ctx, 20, 20, W - 40, H - 40, 16)
    ctx.fill()

    // Header: IUSD PAY label
    ctx.fillStyle = isDark ? '#e8e8e3' : '#1c1c1e'
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('iUSD PAY', 36, 48)
    if (mode === 'business' && generated.invoiceNo) {
      ctx.fillStyle = isDark ? '#636366' : '#aeaeb2'
      ctx.font = '12px -apple-system, sans-serif'
      ctx.fillText(generated.invoiceNo, W - 36 - ctx.measureText(generated.invoiceNo).width, 48)
    }

    // Divider
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'
    ctx.fillRect(36, 56, W - 72, 1)

    // QR (centred)
    const qrSize = 240, qrX = (W - qrSize) / 2, qrY = 70
    ctx.drawImage(img, qrX, qrY, qrSize, qrSize)

    // Amount
    const amtY = qrY + qrSize + 28
    ctx.fillStyle = isDark ? '#e8e8e3' : '#1c1c1e'
    ctx.font = `bold 30px -apple-system, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(`${amount || '—'} iUSD`, W / 2, amtY)

    // Merchant / note
    if (mode === 'business' && merchant.name) {
      ctx.fillStyle = isDark ? '#636366' : '#aeaeb2'
      ctx.font = `12px -apple-system, sans-serif`
      ctx.fillText(merchant.name, W / 2, amtY + 22)
    }

    // URL at bottom
    ctx.fillStyle = isDark ? '#3a3a3c' : '#d1d1d6'
    ctx.font = `10px -apple-system, sans-serif`
    ctx.fillText('iusd-pay.xyz', W / 2, H - 30)

    // 3. Download
    canvas.toBlob(b => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `${mode === 'business' ? (generated!.invoiceNo || 'invoice') : 'payment'}-qr.png`
      a.click()
    }, 'image/png')
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  // ── Poll payment status every 5s when in generated view ─────────────────
  useEffect(() => {
    if (view !== 'generated' || !generated?.invoiceToken || !token) return
    setPayStatus('awaiting')

    async function check() {
      try {
        const res = await fetch(`${API_BASE}/invoice/${generated!.invoiceToken}/payment`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return  // not linked yet = still awaiting
        const d = await res.json()
        if (!d.linked) { setPayStatus('awaiting'); return }
        const cs = d.chainStatus as number | null
        // linked but unknown chain status should still look in-flight
        const resolved = uiPayStatusFromChain(cs)
        setPayStatus(resolved === 'awaiting' ? 'paying' : resolved)
      } catch {}
    }

    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [view, generated?.invoiceToken, token])

  // ── Countdown timer (visual only — counts down to next poll) ────────────
  useEffect(() => {
    if (view !== 'generated' || payStatus === 'paid' || payStatus === 'revoked'
        || payStatus === 'refunded' || payStatus === 'expired') return
    setPollCountdown(5)
    const t = setInterval(() => {
      setPollCountdown(n => {
        if (n <= 1) { return 5 }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [view, payStatus])

// ── Generated View ─────────────────────────────────────────────────────
  if (view === 'generated' && generated) {
    const dueFormatted = new Date(dueDate + 'T00:00:00')
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

    const statusCfg: Record<string, { label: string; color: string; bg: string; dot: string }> = {
      awaiting:  { label: 'Awaiting Payment', color: 'var(--muted)',  bg: 'rgba(128,128,128,0.07)', dot: '#6b7280' },
      paying:    { label: 'Confirming…',      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  dot: '#f59e0b' },
      paid:      { label: 'Paid ✓',           color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  dot: '#22c55e' },
      refunded:  { label: 'Refunded',         color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', dot: '#94a3b8' },
      revoked:   { label: 'Revoked',          color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   dot: '#ef4444' },
      expired:   { label: 'Expired',          color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  dot: '#ef4444' },
    }
    const sc = statusCfg[payStatus]


    return (
      <div style={{ ...pageSt, padding:'8px 12px 24px', gap:8, alignItems:'stretch', maxWidth:500, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>

        {/* ── Compact header bar ── */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0' }}>
          <button onClick={reset} style={backBtn}>←</button>
          <div style={{ display:'flex', alignItems:'center', gap:6, flex:1 }}>
            <img src="/images/iusd.png?v=20260414" style={{ width:16, height:16, borderRadius:'50%', opacity:0.7 }} alt="" />
            <span style={{ fontSize:10, letterSpacing:'0.14em', color:'var(--muted)', textTransform:'uppercase', fontWeight:600 }}>
              iUSD Pay
            </span>
            <span style={{ color:'var(--border)', fontSize:12 }}>·</span>
            <span style={{ fontSize:11, fontWeight:700, color:'var(--text)' }}>
              {mode === 'business' ? (generated.invoiceNo || 'Invoice') : 'Payment Request'}
            </span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {freeQuota !== null && (
              <span style={{
                fontSize:8, fontWeight:700, padding:'2px 6px', borderRadius:6,
                background: freeQuota ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)',
                color:      freeQuota ? '#22c55e' : '#f59e0b',
              }}>{freeQuota ? 'FREE QUOTA' : 'PAID INVOICE'}</span>
            )}
            {chainTxHash && (
              <span style={{ fontSize:8, fontWeight:700, padding:'2px 6px', borderRadius:6,
                background:'rgba(34,197,94,0.15)', color:'#22c55e' }}>⛓ ON-CHAIN</span>
            )}
          </div>
        </div>

        {/* ── Main card ── */}
        <div ref={cardRef} style={{
          background:'var(--surface)', borderRadius:16,
          border:'1px solid var(--border)', overflow:'hidden',
        }}>
          {/* Status strip at top */}
          <div style={{
            background: sc.bg,
            borderBottom: `1px solid ${sc.color}22`,
            padding:'7px 14px',
            display:'flex', alignItems:'center', justifyContent:'space-between',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{
                width:6, height:6, borderRadius:'50%', background: sc.dot, flexShrink:0,
                boxShadow: payStatus === 'awaiting' ? 'none' : `0 0 6px ${sc.dot}`,
              }}/>
              <span style={{ fontSize:11, fontWeight:700, color: sc.color, letterSpacing:'0.02em' }}>
                {sc.label}
              </span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {payStatus === 'awaiting' && (
                <span style={{ fontSize:10, color:'var(--muted)', letterSpacing:'0.04em',
                               fontVariantNumeric:'tabular-nums', minWidth:28, textAlign:'right' }}>
                  ↻ {pollCountdown}s
                </span>
              )}
              {payStatus === 'paying' && (
                <button
                  disabled={claimNowLoading}
                  onClick={async () => {
                    if (!generated?.invoiceToken || !token) return
                    setClaimNowLoading(true)
                    try {
                      const res = await fetch(`${API_BASE}/invoice/${generated.invoiceToken}/payment`,
                        { headers: { Authorization: `Bearer ${token}` } })
                      const d = await res.json()
                      if (!d?.paymentId) {
                        showToast(t('toast.paymentNotLinked'), 'error')
                        return
                      }
                      const r2 = await fetch(`${API_BASE}/payment/${d.paymentId}/claim-now`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` },
                      })
                      const j2 = await r2.json().catch(() => ({}))
                      if (!r2.ok) {
                        showToast(j2?.error ?? t('toast.claimFailed'), 'error')
                        return
                      }
                      showToast(j2?.message ?? t('toast.claimQueued'), 'success')
                    } catch (e: any) {
                      showToast(t('toast.networkError', { msg: e?.message ?? String(e) }), 'error')
                    } finally {
                      setClaimNowLoading(false)
                    }
                  }}
                  style={{ fontSize:10, fontWeight:700, padding:'3px 10px',
                           borderRadius:20, border:'none',
                           cursor: claimNowLoading ? 'wait' : 'pointer',
                           background:'#22c55e', color:'white',
                           opacity: claimNowLoading ? 0.6 : 1 }}>
                  {claimNowLoading ? '… Processing' : '⚡ Claim Now'}
                </button>
              )}
              {payStatus === 'paid' && (
                <button onClick={() => navigate('/app/history')}
                  style={{ background:'none', border:'none', cursor:'pointer', fontSize:10,
                           color:'var(--accent)', fontWeight:800, padding:0 }}>
                  View History →
                </button>
              )}
            </div>
          </div>

          {/* QR + Info: side-by-side */}
          <div style={{ display:'flex', gap:0, minHeight:170 }}>

            {/* QR column */}
            <div style={{
              padding:'14px 12px 14px 14px', flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center',
              background:'var(--surface)', borderRight:'1px solid var(--border)',
            }}>
              <div
                onClick={() => account?.shortId && window.open(`/profile/${account.shortId}`, '_blank')}
                style={{ cursor:'pointer', borderRadius:10, overflow:'hidden' }}
                title="View profile card"
              >
                <StyledQR url={generated.payLink} address={account?.shortId ?? ''} size={148} />
              </div>
            </div>

            {/* Info column */}
            <div style={{ flex:1, padding:'12px 14px', display:'flex', flexDirection:'column', gap:0, minWidth:0 }}>

              {/* Amount FIRST — above recipient */}
              <div style={{ marginBottom:8, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:9, color:'var(--muted)', fontWeight:700,
                              letterSpacing:'0.12em', marginBottom:3 }}>TO PAY</div>
                <div style={{ fontSize:28, fontWeight:900, lineHeight:1, color:'var(--text)' }}>
                  {amount || '—'}
                  <span style={{ fontSize:11, color:'var(--muted)', fontWeight:400, marginLeft:4 }}>iUSD</span>
                </div>
                {dueFormatted && (
                  <div style={{ fontSize:9, color:'var(--muted)', marginTop:2 }}>Due {dueFormatted}</div>
                )}
              </div>

              {/* Recipient identity */}
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:8, color:'var(--muted)', fontWeight:700,
                              letterSpacing:'0.12em', marginBottom:4 }}>RECIPIENT</div>
                {mode === 'business' && merchant.name && (
                  <div style={{ fontSize:13, fontWeight:800, lineHeight:1.2, marginBottom:5 }}>
                    {merchant.name}
                    {merchant.description && (
                      <div style={{ fontSize:9, fontWeight:400, color:'var(--muted)', marginTop:1 }}>
                        {merchant.description}
                      </div>
                    )}
                  </div>
                )}
                {account?.shortId && (
                  <UserSeal shortId={account.shortId}
                            fallbackNickname={account.nickname}
                            style={{ borderRadius:6 }} />
                )}
              </div>

              {/* Meta rows */}
              <div style={{ fontSize:9, lineHeight:1.9, color:'var(--muted)', fontFamily:'monospace' }}>
                {note && (
                  <div style={{ marginBottom:2 }}>
                    <span style={{ opacity:0.55 }}>Note  </span>
                    <span style={{ color:'var(--text)' }}>{note}</span>
                  </div>
                )}
                {mode === 'business' && generated.invoiceNo && (
                  <div>
                    <span style={{ opacity:0.55 }}>Inv   </span>
                    <span style={{ color:'var(--text)', fontWeight:700 }}>{generated.invoiceNo}</span>
                  </div>
                )}
                <div>
                  <span style={{ opacity:0.55 }}>Created at  </span>
                  <span style={{ color:'var(--text)' }}>{genTime}</span>
                </div>
                <div>
                  <span style={{ opacity:0.55 }}>Tax / VAT  </span>
                  <span style={{ color:'var(--text)', fontFamily:'monospace' }}>{generated.taxNum || '—'}</span>
                </div>
                {mode === 'business' && chainTxHash && (
                  <div style={{ color:'#22c55e', fontWeight:700 }}>⛓ On-chain ✓</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Action buttons ── */}
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={copyLink} style={{ ...btnGhost, flex:1, fontSize:12 }}>
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
          <button onClick={share} style={{ ...btnFill, flex:2, fontSize:12 }}>
            Share ↗
          </button>
          <button onClick={downloadPayCard}
            style={{ ...btnGhost, flex:1, fontSize:11, padding:'8px 10px' }}
            title="Save as image">
            💾
          </button>
          <button onClick={reset}
            style={{ ...btnGhost, flex:1, fontSize:11, color:'var(--muted)', padding:'8px 10px' }}>
            + New
          </button>
        </div>

        {mode === 'business' && (
          <div style={{ fontSize:9, color:'var(--muted)', textAlign:'center' }}>
            Saved to{' '}
            <button onClick={() => navigate('/app/history')}
              style={{ background:'none', border:'none', cursor:'pointer',
                       color:'var(--text)', fontSize:9, textDecoration:'underline', padding:0 }}>
              Accounting ↗
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Input View ─────────────────────────────────────────────────────────
  // Preview uses in-memory counter (initialized from server invoice list)
  const invPreview = mode === 'business'
    ? `${merchant?.invoicePrefix?.trim() || 'INV-'}${String(_invoiceNoMemory || (merchant?.invoiceStart ?? 1)).padStart(4,'0')}`
    : ''

  return (
    <div className="req-page" style={pageSt}>
      <style>{`
        .req-page input { max-width: 100% !important; }
        .req-page, .req-page * { max-width: 100%; box-sizing: border-box; }
        .req-page > * { max-width: 100% !important; box-sizing: border-box !important; }
      `}</style>
      {/* Header */}
      <div style={{ ...headerSt, borderBottom:'none', paddingBottom:4 }}>
        <button onClick={smartClose} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700, flex:1 }}>{t('request.title')}</span>
        {pageTab === 'history' && (
          <button onClick={reloadInvoices} disabled={invRefreshing}
            title="Refresh" style={{ background:'none', border:'none', cursor:'pointer',
              padding:'4px 6px', color:'var(--muted)', fontSize:16, lineHeight:1,
              opacity: invRefreshing ? 0.4 : 0.7 }}>
            {invRefreshing ? '…' : '↻'}
          </button>
        )}
      </div>
      {/* Controls row: Me/Biz + New/Invoices */}
      <div style={{ display:'flex', alignItems:'center', gap:4, paddingBottom:8,
                    borderBottom:'1px solid var(--border)', width:'100%', maxWidth:480, flexWrap:'wrap', boxSizing:'border-box' }}>
        {pageTab === 'new' && (
          <div style={{ display:'flex', background:'var(--bg-elevated)',
                        border:'1px solid var(--border)', borderRadius:16, padding:2, gap:0 }}>
            {(['personal','business'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding:'3px 8px', borderRadius:14, border:'none', cursor:'pointer',
                fontSize:10, fontWeight:700, letterSpacing:'0.03em',
                background: mode === m ? 'var(--text)' : 'transparent',
                color:      mode === m ? 'var(--surface)' : 'var(--muted)',
                transition: 'all 0.15s', whiteSpace:'nowrap',
              }}>
                {m === 'personal' ? t('request.modePersonal') : t('request.modeBusiness')}
              </button>
            ))}
          </div>
        )}
        <div style={{ flex:1 }}/>
        <div style={{ display:'flex', background:'var(--bg-elevated)',
                      border:'1px solid var(--border)', borderRadius:16, padding:2, gap:0 }}>
          {(['new','history'] as const).map(tab => (
            <button key={tab} onClick={() => setPageTab(tab)} style={{
              padding:'3px 8px', borderRadius:14, border:'none', cursor:'pointer',
              fontSize:10, fontWeight:700, letterSpacing:'0.03em',
              background: pageTab === tab ? 'var(--text)' : 'transparent',
              color:       pageTab === tab ? 'var(--surface)' : 'var(--muted)',
              transition:  'all 0.15s',
            }}>
              {tab === 'new' ? `+ ${t('request.tabNew')}` : t('request.tabInvoices')}
            </button>
          ))}
        </div>
      </div>

      {/* ── History tab ──────────────────────────────────────────────── */}
      {pageTab === 'history' && (
        <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', gap:8, overflow:'hidden' }}>
          {allInvoices.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12,
                          color:'var(--muted)', marginTop:48 }}>
              <div style={{ fontSize:40 }}>🧾</div>
              <div style={{ fontSize:13 }}>{t('request.empty')}</div>
              <button onClick={() => setPageTab('new')}
                style={{ fontSize:12, color:'var(--muted)', background:'none',
                         border:'1px solid var(--border)', borderRadius:8,
                         padding:'8px 16px', cursor:'pointer' }}>
                {t('request.createFirst')}
              </button>
            </div>
          ) : allInvoices.map((inv: any) => {
            const col = INV_STATUS_COLOR[inv.status] ?? '#6b7280'
            const lbl = t(`request.status.${inv.status}`, INV_STATUS_LABEL[inv.status] ?? inv.status)
            const invKey = inv.id || inv.invoiceNo || inv.createdAt
            const isOpen = selectedInvId === invKey
            const canCancel = ['draft','sent','overdue'].includes(inv.status) && inv.invoiceToken
            const isOverdue = inv.status === 'overdue' || (inv.dueDate && new Date(inv.dueDate+'T23:59:59') < new Date() && inv.status === 'sent')
            return (
              <div key={invKey} style={{ borderRadius:12, overflow:'hidden',
                border:`1px solid ${isOpen ? col+'60' : 'var(--border)'}`,
                background:'var(--surface)', transition:'border-color 0.15s',
                width:'100%', maxWidth:'100%', boxSizing:'border-box' }}>
                {/* ── Compact row ── */}
                <button onClick={() => setSelectedInvId(isOpen ? null : invKey)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                           background:'transparent', border:'none', cursor:'pointer',
                           textAlign:'left', width:'100%' }}>
                  <span style={{ width:7, height:7, borderRadius:'50%',
                                 background:col, flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text)',
                                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {inv.invoiceNo}{inv.note ? <span style={{ fontWeight:400, color:'var(--muted)' }}> · {inv.note}</span> : ''}
                    </div>
                    <div style={{ fontSize:9, color:'var(--muted)' }}>
                      {new Date(inv.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                      {inv.dueDate ? <span style={{ color: isOverdue ? '#ef4444' : 'var(--muted)' }}> · Due {new Date(inv.dueDate+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})}{isOverdue ? ' ⚠' : ''}</span> : ''}
                    </div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    {inv.amount && <div style={{ fontSize:12, fontWeight:700 }}>{inv.amount} iUSD</div>}
                    <span style={{ fontSize:9, padding:'1px 6px', borderRadius:20,
                                   fontWeight:600, background:col+'20', color:col }}>{lbl}</span>
                  </div>
                  <span style={{ fontSize:10, color:'var(--muted)', flexShrink:0,
                                 transform: isOpen ? 'rotate(90deg)' : 'none', transition:'transform 0.15s' }}>›</span>
                </button>

                {/* ── Compact inline detail ── */}
                {isOpen && (
                  <div style={{ borderTop:`1px solid var(--border)`, padding:'10px 12px',
                                display:'flex', flexDirection:'column', gap:8,
                                overflow:'hidden', maxWidth:'100%', boxSizing:'border-box' }}>
                    {/* QR + info side by side */}
                    <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                      {/* QR */}
                      {inv.payLink && (
                        <div style={{ flexShrink:0, borderRadius:8, overflow:'hidden',
                                      border:'1px solid var(--border)', width:100, height:100 }}>
                          <StyledQR url={inv.payLink} address={account?.shortId ?? ''} size={100} />
                        </div>
                      )}
                      {/* Info */}
                      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:4 }}>
                        <div style={{ fontSize:20, fontWeight:800, color:'var(--text)', lineHeight:1 }}>
                          {inv.amount ?? '—'} <span style={{ fontSize:10, fontWeight:400, color:'var(--muted)' }}>iUSD</span>
                        </div>
                        {inv.invoiceNo && <div style={{ fontSize:10, fontFamily:'monospace', color:'var(--muted)' }}>{inv.invoiceNo}</div>}
                        {inv.note && <div style={{ fontSize:11, color:'var(--text)' }}>{inv.note}</div>}
                        {inv.dueDate && <div style={{ fontSize:10, color: isOverdue ? '#ef4444' : 'var(--muted)' }}>
                          Due {new Date(inv.dueDate+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}{isOverdue ? ' ⚠ Overdue' : ''}
                        </div>}
                        <div style={{ fontSize:9, color:'var(--muted)' }}>
                          {new Date(inv.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                        </div>
                      </div>
                    </div>
                    {/* Pay link */}
                    {inv.payLink && (
                      <div style={{ display:'flex', gap:6, alignItems:'center',
                                    background:'var(--bg)', borderRadius:7, padding:'6px 8px',
                                    overflow:'hidden', minWidth:0 }}>
                        <span style={{ fontSize:9, fontFamily:'monospace', flex:1, minWidth:0, overflow:'hidden',
                                       textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--muted)' }}>
                          {inv.payLink}
                        </span>
                        <button onClick={() => navigator.clipboard.writeText(inv.payLink)}
                          style={{ flexShrink:0, fontSize:9, padding:'2px 8px', borderRadius:5,
                                   background:'var(--surface)', border:'1px solid var(--border)',
                                   cursor:'pointer', color:'var(--text)' }}>📋</button>
                        <button onClick={() => { if (navigator.share) navigator.share({ title: inv.invoiceNo ?? 'iPay Request', url: inv.payLink }).catch(()=>{}); else navigator.clipboard.writeText(inv.payLink) }}
                          style={{ flexShrink:0, fontSize:9, padding:'2px 8px', borderRadius:5,
                                   background:'var(--text)', border:'none',
                                   cursor:'pointer', color:'var(--surface)', fontWeight:700 }}>{t('request.share')}</button>
                      </div>
                    )}
                    {/* ── Payer Name editor (paid invoices — for reimbursement) ── */}
                    {inv.status === 'paid' && (
                      <div style={{ background:'var(--bg)', borderRadius:8,
                                    border:'1px solid var(--border)', padding:'8px 10px',
                                    display:'flex', flexDirection:'column', gap:6 }}>
                        <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase',
                                      letterSpacing:'0.05em', color:'var(--muted)' }}>
                          Payer Name (for reimbursement)
                        </div>
                        {editingPayerInvId === inv.id ? (
                          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                            <input
                              value={editingPayerName}
                              onChange={e => setEditingPayerName(e.target.value)}
                              placeholder="e.g. John Smith"
                              maxLength={60}
                              autoFocus
                              style={{ flex:1, fontSize:12, padding:'5px 8px',
                                       background:'var(--surface)', border:'1px solid var(--border)',
                                       borderRadius:6, color:'var(--text)', outline:'none' }}
                            />
                            <button onClick={async () => {
                              const newName = editingPayerName.trim()
                              try {
                                const r = await fetch(`${API_BASE}/invoice/${inv.invoiceToken}/status`, {
                                  method:'PATCH',
                                  headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
                                  body: JSON.stringify({ payerName: newName || null }),
                                })
                                if (!r.ok) throw new Error('Save failed')
                                setAllInvoices(prev => prev.map(i =>
                                  i.id === inv.id ? { ...i, payerName: newName || undefined } : i
                                ))
                                setEditingPayerInvId(null)
                              } catch(e: any) { alert('Failed to save: ' + e.message) }
                            }}
                              style={{ fontSize:11, fontWeight:700, padding:'5px 12px', borderRadius:6,
                                       background:'var(--text)', border:'none',
                                       cursor:'pointer', color:'var(--surface)', whiteSpace:'nowrap' }}>
                              Save
                            </button>
                            <button onClick={() => setEditingPayerInvId(null)}
                              style={{ fontSize:11, padding:'5px 10px', borderRadius:6,
                                       background:'none', border:'1px solid var(--border)',
                                       cursor:'pointer', color:'var(--muted)' }}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ flex:1, fontSize:12, color: inv.payerName ? 'var(--text)' : 'var(--muted)' }}>
                              {inv.payerName || 'Not set — click to edit'}
                            </span>
                            <button onClick={() => {
                              setEditingPayerName(inv.payerName || '')
                              setEditingPayerInvId(inv.id)
                            }}
                              style={{ fontSize:10, padding:'3px 10px', borderRadius:5,
                                       background:'none', border:'1px solid var(--border)',
                                       cursor:'pointer', color:'var(--muted)' }}>
                              ✎ Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Invoice PDF — business invoices only (fallback: has merchant data) */}
                    {(inv.invoiceMode === 'business' || (inv.invoiceMode !== 'personal' && !!inv.merchant)) && (
                      <button onClick={() => openInvoicePdf({
                          invoiceNo:     inv.invoiceNo,
                          amount:        inv.amount,
                          feeMode:       inv.feeMode,
                          note:          inv.note,
                          createdAt:     inv.createdAt,
                          dueDate:       inv.dueDate,
                          status:        inv.status,
                          payLink:       inv.payLink,
                          paymentId:     inv.paymentId,
                          txHash:        inv.txHash,
                          paidAt:        inv.paidAt,
                          myNickname:    account?.nickname,
                          myShortId:     account?.shortId,
                          payerRealName: inv.payerName,
                          payerNickname: inv.payerName,
                          payerShortId:  inv.payerShortId,
                          merchant,
                        })}
                        style={{ fontSize:10, color:'var(--muted)', background:'none',
                                 border:'1px solid var(--border)', borderRadius:7, padding:'5px 12px',
                                 cursor:'pointer', alignSelf:'flex-start' }}>
                        ↓ Invoice PDF
                      </button>
                    )}

                    {/* Refund — paid invoices only (merchant returns funds to payer) */}
                    {inv.status === 'paid' && inv.paymentId && (
                      <>
                        <button
                          onClick={() => handleRefundInvoice(inv)}
                          disabled={refundingInvId === inv.id}
                          style={{ fontSize:11, fontWeight:700, color:'#a855f7',
                                   background:'rgba(168,85,247,0.07)',
                                   border:'1px solid rgba(168,85,247,0.35)',
                                   borderRadius:7, padding:'6px 14px',
                                   cursor: refundingInvId === inv.id ? 'wait' : 'pointer',
                                   alignSelf:'flex-start',
                                   opacity: refundingInvId === inv.id ? 0.6 : 1 }}>
                          {refundingInvId === inv.id ? '…' : '↩ Refund Payer'}
                        </button>
                        {refundErr && refundingInvId === null && (
                          <div style={{ fontSize:10, color:'#ef4444' }}>⚠ {refundErr}</div>
                        )}
                      </>
                    )}

                    {/* Actions */}
                    {canCancel && (
                      <button onClick={async () => {
                          if (!confirm('Cancel this invoice?')) return
                          try {
                            await fetch(`${API_BASE}/invoice/${inv.invoiceToken}/revoke`, {
                              method:'POST', headers:{ Authorization:`Bearer ${token}` }
                            })
                            if (token) {
                              await updateInvoiceStatus(inv.invoiceToken, { status: 'cancelled' }, token).catch(() => {})
                            }
                            setAllInvoices(prev => prev.map(i => i.id === inv.id
                              ? { ...i, status:'cancelled', revokedAt:new Date().toISOString() } : i))
                            setSelectedInvId(null)
                          } catch(e: any) { alert('Cancel failed: ' + e.message) }
                        }}
                        style={{ fontSize:10, color:'#ef4444', background:'none',
                                 border:'1px solid #ef444440', borderRadius:7, padding:'5px 12px',
                                 cursor:'pointer', alignSelf:'flex-start' }}>
                        ✕ Cancel Invoice
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── New tab: form ─────────────────────────────────────────────── */}
      {pageTab === 'new' && <>



      {/* Business identity card */}
      {mode === 'business' && merchant.name && (
        <div style={{
          width:'100%', maxWidth:480,
          background: merchant.color + '15',
          border: `1px solid ${merchant.color}40`,
          borderRadius:14, padding:'12px 16px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{
              width:32, height:32, borderRadius:7,
              background: merchant.color, display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:14, color:'white', fontWeight:800,
            }}>
              {merchant.name[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, fontFamily: merchant.fontFamily || 'inherit',
                            color: merchant.color }}>{merchant.name}</div>
              {merchant.description && (
                <div style={{ fontSize:10, color:'var(--muted)' }}>{merchant.description}</div>
              )}
            </div>
          </div>
          <button onClick={() => navigate('/app/merchant')}
            style={{ fontSize:10, color:'var(--muted)', background:'none', border:'none',
                     cursor:'pointer', textDecoration:'underline' }}>Edit →</button>
        </div>
      )}
      {mode === 'business' && !merchant.name && (
        <button onClick={() => navigate('/app/merchant')}
          style={{ ...btnGhost, width:'100%', maxWidth:480, fontSize:11 }}>
          {t('merchant.setUpProfile')}
        </button>
      )}

      {/* ── Compact Form Card ───────────────────────────────────────────── */}
      <div style={{ width:'100%', maxWidth:480, background:'var(--surface)',
                    border:'1px solid var(--border)', borderRadius:16,
                    overflow:'hidden', boxSizing:'border-box' }}>

        {/* Amount row */}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={fieldLabel}>{t('request.amountLabel')}</span>
            <input
              type="number" min="0" step="any" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)}
              style={{ flex:1, background:'transparent', border:'none', outline:'none',
                       fontSize:18, fontWeight:700, color:'var(--text)', minWidth:0 }}
            />
            <span style={{ fontSize:12, color:'var(--muted)', fontWeight:600,
                           flexShrink:0 }}>iUSD</span>
          </div>
          {amount && amtNum > 0 && amtNum < 0.1 && (
            <div style={{ fontSize:10, color:'#ef4444', marginTop:2 }}>
              Minimum invoice amount is 0.1 iUSD
            </div>
          )}
          {amount && amtNum >= 0.1 && (
            <div style={{ fontSize:10, color:'#22c55e', marginTop:2 }}>
              You receive: {youGet.toFixed(4)} iUSD
              {amtNum * FEE_RATE > FEE_CAP && (
                <span style={{ color:'#f59e0b', marginLeft:6 }}>· fee capped at 5 iUSD</span>
              )}
            </div>
          )}
          {amtNum >= 1000 && (
            <div style={{ fontSize:10, fontWeight:800, color:'#f59e0b', marginTop:2, letterSpacing:'0.05em' }}>
              MAX!!
            </div>
          )}
        </div>

        {/* Note row */}
        <div style={{ padding:'8px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ ...fieldLabel, flexShrink:0, margin:0 }}>{t('request.noteLabel')}</span>
          <input type="text" placeholder={t('request.notePlaceholder')}
            value={note} onChange={e => setNote(e.target.value)} maxLength={80}
            style={{ flex:1, background:'transparent', border:'none', outline:'none',
                     fontSize:13, color:'var(--text)', boxSizing:'border-box', minWidth:0 }} />
        </div>
        {/* Tax Number row */}
        <div style={{ padding:'8px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ ...fieldLabel, flexShrink:0, margin:0 }}>{t('request.taxNoLabel')}</span>
          <input type="text" placeholder={t('common.optional')}
            value={taxNum} onChange={e => setTaxNum(e.target.value)} maxLength={50}
            style={{ flex:1, background:'transparent', border:'none', outline:'none',
                     fontSize:13, color:'var(--text)', boxSizing:'border-box', minWidth:0 }} />
        </div>

        {/* Due date row */}
        <div style={{ padding:'8px 14px', display:'flex', alignItems:'center', gap:6,
                      borderBottom: mode === 'business' ? '1px solid var(--border)' : 'none' }}>
          <span style={{ ...fieldLabel, flexShrink:0, margin:0 }}>{t('request.dueLabel')}</span>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            style={{ flex:1, background:'transparent', border:'none', outline:'none',
                     fontSize:13, color:'var(--text)', boxSizing:'border-box', minWidth:0,
                     textAlign:'left', WebkitAppearance:'none' as any, paddingLeft:0 }} />
        </div>

        {/* Business extras: Invoice No + Payer ID */}
        {mode === 'business' && (
          <>
            <div style={{ padding:'8px 14px', borderBottom:'1px solid var(--border)',
                          display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ ...fieldLabel, flexShrink:0, margin:0 }}>{t('request.invLabel')}</span>
              <span style={{ fontSize:13, fontWeight:600,
                              color:'var(--text)', flex:1 }}>{invPreview}</span>
              <button onClick={() => { bumpInvoiceNo(merchant); forceUpdate(n => n + 1) }}
                style={{ fontSize:9, padding:'2px 7px', borderRadius:5,
                         border:'1px solid var(--border)', background:'none',
                         color:'var(--muted)', cursor:'pointer', flexShrink:0 }}>
                Skip
              </button>
            </div>

            <div style={{ padding:'8px 14px', display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ ...fieldLabel, flexShrink:0, margin:0 }}>{t('request.payerLabel')}</span>
              <input type="text" placeholder={t('request.payerPlaceholder')}
                value={payerRealName} onChange={e => setPayerRealName(e.target.value)} maxLength={60}
                style={{ flex:1, background:'transparent', border:'none', outline:'none',
                         fontSize:13, color:'var(--text)', boxSizing:'border-box', minWidth:0 }} />
            </div>
          </>
        )}
      </div>




      {/* Auto-claim toggle */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', alignItems:'center',
                    justifyContent:'space-between', padding:'8px 12px',
                    background:'var(--surface)', border:'1px solid var(--border)',
                    borderRadius:10 }}>
        <span style={fieldLabel}>{t('settings.account.autoClaim')}</span>
        <button onClick={() => navigate('/app/settings')}
          style={{ fontSize:9, padding:'3px 8px', borderRadius:6, border:'1px solid var(--border)',
                   background:'transparent', color: autoClaim ? '#22c55e' : 'var(--muted)',
                   cursor:'pointer', fontWeight:700, flexShrink:0 }}>
          {autoClaim ? t('common.on') : t('common.off')} →
        </button>
      </div>

      {/* Generate button */}
      <button onClick={() => { setGenerating(true); generate().catch(e => { setGenError(e.message); setGenerating(false) }) }}
        disabled={!account?.shortId || amtNum < 0.1 || amtNum > 1000}
        style={{
          ...btnFill,
          width:'100%', maxWidth:480,
          padding:'12px', fontSize:14, fontWeight:800,
          opacity: (account?.shortId && amtNum >= 0.1 && amtNum <= 1000) ? 1 : 0.5,
          cursor: (account?.shortId && amtNum >= 0.1 && amtNum <= 1000) ? 'pointer' : 'not-allowed',
        }}>
        {generating ? 'Generating…' : amtNum > 1000 ? 'Max 1,000 iUSD' : mode === 'business' ? 'Generate Invoice' : 'Generate Request'}
      </button>



      </>}
    </div>
  )
}

// ── Merchant page re-exports ───────────────────────────────────────────────
export { DEFAULT_MERCHANT as default }

// ── Styles ────────────────────────────────────────────────────────────────
const pageSt: React.CSSProperties = {
  minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
  display:'flex', flexDirection:'column', alignItems:'center',
  padding:'12px 12px 80px', gap:8, boxSizing:'border-box',
  width:'100%', maxWidth:600, margin:'0 auto', overflowX:'hidden',
}
const headerSt: React.CSSProperties = {
  width:'100%', maxWidth:480, display:'flex', alignItems:'center',
  flexWrap:'wrap', gap:6, paddingBottom:10, borderBottom:'1px solid var(--border)',
  boxSizing:'border-box',
}
const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
const fieldLabel: React.CSSProperties = {
  fontSize:11, fontWeight:600,
  color:'var(--muted)', flexShrink:0, minWidth:42,
}
const btnFill: React.CSSProperties = {
  padding:'12px 20px', borderRadius:12, border:'none',
  background:'var(--text)', color:'var(--surface)',
  fontSize:13, fontWeight:700, cursor:'pointer',
}
const btnGhost: React.CSSProperties = {
  padding:'12px 20px', borderRadius:12,
  border:'1px solid var(--border)',
  background:'transparent', color:'var(--text)',
  fontSize:13, fontWeight:600, cursor:'pointer',
}
