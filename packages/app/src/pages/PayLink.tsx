/**
 * PayLink — /pay/:shortId
 * Public landing page reached by scanning a QR code or opening a payment link.
 * Resolves recipient, shows fee breakdown, and executes payment inline (no redirect).
 *
 * Payment flow (same as Transfer page):
 *   1. Fetch recipient viewing pubkey
 *   2. Fetch sender viewing pubkey
 *   3. buildDepositTx → submitTxBlock (feegrant sponsored) or requestTxBlock (fallback)
 *   4. If invToken present → link-payment (fire-and-forget)
 *   5. Show success with txHash
 */
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { API_BASE } from '../config'
import { useConfig } from '../hooks/useConfig'
import { buildDepositTx } from '../services/orderBuilder'
import { hexToBytes } from '../services/orderCrypto'
import { clearSession } from '../services/auth'
import { UserSeal } from '../components/UserSeal'
import { useAuthContext } from '../hooks/AuthContext'
import { StyledQR } from '../components/StyledQR'
import { upsertContact } from '../lib/contactsStore'
import { QuickLogin } from '../components/QuickLogin'

const FEE_RATE = 0.005
const FEE_CAP  = 5.0
const IUSD_DECIMALS = 6
// Relayer address comes from API config (see useConfig)

interface RecipientInfo {
  shortId:      string
  nickname:     string
  avatarSvg:    string | null
  viewingPubkey: string
}

type PayStep = 'idle' | 'building' | 'signing' | 'done' | 'error'

export function PayLink() {
  const { t } = useTranslation()
  const { shortId }      = useParams<{ shortId: string }>()
  const [params]         = useSearchParams()
  const navigate         = useNavigate()
  const smartClose       = useSmartClose('/')
  const { address, token, status: authStatus } = useAuthContext()
  const { requestTxBlock, submitTxBlock } = useInterwovenKit()
  const { config } = useConfig()

  const requestedAmount = params.get('amount') ?? ''
  // These can be overridden by server-side invoice data (Route A: token-based)
  const [feeMode,     setFeeMode]     = useState(params.get('feeMode') ?? 'recipient')
  const [note,        setNote]        = useState(params.get('note') ?? '')
  const [_merchant,   setMerchant]    = useState(params.get('merchant') ?? '')
  // Parse merchant — may be a JSON object string or plain name string
  const merchantObj: { name?:string; logoUrl?:string; description?:string; taxId?:string;
                       email?:string; phone?:string; website?:string; address?:string;
                       color?:string } | null = (() => {
    if (!_merchant) return null
    try { return JSON.parse(_merchant) } catch { return { name: _merchant } }
  })()
  const [invoiceMode, setInvoiceMode] = useState<'personal'|'business'>('personal')
  const [dueDate,     setDueDate]     = useState<string|null>(params.get('due'))
  const [invToken,    setInvToken]    = useState<string|null>(params.get('inv') ?? params.get('token'))
  const [invoiceNo,   setInvoiceNo]   = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [preClaimKey, setPreClaimKey]   = useState<string | null>(null)
  const [preRefundKey, setPreRefundKey] = useState<string | null>(null)

  const [recipient, setRecipient] = useState<RecipientInfo | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [loadErr,   setLoadErr]   = useState<string | null>(null)

  function setFriendlyError(kind: 'NOT_FOUND' | 'CANCELLED' | 'PAID' | 'PROCESSING' | 'INVALID') {
    if (kind === 'NOT_FOUND')   setLoadErr('This invoice was not found (it may have been deleted).')
    else if (kind === 'CANCELLED') setLoadErr('This invoice has been cancelled and can no longer be paid.')
    else if (kind === 'PAID')   setLoadErr('This invoice has already been paid. No further payment is needed.')
    else if (kind === 'PROCESSING') setLoadErr('Payment is processing on-chain. Please check again shortly.')
    else setLoadErr('Invalid payment link.')
  }
  const [amount,    setAmount]    = useState(requestedAmount)
  const invoiceDisplayId = invoiceNo || invToken || shortId || '—'
  const recipientPrivacyId = recipient?.shortId
    ? `${recipient.shortId.slice(0,4)}◆${recipient.shortId.slice(-4)}`
    : null
  const cleanNote = (note || '').trim()
  const showNote = !!cleanNote && cleanNote !== String(invoiceDisplayId).trim()
  const invoiceTokenForDisplay = invToken || shortId || ''
  const invoiceUrl = invoiceTokenForDisplay ? `https://iusd-pay.xyz/pay/${invoiceTokenForDisplay}` : ''
  // QR rendered via StyledQR component (auto dark/light mode)

  // Mode badge — shown in every status card to distinguish personal vs business invoice
  const modeBadge = invoiceMode === 'business'
    ? <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontWeight:700,
                     letterSpacing:'0.1em', textTransform:'uppercase' as const,
                     background:'rgba(99,102,241,0.12)', color:'#6366f1',
                     borderRadius:6, padding:'2px 8px' }}>🏪 Business Invoice</span>
    : <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:9, fontWeight:700,
                     letterSpacing:'0.1em', textTransform:'uppercase' as const,
                     background:'rgba(34,197,94,0.10)', color:'#22c55e',
                     borderRadius:6, padding:'2px 8px' }}>👤 Personal Payment</span>

  const statusHeadline = (() => {
    const e = (loadErr || '').toLowerCase()
    if (e.includes('cancel')) return 'Cancelled'
    if (e.includes('not found')) return 'Not Found'
    if (e.includes('processing')) return 'Awaiting Payment'
    if (e.includes('paid')) return 'Paid'
    if (e.includes('invalid')) return 'Invalid Link'
    return 'Invoice Status'
  })()
  const statusColor = (() => {
    if (statusHeadline === 'Paid') return '#22c55e'
    if (statusHeadline === 'Cancelled') return '#6b7280'
    if (statusHeadline === 'Awaiting Payment') return '#f59e0b'
    if (statusHeadline === 'Not Found' || statusHeadline === 'Invalid Link') return '#6b7280'
    return 'var(--text)'
  })()

  const [step,       setStep]       = useState<PayStep>('idle')
  const [payErr,     setPayErr]     = useState<string | null>(null)
  const [txHash,     setTxHash]     = useState<string | null>(null)
  const [autoRegistering, setAutoRegistering] = useState(false)
  const [alreadyPaid,     setAlreadyPaid]     = useState(false)
  const [invProcessing,   setInvProcessing]   = useState(false)
  // redirectCountdown removed — bounded claim checks handle redirect now

  // ── Auto-register unregistered payers ─────────────────────────────────
  // PayLink is a public page — payers may have a token but no account yet.
  // Silently register them so they can pay without leaving the page.
  useEffect(() => {
    if (authStatus !== 'unregistered' || !token || autoRegistering) return
    setAutoRegistering(true)
    fetch(`${API_BASE}/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success || d.account) {
          // Registration done — reload to let useAuth pick up fresh account
          window.location.reload()
        } else {
          console.warn('[PayLink] auto-register failed:', d)
          setAutoRegistering(false)
        }
      })
      .catch(e => {
        console.warn('[PayLink] auto-register error:', e.message)
        setAutoRegistering(false)
      })
  }, [authStatus, token])

  // ── Claim status state (post-payment)
  const [claimStatus, setClaimStatus] = useState<'pending'|'claimed'>('pending')

  // ── Auto-redirect + bounded claim-status checks after payment ─────────────
  useEffect(() => {
    if (step !== 'done') return

    let dead = false
    const timers: ReturnType<typeof setTimeout>[] = []

    // Bounded checks — NOT a polling loop. Just 3 one-shot timeouts.
    // Use invToken (invoice token) or shortId (URL param) — NOT the JWT auth token.
    const pollToken = invToken || shortId
    const CHECK_DELAYS = [15_000, 45_000, 90_000]
    CHECK_DELAYS.forEach(delay => {
      timers.push(setTimeout(async () => {
        if (dead || !pollToken) return
        try {
          const res = await fetch(`${API_BASE}/paylink/${pollToken}/resolve`)
          if (!res.ok) return
          const body = await res.json()
          if (body.chainStatus === 3) {
            setClaimStatus('claimed')
            // Auto-redirect 2 seconds after claim confirmed
            timers.push(setTimeout(() => { if (!dead) navigate('/app', { replace: true }) }, 2000))
          }
        } catch {}
      }, delay))
    })

    // Final redirect after 95s if still pending
    timers.push(setTimeout(() => { if (!dead) navigate('/app', { replace: true }) }, 95_000))

    return () => { dead = true; timers.forEach(clearTimeout) }
  }, [step])

  // ── Fee math ─────────────────────────────────────────────────────────────
  // Contract always takes fee FROM the deposited amount:
  //   recipient_gets = deposit_amount - fee
  //
  // feeMode = 'recipient': sender deposits EXACT invoice amount; fee absorbed by recipient
  //   deposit = invoice_amount
  //   recipient gets = invoice_amount - fee
  //
  // feeMode = 'sender': sender deposits gross so recipient gets FULL invoice amount
  //   deposit = invoice_amount / (1 - FEE_RATE)  →  recipient gets exactly invoice_amount
  //
  // contract MIN_AMOUNT = 10000 micro-iUSD, but for feeMode='recipient' the net amount
  // (deposit - fee) must be ≥ MIN. So effective minimum deposit = ceil(10000 / (1-0.005)) = 10050.
  const CONTRACT_MIN = 10000
  const MIN_DEPOSIT_MICRO = feeMode === 'recipient'
    ? Math.ceil(CONTRACT_MIN / (1 - FEE_RATE))   // 10050
    : CONTRACT_MIN                                 // 10000
  const amountNum  = parseFloat(amount) || 0
  const depositMicro = feeMode === 'sender'
    ? Math.round(amountNum * 10 ** IUSD_DECIMALS / (1 - FEE_RATE))   // gross up
    : Math.round(amountNum * 10 ** IUSD_DECIMALS)                      // exact invoice amount
  const feeMicro   = Math.min(
    Math.round(depositMicro * FEE_RATE),
    Math.round(FEE_CAP * 10 ** IUSD_DECIMALS)
  )
  const feeNum     = feeMicro / 10 ** IUSD_DECIMALS
  const youPayMicro = depositMicro                                      // what leaves sender's wallet
  const youPay     = youPayMicro / 10 ** IUSD_DECIMALS
  const theyGet    = (depositMicro - feeMicro) / 10 ** IUSD_DECIMALS   // what recipient receives
  const depositNum = youPay
  const amountMicro = depositMicro   // amount passed to contract deposit()

  // ── Resolve recipient ─────────────────────────────────────────────────────
  // Route A: /pay/{24-char-hex-token} → load full invoice from DB
  // Route B: /pay/{16-char-shortId}?params → direct pay with URL params
  useEffect(() => {
    if (!shortId) { setFriendlyError('INVALID'); setLoading(false); return }

    // Detect: 24-char hex = invoice token; 16-char = shortId
    const isInvoiceToken = /^[0-9a-f]{24}$/i.test(shortId)

    if (isInvoiceToken) {
      // Route A: aggregated resolve endpoint (invoice + recipient + viewing key in one RTT)
      fetch(`${API_BASE}/paylink/${shortId}/resolve`)
        .then(async r => {
          if (r.status === 410) {
            // Rich cancelled payload — hydrate state before throwing
            const body = await r.json().catch(() => ({}))
            if (body.invoiceNo)   setInvoiceNo(body.invoiceNo)
            if (body.amount)      setAmount(body.amount)
            if (body.note)        setNote(body.note)
            if (body.merchant)    setMerchant(body.merchant)
            if (body.invoiceMode) setInvoiceMode(body.invoiceMode === 'business' ? 'business' : 'personal')
            if (body.dueDate)     setDueDate(body.dueDate)
            if (body.recipient) setRecipient({ shortId: body.recipient.shortId, nickname: body.recipient.nickname, avatarSvg: body.recipient.avatarSvg ?? null, viewingPubkey: '' })
            throw new Error('CANCELLED')
          }
          if (r.status === 404) throw new Error('NOT_FOUND')
          return r.json()
        })
        .then(inv => {
          if (inv.paymentId)   setPaymentId(inv.paymentId)
          if (inv.claimKey)    setPreClaimKey(inv.claimKey)
          if (inv.refundKey)   setPreRefundKey(inv.refundKey)
          if (inv.invoiceNo)   setInvoiceNo(inv.invoiceNo)
          if (inv.amount)      setAmount(inv.amount)
          if (inv.feeMode)     setFeeMode(inv.feeMode)
          if (inv.note)        setNote(inv.note)
          if (inv.merchant)    setMerchant(inv.merchant)
          if (inv.invoiceMode) setInvoiceMode(inv.invoiceMode === 'business' ? 'business' : 'personal')
          if (inv.dueDate)     setDueDate(inv.dueDate)
          setInvToken(shortId)

          if (inv.recipientShortId && inv.viewingPubkey && inv.recipient) {
            const a = inv.recipient
            setRecipient({
              shortId:       a.shortId,
              nickname:      a.nickname,
              avatarSvg:     a.avatarSvg ?? a.shortSealSvg ?? null,
              viewingPubkey: inv.viewingPubkey,
            })
          }

          // Block re-payment: chainStatus=3 paid, chainStatus=2 in-flight
          if (inv.chainStatus === 3) { setAlreadyPaid(true); setLoading(false); return }
          if (inv.chainStatus === 2) { setInvProcessing(true); setLoading(false); return }
          if (!inv.recipientShortId || !inv.viewingPubkey || !inv.recipient) throw new Error('Invoice missing recipient')
        })
        .catch(async (e) => {
          // Fallback: even if resolve fails, check invoice status directly
          try {
            const r2 = await fetch(`${API_BASE}/invoice/${shortId}`)
            const inv2 = await r2.json()
            if (inv2?.chainStatus === 3) {
              if (inv2?.invoiceNo) setInvoiceNo(inv2.invoiceNo)
              if (inv2?.paymentId) setPaymentId(inv2.paymentId)
              if (inv2?.recipientShortId) {
                setRecipient((prev) => prev ?? {
                  shortId: inv2.recipientShortId,
                  nickname: inv2.recipientShortId,
                  avatarSvg: null,
                  viewingPubkey: '',
                })
              }
              setAlreadyPaid(true)
              return
            }
            if (inv2?.chainStatus === 2) {
              if (inv2?.invoiceNo) setInvoiceNo(inv2.invoiceNo)
              setInvProcessing(true)
              return
            }
            if (inv2?.status === 'revoked') { setFriendlyError('CANCELLED'); return }
            if (inv2?.status === 'unknown') { setFriendlyError('NOT_FOUND'); return }
          } catch {}
          const msg = String(e?.message || '')
          if (msg.includes('CANCELLED') || msg.includes('REVOKED')) setFriendlyError('CANCELLED')
          else if (msg.includes('NOT_FOUND')) setFriendlyError('NOT_FOUND')
          else setFriendlyError('INVALID')
        })
        .finally(() => setLoading(false))
    } else {
      // Route B: shortId with URL params (personal mode / legacy)
      const checkRevoked = invToken
        ? fetch(`${API_BASE}/invoice/${invToken}`)
            .then(r => r.json())
            .then(d => {
              if (d?.chainStatus === 3) throw new Error('PAID')
              if (d?.chainStatus === 2) throw new Error('PROCESSING')
              if (d?.status === 'revoked') throw new Error('CANCELLED')
              if (d?.status === 'unknown') throw new Error('NOT_FOUND')
            })
        : Promise.resolve()

      checkRevoked
        .then(() => Promise.all([
          fetch(`${API_BASE}/account/${encodeURIComponent(shortId)}`).then(r => r.json()),
          fetch(`${API_BASE}/account/viewing-pubkey/${encodeURIComponent(shortId)}`).then(r => r.json()),
        ]))
        .then(([acctData, vpData]) => {
          if (acctData.error || !acctData.account) throw new Error('Unknown recipient')
          const a = acctData.account
          if (!vpData?.viewingPubkey) throw new Error('Recipient has no viewing key')
          setRecipient({
            shortId:       a.shortId,
            nickname:      a.nickname,
            avatarSvg:     a.avatarSvg ?? a.shortSealSvg ?? null,
            viewingPubkey: vpData.viewingPubkey,
          })
        })
        .catch((e) => {
          const msg = String(e?.message || '')
          if (msg.includes('PAID')) setAlreadyPaid(true)
          else if (msg.includes('PROCESSING')) setInvProcessing(true)
          else if (msg.includes('CANCELLED') || msg.includes('REVOKED')) setFriendlyError('CANCELLED')
          else if (msg.includes('NOT_FOUND')) setFriendlyError('NOT_FOUND')
          else setFriendlyError('INVALID')
        })
        .finally(() => setLoading(false))
    }
  }, [shortId])

  // ── Execute payment ───────────────────────────────────────────────────────
  async function handlePay() {
    if (!recipient || !address || !token || amountNum <= 0) return
    if (amountMicro < MIN_DEPOSIT_MICRO) {
      const minDisplay = (MIN_DEPOSIT_MICRO / 1_000_000).toFixed(4).replace(/\.?0+$/, '')
      setPayErr(`Minimum payment is ${minDisplay} iUSD (${feeMode === 'recipient' ? 'recipient receives at least 0.01 iUSD' : 'contract minimum'})`)
      return
    }

    // Re-check invoice status before paying (may have been cancelled after page load)
    const checkToken = invToken || shortId
    if (checkToken) {
      try {
        const checkRes = await fetch(`${API_BASE}/invoice/${checkToken}`)
        if (checkRes.ok) {
          const checkData = await checkRes.json()
          if (checkData?.status === 'revoked' || checkData?.status === 'cancelled') {
            setFriendlyError('CANCELLED')
            return
          }
        }
      } catch {}
    }

    setStep('building'); setPayErr(null)

    try {
      // 1. Get sender viewing pubkey
      const vpRes  = await fetch(`${API_BASE}/account/viewing-pubkey`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (vpRes.status === 401 || vpRes.status === 403) {
        // Stale session (e.g. after server reset) — clear and ask user to reconnect
        clearSession(address)
        window.location.reload()  // easiest UX: reload triggers re-auth
        return
      }
      const vpData = await vpRes.json()
      if (!vpData?.viewingPubkey) throw new Error('Could not fetch your viewing key. Please reconnect.')

      // 2. Build deposit tx
      const result = await buildDepositTx({
        sender:                 address,
        recipient:              recipient.shortId,
        amount:                 BigInt(amountMicro),
        memo:                   note,
        senderViewingPubKey:    hexToBytes(vpData.viewingPubkey),
        recipientViewingPubKey: hexToBytes(recipient.viewingPubkey),
        // Use pre-generated keys from invoice (prevents duplicate payments)
        preGeneratedId:         paymentId ?? undefined,
        preGeneratedClaimKey:   preClaimKey ?? undefined,
        preGeneratedRefundKey:  preRefundKey ?? undefined,
      })

      // 3. Sign + broadcast (feegrant first, user-pays fallback)
      setStep('signing')
      const relayerAddr = config?.relayer
      let txRes: any
      try {
        if (!relayerAddr) throw new Error('No relayer configured')
        txRes = await submitTxBlock({
          messages: [result.txMsg],
          fee: {
            amount: [{ denom: 'uinit', amount: '6000' }],
            gas: '400000',
            granter: relayerAddr,
          },
        })
      } catch {
        txRes = await requestTxBlock({ messages: [result.txMsg] })
      }

      if (txRes?.code !== 0 && txRes?.code !== undefined)
        throw new Error((txRes as any)?.rawLog ?? 'Transaction failed')

      setTxHash((txRes as any)?.transactionHash ?? (txRes as any)?.txHash ?? 'ok')
      setPaymentId(result.id)
      setStep('done')

      // Redirect to receipt page
      const receiptPath = `/receipt/0x${result.id.replace(/^0x/i, '')}`
      const rParams = new URLSearchParams()
      if (invToken) rParams.set('inv', invToken)
      rParams.set('from', 'transfer')
      const rq = rParams.toString()
      setTimeout(() => { window.location.href = `${receiptPath}${rq ? `?${rq}` : ''}` }, 500)

      // Auto-add recipient to contacts
      if (address && recipient?.shortId) {
        upsertContact(address, {
          shortId:      recipient.shortId,
          nickname:     recipient.nickname ?? recipient.shortId,
          shortSealSvg: (recipient as any).shortSealSvg ?? null,
        })
      }

      // 4. Link invoice → payment (fire-and-forget)
      if (invToken) {
        fetch(`${API_BASE}/invoice/${invToken}/link-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ paymentId: result.id, payerAddress: address, amountMicro: String(amountMicro) }),
        }).catch(() => {})
      }
      // Record payment intent
      fetch(`${API_BASE}/account/payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId: result.id, recipientShortId: recipient.shortId, amountMicro: String(amountMicro) }),
      }).catch(() => {})

    } catch (e: any) {
      setPayErr(e.message ?? 'Payment failed')
      setStep('error')
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={page}>
      <div style={{ color:'var(--muted)', fontSize:13 }}>{t('payLink.resolving')}</div>
    </div>
  )

  // ── Error loading ─────────────────────────────────────────────────────────
  if (loadErr && !invProcessing && !alreadyPaid) return (
    <div style={page}>
      <div style={{ ...card, gap:14, padding:'20px 18px', alignItems:'stretch' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ width:88, height:88, borderRadius:10, border:'1px solid var(--border)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'white', flexShrink:0 }}>
            {invoiceUrl ? <StyledQR url={invoiceUrl} address={recipient?.shortId ?? shortId ?? ''} size={88} /> : <div style={{ fontSize:12, color:'var(--muted)' }}>QR</div>}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:22, fontWeight:900, lineHeight:1.1, color: statusColor }}>{statusHeadline}</div>
            <div style={{ fontSize:26, fontWeight:900, lineHeight:1.05, marginTop:4 }}>{amount || '—'} <span style={{ fontSize:13, fontWeight:600, color:'var(--muted)' }}>iUSD</span></div>
          </div>
          <div style={{ display:'flex', flexDirection:'column' as const, alignItems:'flex-end', flexShrink:0, gap:3 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <img src="/images/iusd.png?v=20260414" style={{ width:18, height:18, borderRadius:'50%' }} alt="" />
              <span style={{ fontSize:12, fontWeight:800, letterSpacing:'0.03em' }}>iUSD Pay</span>
            </div>
            <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'0.08em', textTransform:'uppercase' as const }}>INITIA</span>
          </div>
        </div>

        <div style={{ border:'1px solid var(--border)', borderRadius:12, padding:'12px 12px', display:'grid', gap:8, background:'var(--bg)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', color:'var(--muted)' }}>{t('payLink.invoiceDetails')}</div>
            {modeBadge}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('payLink.status')}</span>
            <span style={{ fontWeight:700, color: statusColor }}>{statusHeadline}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('payLink.invoiceId')}</span>
            <span style={{ fontWeight:700 }}>{invoiceDisplayId}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('payLink.recipient')}</span>
            <span style={{ fontWeight:700 }}>{recipient?.nickname ?? '—'}{recipientPrivacyId ? ` @ ${recipientPrivacyId}` : ''}</span>
          </div>
          {showNote && <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>{t('request.noteLabel')}</span><span style={{ fontWeight:700, textAlign:'right', wordBreak:'break-word' }}>{cleanNote}</span></div>}
          {dueDate && <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>{t('payLink.dueDate')}</span><span style={{ fontWeight:700 }}>{dueDate}</span></div>}
        </div>



        <button onClick={() => navigate('/')} style={btnFill}>{t('giftClaim.goHome')}</button>
      </div>
    </div>
  )

  // ── Processing ───────────────────────────────────────────────────────────
  if (invProcessing) return (
    <div style={page}>
      <div style={{ ...card, gap:14, padding:'20px 18px', alignItems:'stretch' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ width:88, height:88, borderRadius:10, border:'1px solid var(--border)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'white', flexShrink:0 }}>
            {invoiceUrl ? <StyledQR url={invoiceUrl} address={recipient?.shortId ?? shortId ?? ''} size={88} /> : <div style={{ fontSize:12, color:'var(--muted)' }}>QR</div>}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:22, fontWeight:900, lineHeight:1.1, color:'#f59e0b' }}>{t('request.status.sent')}</div>
            <div style={{ fontSize:26, fontWeight:900, lineHeight:1.05, marginTop:4 }}>{amount || '—'} <span style={{ fontSize:13, fontWeight:600, color:'var(--muted)' }}>iUSD</span></div>
          </div>
          <div style={{ display:'flex', flexDirection:'column' as const, alignItems:'flex-end', flexShrink:0, gap:3 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <img src="/images/iusd.png?v=20260414" style={{ width:18, height:18, borderRadius:'50%' }} alt="" />
              <span style={{ fontSize:12, fontWeight:800, letterSpacing:'0.03em' }}>iUSD Pay</span>
            </div>
            <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'0.08em', textTransform:'uppercase' as const }}>INITIA</span>
          </div>
        </div>

        <div style={{ border:'1px solid var(--border)', borderRadius:12, padding:'12px 12px', display:'grid', gap:8, background:'var(--bg)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', color:'var(--muted)' }}>{t('payLink.invoiceDetails')}</div>
            {modeBadge}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>Status</span><span style={{ fontWeight:700, color:'#f59e0b' }}>{t('request.status.sent')}</span></div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>Invoice ID</span><span style={{ fontWeight:700 }}>{invoiceDisplayId}</span></div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>Recipient</span><span style={{ fontWeight:700 }}>{recipient?.nickname ?? '—'}{recipientPrivacyId ? ` @ ${recipientPrivacyId}` : ''}</span></div>
          {showNote && <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>{t('request.noteLabel')}</span><span style={{ fontWeight:700, textAlign:'right', wordBreak:'break-word' }}>{cleanNote}</span></div>}
        </div>



      </div>
    </div>
  )

  if (alreadyPaid) return (
    <div style={page}>
      <div style={{ ...card, gap:14, padding:'20px 18px', alignItems:'stretch' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ width:88, height:88, borderRadius:10, border:'1px solid var(--border)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'white', flexShrink:0 }}>
            {invoiceUrl ? <StyledQR url={invoiceUrl} address={recipient?.shortId ?? shortId ?? ''} size={88} /> : <div style={{ fontSize:12, color:'var(--muted)' }}>QR</div>}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:22, fontWeight:900, lineHeight:1.1, color:'#22c55e' }}>{t('request.status.paid')}</div>
            <div style={{ fontSize:26, fontWeight:900, lineHeight:1.05, marginTop:4 }}>{amount || '—'} <span style={{ fontSize:13, fontWeight:600, color:'var(--muted)' }}>iUSD</span></div>
          </div>
          <div style={{ display:'flex', flexDirection:'column' as const, alignItems:'flex-end', flexShrink:0, gap:3 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <img src="/images/iusd.png?v=20260414" style={{ width:18, height:18, borderRadius:'50%' }} alt="" />
              <span style={{ fontSize:12, fontWeight:800, letterSpacing:'0.03em' }}>iUSD Pay</span>
            </div>
            <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'0.08em', textTransform:'uppercase' as const }}>INITIA</span>
          </div>
        </div>

        <div style={{ border:'1px solid var(--border)', borderRadius:12, padding:'12px 12px', display:'grid', gap:8, background:'var(--bg)' }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', color:'var(--muted)' }}>{t('payLink.paymentProof')}</div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('payLink.status')}</span>
            <span style={{ fontWeight:700, color:'#22c55e' }}>{t('request.status.paid')}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('payLink.invoiceId')}</span>
            <span style={{ fontWeight:700 }}>{invoiceDisplayId}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('payLink.recipient')}</span>
            <span style={{ fontWeight:700 }}>{recipient?.nickname ?? '—'}{recipientPrivacyId ? ` @ ${recipientPrivacyId}` : ''}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
            <span style={{ color:'var(--muted)' }}>{t('transfer.amountLabel')}</span>
            <span style={{ fontWeight:700 }}>{amount} iUSD</span>
          </div>
          {/* Merchant name shown in dedicated card above — no duplicate row needed */}
          {showNote && (
            <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
              <span style={{ color:'var(--muted)' }}>{t('request.noteLabel')}</span>
              <span style={{ fontWeight:700, textAlign:'right', wordBreak:'break-word' }}>{cleanNote}</span>
            </div>
          )}
          {dueDate && (
            <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}>
              <span style={{ color:'var(--muted)' }}>{t('payLink.dueDate')}</span>
              <span style={{ fontWeight:700 }}>{dueDate}</span>
            </div>
          )}
          {paymentId && (
            <div style={{ display:'grid', gap:4, fontSize:11 }}>
              <span style={{ color:'var(--muted)' }}>{t('history.paymentId')}</span>
              <span style={{ fontFamily:'monospace', wordBreak:'break-all' }}>{paymentId}</span>
            </div>
          )}
        </div>



        {address
          ? <button onClick={() => navigate('/app', { replace: true })} style={btnFill}>{t('payLink.goToDashboard')}</button>
          : <button onClick={() => navigate('/')} style={btnFill}>{t('giftClaim.goHome')}</button>
        }
      </div>
    </div>
  )

  if (!recipient) return (
    <div style={page}>
      <div style={{ ...card, gap:14, padding:'20px 18px', alignItems:'stretch' }}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ width:88, height:88, borderRadius:10, border:'1px solid var(--border)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'white', flexShrink:0 }}>
            {invoiceUrl ? <StyledQR url={invoiceUrl} address={shortId ?? ''} size={88} /> : <div style={{ fontSize:12, color:'var(--muted)' }}>QR</div>}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:22, fontWeight:900, lineHeight:1.1, color:'#6b7280' }}>{t('payLink.invalidLink')}</div>
            <div style={{ fontSize:26, fontWeight:900, lineHeight:1.05, marginTop:4 }}>{amount || '—'} <span style={{ fontSize:13, fontWeight:600, color:'var(--muted)' }}>iUSD</span></div>
          </div>
          <div style={{ display:'flex', flexDirection:'column' as const, alignItems:'flex-end', flexShrink:0, gap:3 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <img src="/images/iusd.png?v=20260414" style={{ width:18, height:18, borderRadius:'50%' }} alt="" />
              <span style={{ fontSize:12, fontWeight:800, letterSpacing:'0.03em' }}>iUSD Pay</span>
            </div>
            <span style={{ fontSize:8, color:'var(--muted)', letterSpacing:'0.08em', textTransform:'uppercase' as const }}>INITIA</span>
          </div>
        </div>

        <div style={{ border:'1px solid var(--border)', borderRadius:12, padding:'12px 12px', display:'grid', gap:8, background:'var(--bg)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:2 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', color:'var(--muted)' }}>{t('payLink.invoiceDetails')}</div>
            {modeBadge}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>Status</span><span style={{ fontWeight:700, color:'#6b7280' }}>{t('payLink.invalidLink')}</span></div>
          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>Invoice ID</span><span style={{ fontWeight:700 }}>{invoiceDisplayId}</span></div>
          {showNote && <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:12 }}><span style={{ color:'var(--muted)' }}>{t('request.noteLabel')}</span><span style={{ fontWeight:700, textAlign:'right', wordBreak:'break-word' }}>{cleanNote}</span></div>}
        </div>



        <button onClick={() => navigate('/')} style={btnFill}>{t('giftClaim.goHome')}</button>
      </div>
    </div>
  )

  // ── Success ───────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div style={page}>
      <div style={{ ...card, alignItems:'center', gap:16, padding:'28px 24px' }}>
        {claimStatus === 'claimed' ? (
          <>
            <div style={{ fontSize:32, fontWeight:900, color:'#22c55e' }}>{t('payLink.claimed')} ✓</div>
            <div style={{ fontSize:17, fontWeight:700, textAlign:'center' }}>{t('payLink.paymentComplete')}</div>
            <div style={{ fontSize:13, color:'var(--muted)', textAlign:'center' }}>
              {t('payLink.receivedByName', { amount: depositNum.toFixed(2), name: recipient?.nickname ?? '' })}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize:26, fontWeight:900, color:'#f59e0b' }}>{t('payLink.paymentSent')}</div>
            <div style={{ fontSize:13, color:'var(--muted)', textAlign:'center' }}>
              {t('payLink.processingAuto', { amount: depositNum.toFixed(2) })}
            </div>
            {/* Animated dots to show work in progress */}
            <div style={{ display:'flex', gap:6, marginTop:4 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width:8, height:8, borderRadius:'50%', background:'#f59e0b',
                  animation:`pulse 1.2s ease-in-out ${i*0.3}s infinite`,
                }} />
              ))}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', textAlign:'center' }}>
              {t('payLink.claimWithinMinutes')}
            </div>
          </>
        )}
        {txHash && txHash !== 'ok' && (
          <div style={{ fontSize:10, fontFamily:'monospace', color:'var(--muted)',
                        wordBreak:'break-all', textAlign:'center' }}>
            {txHash.slice(0,20)}…
          </div>
        )}
        <button onClick={() => { window.location.href = '/app' }} style={btnFill}>
          {t('payLink.goToDashboard')} →
        </button>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )

  // Due date check
  const dueStr = dueDate ? (() => {
    const d = new Date(dueDate); const isOver = d < new Date()
    return { label: d.toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}), isOver }
  })() : null

  return (
    <div style={page}>
      {/* Header — compact 1 line */}
      <div style={{ width:'100%', maxWidth:440, display:'flex', alignItems:'center',
                    justifyContent:'space-between', marginBottom:2 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {authStatus === 'registered' && (
            <button
              onClick={smartClose}
              style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px 2px 0',
                       color:'var(--muted)', fontSize:14, display:'flex', alignItems:'center', gap:4 }}
              title="Back"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          <img src="/images/iusd.png?v=20260414" style={{ width:18, height:18, borderRadius:'50%' }} alt="" />
          <span style={{ fontSize:12, fontWeight:800, letterSpacing:'0.03em' }}>iUSD Pay</span>
        </div>
        <span style={{ fontSize:9, color:'var(--muted)', letterSpacing:'0.08em', textTransform:'uppercase' }}>
          INITIA
        </span>
      </div>

      {/* Merchant card — shown for business invoices */}
      {invoiceMode === 'business' && merchantObj && (
        <div style={{ ...card, padding:'14px 16px', gap:0, marginBottom:0,
                      borderLeft: merchantObj.color ? `3px solid ${merchantObj.color}` : undefined }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {merchantObj.logoUrl && (
              <img src={merchantObj.logoUrl} alt="logo"
                style={{ width:48, height:48, borderRadius:8, objectFit:'cover', flexShrink:0 }} />
            )}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:800, fontSize:16, color:'var(--text)', lineHeight:1.2 }}>
                {merchantObj.name}
              </div>
              {merchantObj.description && (
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
                  {merchantObj.description}
                </div>
              )}
              <div style={{ display:'flex', flexWrap:'wrap' as const, gap:'4px 12px', marginTop:4 }}>
                {merchantObj.taxId && (
                  <span style={{ fontSize:10, color:'var(--muted)' }}>
                    Tax / VAT: <strong style={{ color:'var(--text)' }}>{merchantObj.taxId}</strong>
                  </span>
                )}
                {merchantObj.email && (
                  <span style={{ fontSize:10, color:'var(--muted)' }}>
                    {merchantObj.email}
                  </span>
                )}
                {merchantObj.address && (
                  <span style={{ fontSize:10, color:'var(--muted)' }}>
                    {merchantObj.address}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single compact card: recipient + amount + meta + fee */}
      <div style={{ ...card, padding:'14px 16px', gap:0 }}>

        {/* Recipient row */}
        <div style={{ display:'flex', alignItems:'center', gap:10, paddingBottom:12,
                      borderBottom:'1px solid var(--border)' }}>
          <UserSeal shortId={recipient.shortId} fallbackNickname={recipient.nickname}
                    compact style={{ flex:1, minWidth:0, borderRadius:8 }} />
          <div style={{ fontSize:11, color:'var(--muted)', whiteSpace:'nowrap' as const, flexShrink:0 }}>
            {invoiceMode === 'business' && merchantObj?.name ? 'issues invoice' : 'requests payment'}
          </div>
        </div>

        {/* Amount row */}
        <div style={{ paddingTop:12, paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
          {requestedAmount ? (
            <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
              <span style={{ fontSize:36, fontWeight:900, letterSpacing:'-0.03em', lineHeight:1 }}>
                {amount}
              </span>
              <span style={{ fontSize:14, color:'var(--muted)', fontWeight:600 }}>iUSD</span>
            </div>
          ) : (
            <>
              <div style={{ position:'relative' }}>
                <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g,''))}
                  placeholder="0.00" inputMode="decimal"
                  style={{ ...inputSt, width:'100%', boxSizing:'border-box' as const,
                           fontSize:28, fontWeight:800, paddingRight:52,
                           borderColor: amountNum > 0 && amountMicro < MIN_DEPOSIT_MICRO ? '#ef4444' : undefined }} />
                <span style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                               fontSize:12, color:'var(--muted)', fontWeight:600 }}>iUSD</span>
              </div>
              {amountNum > 0 && amountMicro < MIN_DEPOSIT_MICRO && (
                <div style={{ fontSize:11, color:'#ef4444', marginTop:3 }}>
                  Minimum payment is 0.01 iUSD
                </div>
              )}
            </>
          )}
          {note && (
            <div style={{ fontSize:12, color:'var(--muted)', fontStyle:'italic', marginTop:6 }}>
              "{note}"
            </div>
          )}
        </div>

        {/* Fee breakdown + meta — left-aligned rows */}
        {amountNum > 0 && (
          <div style={{ paddingTop:10, display:'flex', flexDirection:'column', gap:4 }}>
            {feeMode === 'recipient' ? (
              <>
                <Row label="You pay" value={`${youPay.toFixed(2)} iUSD`} bold accent />
                <Row label={`Platform fee (0.5%${feeNum >= FEE_CAP ? ', capped' : ''})`}
                     value={`−${feeNum.toFixed(4)} iUSD`} muted />
                <Row label="Recipient gets" value={`${theyGet.toFixed(4)} iUSD`} muted />
              </>
            ) : (
              <>
                <Row label="You pay" value={`${youPay.toFixed(2)} iUSD`} bold accent />
                <Row label={`Platform fee (0.5%${feeNum >= FEE_CAP ? ', capped' : ''})`}
                     value={`${feeNum.toFixed(4)} iUSD`} muted />
                <Row label="Recipient gets" value={`${theyGet.toFixed(4)} iUSD`} muted />
              </>
            )}
            {/* Due date */}
            {dueStr && (
              <Row label="Due" value={`${dueStr.isOver ? '⚠ ' : ''}${dueStr.label}`}
                   muted={!dueStr.isOver} />
            )}
            {/* Invoice no */}
            {(invoiceNo || invToken) && (
              <Row label="Invoice" value={invoiceNo ?? (invToken?.slice(0,10) + '…')} muted />
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {payErr && (
        <div style={{ color:'#ef4444', fontSize:12, maxWidth:440, width:'100%', textAlign:'center',
                      background:'rgba(239,68,68,0.08)', borderRadius:8, padding:'10px 14px' }}>
          ⚠ {payErr}
        </div>
      )}

      {/* CTA */}
      {address ? (
        <button
          onClick={handlePay}
          disabled={amountNum <= 0 || amountMicro < MIN_DEPOSIT_MICRO || step === 'building' || step === 'signing'}
          style={{ ...btnFill, maxWidth:440, width:'100%', fontSize:15,
                   opacity: (amountNum <= 0 || step !== 'idle' && step !== 'error') ? 0.5 : 1 }}>
          {step === 'building' ? 'Building tx…'
           : step === 'signing' ? '✍️ Waiting for signature…'
           : `Pay ${amountNum > 0 ? `${youPay.toFixed(2)} iUSD` : ''}`}
        </button>
      ) : authStatus === 'checking' || authStatus === 'signing' || authStatus === 'unregistered' || autoRegistering ? (
        <div style={{ ...card, alignItems:'center', gap:12 }}>
          <div style={{ fontSize:12, color:'var(--muted)', textAlign:'center' }}>
            {autoRegistering || authStatus === 'unregistered'
              ? 'Creating your account…'
              : 'Setting up your wallet…'}
          </div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>This only takes a moment</div>
        </div>
      ) : (
        <div style={{ ...card, alignItems:'center', gap:12 }}>
          <QuickLogin actionLabel="Pay" />
          <div style={{ fontSize:10, color:'var(--muted)', textAlign:'center' }}>
            New to iPay? You'll be set up automatically.
          </div>
        </div>
      )}

      <div style={{ fontSize:10, color:'var(--muted)', marginTop:8 }}>
        Powered by iPay · iUSD stablecoin on Initia
      </div>
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────
function Row({ label, value, bold, muted, green, accent }: {
  label: string; value: string; bold?: boolean; muted?: boolean; green?: boolean; accent?: boolean
}) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  fontSize: bold ? 13 : 11, fontWeight: bold ? 700 : 400 }}>
      <span style={{ color: muted ? 'var(--muted)' : 'inherit' }}>{label}</span>
      <span style={{
        color: accent ? 'var(--accent,#22c55e)' : green ? '#22c55e'
             : muted ? 'var(--muted)' : 'inherit'
      }}>{value}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const page: React.CSSProperties = {
  minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
  display:'flex', flexDirection:'column', alignItems:'center',
  padding:'16px 16px 60px', gap:10, boxSizing:'border-box',
}
const card: React.CSSProperties = {
  width:'100%', maxWidth:440, background:'var(--surface)',
  border:'1px solid var(--border)', borderRadius:14, padding:'16px 20px',
  display:'flex', flexDirection:'column', gap:12, boxSizing:'border-box',
}
const inputSt: React.CSSProperties = {
  background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:10,
  padding:'10px 12px', color:'var(--text)', fontSize:13, fontFamily:'inherit', outline:'none',
}
const btnFill: React.CSSProperties = {
  background:'var(--text)', color:'var(--surface)', border:'none', borderRadius:12,
  padding:'14px 24px', fontSize:14, fontWeight:700, cursor:'pointer', textAlign:'center',
}
