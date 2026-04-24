/**
 * Transfer — /app/transfer
 * V2: shortId lookup → amount → on-chain deposit() via IK
 *
 * Flow:
 *   1. Input 16-char recipient shortId → auto-resolve nickname + viewing pubkey
 *   2. Input amount (iUSD)
 *   3. Fetch sender's own viewing pubkey from API
 *   4. Build encrypted deposit tx (orderBuilder)
 *   5. Sign + broadcast via IK signAndBroadcast
 *   6. Show success with payment ID
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { useAuthContext } from '../hooks/AuthContext'
import { useConfig } from '../hooks/useConfig'
import { upsertContact, fetchCounterpartiesFromActivity, type Contact } from '../lib/contactsStore'
import { API_BASE } from '../config'
import { buildDepositTx } from '../services/orderBuilder'
import { hexToBytes } from '../services/orderCrypto'
import { StyledQR } from '../components/StyledQR'
import { IUSD_DENOM as DEFAULT_IUSD_DENOM, IUSD_FA } from '../networks'
import { dnaHue as getDnaHue, dnaColor as getDnaColor } from '../lib/dnaColor'
import { QRScanButton } from '../components/QRScanButton'

const REST_URL = import.meta.env.VITE_REST_URL || 'https://rest.initia.xyz'

const IUSD_DECIMALS = 6  // 1 iUSD = 1_000_000 micro

// ── Resolve recipient from shortId ─────────────────────────────────────────
// NOTE: this deliberately does NOT expose a recipient `address`. The public
// /v1/account/:shortId endpoint no longer returns the init1 address (privacy
// invariant), so downstream visuals (DNA color etc.) key off `shortId` only.
async function resolveRecipient(shortId: string): Promise<{ shortId: string; nickname: string; viewingPubkey: string; shortSealSvg: string | null; status?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/account/${shortId.toUpperCase()}`)
    if (!res.ok) return null
    const data = await res.json()
    const account = data.account
    if (!account) return null
    // Get viewing pubkey separately
    const vpRes = await fetch(`${API_BASE}/account/viewing-pubkey/${shortId.toUpperCase()}`)
    const vpData = vpRes.ok ? await vpRes.json() : null
    return {
      shortId: account.shortId,
      nickname: account.nickname ?? '',
      viewingPubkey: vpData?.viewingPubkey ?? '',
      shortSealSvg: account.shortSealSvg ?? null,
      status: data.status ?? 'active',
    }
  } catch { return null }
}

// ── Get sender's own viewing pubkey ────────────────────────────────────────
async function getSenderViewingPubkey(token: string): Promise<{ pubkey: string | null; status: number }> {
  try {
    const res = await fetch(`${API_BASE}/account/viewing-pubkey`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { pubkey: null, status: res.status }
    const { viewingPubkey } = await res.json()
    return { pubkey: viewingPubkey ?? null, status: 200 }
  } catch { return { pubkey: null, status: 0 } }
}

type Step = 'idle' | 'building' | 'signing' | 'done' | 'error'

export function Transfer() {
  const { t } = useTranslation()
  const navigate  = useNavigate()
  const smartClose = useSmartClose('/app')
  const [urlParams]   = useSearchParams()
  const { address, account, token } = useAuthContext()
  const { requestTxBlock, submitTxBlock } = useInterwovenKit()
  const { config } = useConfig()
  const iusdDenom = config?.iusd?.denom ?? DEFAULT_IUSD_DENOM

  // Pre-fill from ?to=SHORTID&amount=X (from PayLink / Request QR)
  const prefillTo     = urlParams.get('to')     ?? ''
  const prefillAmount = urlParams.get('amount') ?? ''
  const invToken      = urlParams.get('inv')    ?? null   // invoice token — link payment after deposit

  // Input state
  const [myQrOpen, setMyQrOpen] = useState(false)
  const APP_ORIGIN_TR = 'https://iusd-pay.xyz'
  const [recipientId,   setRecipientId]   = useState(prefillTo)
  const [recipientInput, setRecipientInput] = useState(prefillTo)  // display value (nickname or ID)
  const [recipient,     setRecipient]     = useState<{ shortId: string; nickname: string; viewingPubkey: string; shortSealSvg: string | null; address?: string } | null>(null)
  const [resolving,     setResolving]     = useState(false)
  const [resolveErr,    setResolveErr]    = useState<string | null>(null)
  const [showContactSuggestions, setShowContactSuggestions] = useState(false)
  const [amount,        setAmount]        = useState(prefillAmount)
  const [memo,          setMemo]          = useState('')
  const [myBalance,     setMyBalance]     = useState<number | null>(null)

  // Contact search — fetch DIRECTLY from the server DB on every mount.
  // We deliberately bypass the contactsStore cache because incremental
  // fire-and-forget `upsertContact` writes can leave it with a partial list.
  const [allContacts, setAllContacts] = useState<Contact[]>([])
  // Secondary list: unique counterparties from recent activity that are
  // NOT already in allContacts. Displayed in the dropdown under a
  // "From History" divider so the suggestions are never empty.
  const [historyContacts, setHistoryContacts] = useState<Contact[]>([])
  useEffect(() => {
    if (!account?.shortId || !token) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/contacts/${encodeURIComponent(account.shortId)}?limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok) return
        const data = await r.json()
        const rows: Contact[] = (data.contacts ?? []).map((c: any) => ({
          shortId: (c.nickname ?? c.contactAddr ?? '').toUpperCase(),
          nickname: c.avatar || c.nickname || c.contactAddr || '',
          shortSealSvg: null,
          addedAt: c.createdAt ?? 0,
          alias: c.notes ?? '',
        }))
        if (!cancelled) setAllContacts(rows)

        // Fetch history-derived suggestions in parallel, deduped against
        // the contacts we just loaded.
        const exclude = new Set(rows.map(r => r.shortId.toUpperCase()))
        const history = await fetchCounterpartiesFromActivity(token, { limit: 30, excludeShortIds: exclude })
        if (!cancelled) setHistoryContacts(history)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [account?.shortId, token])

  // Filter by search query; otherwise show everything. Applied identically
  // to both the contacts list and the history-derived suggestions.
  const matchesQuery = (c: Contact) => {
    const q = recipientInput.trim().toLowerCase()
    if (!q) return true
    return (c.nickname?.toLowerCase().includes(q)) ||
           (c.alias?.toLowerCase().includes(q)) ||
           c.shortId.toLowerCase().includes(q)
  }
  const contactSuggestions: Contact[] = !recipient ? allContacts.filter(matchesQuery) : []
  const historySuggestions: Contact[] = !recipient ? historyContacts.filter(matchesQuery) : []

  // Tx state
  const [step,    setStep]    = useState<Step>('idle')
  const [error,   setError]   = useState<string | null>(null)
  const [payId, setPayId]   = useState<string | null>(null)

  // ── Dynamic Payment Code (hooks must be before any conditional return) ────
  const [paySessionToken, setPaySessionToken] = useState<string | null>(null)
  const [paySessionStatus, setPaySessionStatus] = useState<string>('idle')
  const [, setPaySessionData] = useState<any>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const createPaySession = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/pay-session/create`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.token) {
        setPaySessionToken(data.token)
        setPaySessionStatus('pending')
        setPaySessionData(null)
      }
    } catch {}
  }, [token])

  // Poll session status when open
  useEffect(() => {
    if (!myQrOpen || !paySessionToken) return
    const poll = () => {
      fetch(`${API_BASE}/pay-session/${paySessionToken}`)
        .then(r => r.json())
        .then(d => {
          setPaySessionStatus(d.status)
          if (d.status === 'filled') {
            setPaySessionData(d)
            if (d.payeeShortId) {
              setRecipientId(d.payeeShortId)
              setRecipientInput(d.payeeShortId)
              resolveRecipient(d.payeeShortId).then(r => {
                if (r) { setRecipient(r); setRecipientInput(r.nickname || d.payeeShortId) }
              })
            }
            if (d.amount) setAmount(d.amount)
            if (d.memo) setMemo(d.memo)
            setMyQrOpen(false)
          }
          if (d.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current)
          }
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [myQrOpen, paySessionToken])

  // Auto-create session when opening QR
  useEffect(() => {
    if (myQrOpen && !paySessionToken) createPaySession()
  }, [myQrOpen, paySessionToken, createPaySession])

  // Fetch my iUSD balance from chain
  useEffect(() => {
    if (!address) return
    fetch(`${REST_URL}/cosmos/bank/v1beta1/balances/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const bal: any[] = d?.balances ?? []
        const iusdCoin =
          bal.find((b: any) => b.denom === iusdDenom) ??
          bal.find((b: any) => b.denom === `move/${IUSD_FA.replace(/^0x/, '')}`)
        if (iusdCoin) {
          const raw = BigInt(iusdCoin.amount)
          setMyBalance(Number(raw / 1000000n) + Number(raw % 1000000n) / 1e6)
        }
      })
      .catch(() => {})
  }, [address, iusdDenom])

  // Auto-resolve when ID is 16 chars
  useEffect(() => {
    setRecipient(null); setResolveErr(null)
    const id = recipientId.trim().toUpperCase()
    if (id.length !== 16) return
    if (id === account?.shortId) { setResolveErr("Can't send to yourself"); return }
    setResolving(true)
    const ctrl = new AbortController()
    resolveRecipient(id)
      .then(r => {
        if (!r) {
          setResolveErr('Invalid username or ID')
        } else if (r.status === 'frozen' || r.status === 'deleted') {
          setResolveErr('Username inactive')
        } else {
          setRecipient(r)
          setResolveErr(null)
          // Show nickname@ID-DNA in input
          const sid = r.shortId
          setRecipientInput(`${r.nickname || sid}@${sid.slice(0,4)}◆${sid.slice(-4)}`)
        }
        setResolving(false)
      })
    return () => ctrl.abort()
  }, [recipientId, account?.shortId])

  const FEE_RATE   = 0.005                       // 0.5% — matches pay_v3 contract
const FEE_CAP      = 5.0       // iUSD max per tx
  const amountNum  = parseFloat(amount)         // amount recipient receives
  // Fee = min(amount × 0.5%, 5 iUSD cap) — matches pay_v3 contract
  const feeNum    = amountNum > 0 ? Math.min(amountNum * FEE_RATE, FEE_CAP) : 0
  const depositNum = amountNum > 0 ? amountNum + feeNum : 0
  const amountMicro = Math.ceil(depositNum * 10 ** IUSD_DECIMALS)  // always round up
  // Min: recipient net ≥ 0.01 iUSD → gross deposit = ceil(10000 × 1.005) = 10050 micro ≥ contract MIN
  const MIN_AMOUNT_IUSD = 0.1    // contract MIN_AMOUNT = 100,000 micro = 0.1 iUSD
  const MAX_AMOUNT_IUSD = 1_000  // compliance limit: 1,000 iUSD per tx
  const amountTooSmall  = amountNum > 0 && amountNum < MIN_AMOUNT_IUSD
  const amountTooBig    = amountNum > MAX_AMOUNT_IUSD
  const canSend = !!recipient && amountNum >= MIN_AMOUNT_IUSD && amountNum <= MAX_AMOUNT_IUSD && !!address && !!token && step === 'idle'

  async function handleSend() {
    if (!canSend || !address || !token) return
    setStep('building'); setError(null)

    try {
      // 1. Get sender's viewing pubkey
      const { pubkey: senderPub, status: vpStatus } = await getSenderViewingPubkey(token)
      if (!senderPub) {
        if (vpStatus === 401 || vpStatus === 403)
          throw new Error('Session expired. Please disconnect and reconnect your wallet.')
        throw new Error('Could not fetch your viewing key. Please try again.')
      }

      if (!recipient.viewingPubkey) throw new Error('Recipient has no viewing key registered.')

      // 2. Import crypto helpers (lazy to keep bundle small)
      // 3. Build deposit tx
      const result = await buildDepositTx({
        sender: address,
        recipient: recipient.shortId,  // contract uses shortId as recipient identifier
        amount: BigInt(amountMicro),
        memo: memo.trim(),
        senderViewingPubKey:    hexToBytes(senderPub),
        recipientViewingPubKey: hexToBytes(recipient.viewingPubkey),
      })

      // 4. Sign + broadcast via IK with feegrant (relayer pays gas)
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
      } catch (grantErr: any) {
        console.warn('[Transfer] feegrant failed, user pays gas:', grantErr.message)
        txRes = await requestTxBlock({ messages: [result.txMsg] })
      }
      if (!txRes || ((txRes as any).code !== 0 && (txRes as any).code !== undefined)) {
        throw new Error((txRes as any)?.rawLog ?? 'Transaction failed')
      }

      setPayId(result.id)
      setStep('done')

      // Auto-save recipient to contacts
      if (address && recipient) {
        upsertContact(address, {
          shortId:      recipient.shortId,
          nickname:     recipient.nickname,
          shortSealSvg: recipient.shortSealSvg ?? null,
        })
      }

      // Record payment intent + link invoice — fire-and-forget (don't block success screen)
      const _pid = result.id
      const _recip = recipient!.shortId
      const _amtMicro = String(amountMicro)
      const _invTok = invToken
      setTimeout(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const piRes = await fetch(`${API_BASE}/account/payment-intent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ paymentId: _pid, recipientShortId: _recip, amountMicro: _amtMicro }),
            })
            if (piRes.ok) break
          } catch {}
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
        if (_invTok) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const linkRes = await fetch(`${API_BASE}/invoice/${_invTok}/link-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ paymentId: _pid, payerAddress: address, amountMicro: _amtMicro }),
              })
              if (linkRes.ok) break
            } catch {}
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }, 0)
    } catch (e: any) {
      console.error('[Transfer] error:', e)
      setError(e.message ?? 'Unknown error')
      setStep('error')
    }
  }

  // ── Success: redirect to receipt page ───────────────────────────────────
  if (step === 'done' && payId) {
    const receiptPath = `/receipt/0x${payId.replace(/^0x/i, '')}`
    const params = new URLSearchParams()
    if (invToken) params.set('inv', invToken)
    params.set('from', 'transfer')
    const query = params.toString()
    navigate(`${receiptPath}${query ? `?${query}` : ''}`, { replace: true })
  }



  const paySessionUrl = paySessionToken ? `${APP_ORIGIN_TR}/pr/${paySessionToken}` : ''

  if (myQrOpen && account?.shortId) {
    return (
      <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
                    display:'flex', flexDirection:'column', alignItems:'center',
                    padding:'24px 16px 100px', gap:16, boxSizing:'border-box' }}>
        <div style={{ width:'100%', maxWidth:480, display:'flex', alignItems:'center',
                      gap:10, paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
          <button onClick={() => { setMyQrOpen(false); setPaySessionToken(null); setPaySessionStatus('idle') }}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:18,
                     color:'var(--text)', padding:'4px 6px' }}>←</button>
          <span style={{ fontSize:13, fontWeight:600 }}>{t('transfer.paymentCodeTitle')}</span>
        </div>
        <div style={{ width:'100%', maxWidth:480, background:'var(--surface)',
                      borderRadius:20, border:'1px solid var(--border)', padding:'24px',
                      display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
          {account?.shortSealSvg ? (
            <img src={`data:image/svg+xml;base64,${btoa(account.shortSealSvg)}`} style={{ height:40 }} alt="" />
          ) : (
            <div style={{ fontSize:14, fontWeight:700 }}>
              {account?.nickname ?? ''}<span style={{ fontSize:10, color:'var(--muted)', fontFamily:'monospace' }}>@{account?.shortId?.slice(0,4)}◆{account?.shortId?.slice(-4)}</span>
            </div>
          )}

          {paySessionStatus === 'pending' && paySessionUrl ? (
            <>
              <StyledQR url={paySessionUrl} address={address ?? account.shortId} size={200} />
              <div style={{ fontSize:11, color:'var(--muted)', textAlign:'center', lineHeight:1.6 }}>
                {t('transfer.showToRecipient')}<br/>
                {t('transfer.scanAndEnter')}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--text)', animation:'pulse 1.5s infinite' }} />
                <span style={{ fontSize:11, color:'var(--muted)' }}>{t('transfer.waitingForRequest')}</span>
              </div>
              <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
            </>
          ) : paySessionStatus === 'expired' ? (
            <>
              <div style={{ fontSize:14, color:'var(--muted)' }}>{t('transfer.sessionExpired')}</div>
              <button onClick={() => { setPaySessionToken(null); createPaySession() }}
                style={{ padding:'10px 24px', borderRadius:10, border:'1px solid var(--border)',
                         background:'var(--bg-elevated)', color:'var(--text)', fontSize:13,
                         fontWeight:600, cursor:'pointer' }}>
                {t('transfer.generateNew')}
              </button>
            </>
          ) : (
            <div style={{ fontSize:13, color:'var(--muted)' }}>{t('transfer.generating')}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  padding:'24px 16px 100px', gap:16, boxSizing:'border-box' }}>

      {/* Header */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', alignItems:'center', gap:10,
                    paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
        <button onClick={smartClose} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700 }}>{t('transfer.title')}</span>
      </div>

      {/* ── Compact Transfer Form ──────────────────────────────────── */}
      {/* NOTE: `overflow: visible` (not hidden) so the absolutely-positioned
          contacts dropdown can spill past the card's bottom edge. With
          overflow:hidden the bottom rows of the dropdown get clipped,
          which is why "5 total" was only showing 4 in the DOM. */}
      <div style={{ width:'100%', maxWidth:480, background:'var(--surface)',
                    border:'1px solid var(--border)', borderRadius:16,
                    overflow:'visible', boxSizing:'border-box' }}>
        {/* Recipient row */}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={formLabel}>{t('gift.toLabel')}</span>
            <div style={{ flex:1, position:'relative' }}>
              <input
                value={recipientInput}
                onChange={e => {
                const v = e.target.value
                setRecipientInput(v)
                // If it looks like a shortId (uppercase hex-like, 16 chars), set directly
                const upper = v.trim().toUpperCase()
                if (/^[A-Z0-9]{1,16}$/.test(upper)) {
                  setRecipientId(upper.slice(0, 16))
                } else {
                  // Search contacts by nickname/alias
                  setRecipientId('')
                }
                setShowContactSuggestions(true)
              }}
              onFocus={() => setShowContactSuggestions(true)}
              placeholder={t('transfer.recipientPlaceholder')}
              style={{ width:'100%', background:'transparent', border:'none', outline:'none', fontSize:13,
                       borderColor: recipient ? '#22c55e' : resolveErr ? '#ef4444' : undefined }}
            />
            {/* Contact suggestions dropdown — always show when focused.
                Primary section = Contacts, secondary = From History. */}
            {showContactSuggestions && !recipient && (contactSuggestions.length + historySuggestions.length > 0 || (allContacts.length === 0 && historyContacts.length === 0)) && (
              <>
                {/* Backdrop to close on outside click */}
                <div onClick={() => setShowContactSuggestions(false)}
                  style={{ position:'fixed', inset:0, zIndex:19 }} />
                <div
                  onTouchStartCapture={e => e.stopPropagation()}
                  onTouchMoveCapture={e => e.stopPropagation()}
                  onWheel={e => e.stopPropagation()}
                  style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:20,
                              background:'var(--surface)', border:'1px solid var(--border)',
                              borderRadius:10, marginTop:4, maxHeight:420, overflowY:'auto',
                              boxShadow:'0 8px 24px rgba(0,0,0,0.15)',
                              WebkitOverflowScrolling:'touch', touchAction:'pan-y', overscrollBehavior:'contain' }}>

                  {/* Primary: Contacts header + rows */}
                  {contactSuggestions.length > 0 && (
                    <>
                      <div style={{ padding:'6px 12px', fontSize:9, color:'var(--muted)', fontWeight:600,
                                    letterSpacing:'0.1em', textTransform:'uppercase',
                                    borderBottom:'1px solid var(--border)',
                                    position:'sticky', top:0, background:'var(--surface)', zIndex:1,
                                    display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span>{t('transfer.contacts')}</span>
                        <span style={{ fontSize:9, color:'var(--muted)', textTransform:'none', letterSpacing:0, fontWeight:500 }}>
                          {recipientInput.trim().length > 0
                            ? `${contactSuggestions.length} of ${allContacts.length}`
                            : `${allContacts.length} total`}
                        </span>
                      </div>
                      {contactSuggestions.map((c, idx) => (
                        <button key={`c-${c.shortId}-${idx}`}
                          onClick={() => {
                            setRecipientId(c.shortId)
                            setRecipientInput(c.nickname ? `${c.nickname}@${c.shortId.slice(0,4)}◆${c.shortId.slice(-4)}` : c.shortId)
                            setShowContactSuggestions(false)
                          }}
                          style={{ display:'flex', alignItems:'center', gap:6, width:'100%',
                                   padding:'7px 12px', background:'transparent', border:'none',
                                   borderBottom:'1px solid var(--border)',
                                   cursor:'pointer', textAlign:'left', fontSize:12 }}>
                          <span style={{ fontWeight:600, color:'var(--text)' }}>
                            {c.alias || c.nickname || c.shortId}
                          </span>
                          {c.alias && c.nickname && (
                            <span style={{ fontSize:10, color:'var(--muted)' }}>{c.nickname}</span>
                          )}
                          <span style={{ fontSize:10, color: getDnaColor(c.shortId), fontFamily:'monospace' }}>
                            @{c.shortId.slice(0,4)}◆{c.shortId.slice(-4)}
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Fancy divider between Contacts and History.
                      Hidden if one side is empty. */}
                  {contactSuggestions.length > 0 && historySuggestions.length > 0 && (
                    <div style={{
                      display:'flex', alignItems:'center', gap:8,
                      padding:'10px 12px 8px',
                      fontSize:9, color:'var(--muted)', fontWeight:600,
                      letterSpacing:'0.14em', textTransform:'uppercase',
                      background:'var(--surface)',
                    }}>
                      <div style={{ flex:1, height:1, background:'linear-gradient(90deg, transparent, var(--border))' }} />
                      <span style={{ whiteSpace:'nowrap' }}>✨ From History</span>
                      <div style={{ flex:1, height:1, background:'linear-gradient(90deg, var(--border), transparent)' }} />
                    </div>
                  )}

                  {/* Secondary: history-derived suggestions.
                      If there are no explicit contacts at all, show the
                      "From History" label as a plain sticky header. */}
                  {historySuggestions.length > 0 && contactSuggestions.length === 0 && (
                    <div style={{ padding:'6px 12px', fontSize:9, color:'var(--muted)', fontWeight:600,
                                  letterSpacing:'0.1em', textTransform:'uppercase',
                                  borderBottom:'1px solid var(--border)',
                                  position:'sticky', top:0, background:'var(--surface)', zIndex:1,
                                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span>✨ From History</span>
                      <span style={{ fontSize:9, color:'var(--muted)', textTransform:'none', letterSpacing:0, fontWeight:500 }}>
                        {historySuggestions.length}
                      </span>
                    </div>
                  )}
                  {historySuggestions.map((c, idx) => (
                    <button key={`h-${c.shortId}-${idx}`}
                      onClick={() => {
                        setRecipientId(c.shortId)
                        setRecipientInput(c.nickname ? `${c.nickname}@${c.shortId.slice(0,4)}◆${c.shortId.slice(-4)}` : c.shortId)
                        setShowContactSuggestions(false)
                      }}
                      style={{ display:'flex', alignItems:'center', gap:6, width:'100%',
                               padding:'7px 12px', background:'transparent', border:'none',
                               borderBottom:'1px solid var(--border)',
                               cursor:'pointer', textAlign:'left', fontSize:12 }}>
                      <span style={{ fontWeight:600, color:'var(--text)' }}>
                        {c.nickname || c.shortId}
                      </span>
                      <span style={{ fontSize:10, color: getDnaColor(c.shortId), fontFamily:'monospace' }}>
                        @{c.shortId.slice(0,4)}◆{c.shortId.slice(-4)}
                      </span>
                    </button>
                  ))}

                  {/* Empty state */}
                  {contactSuggestions.length === 0 && historySuggestions.length === 0 && (
                    <div style={{ padding:'14px', fontSize:11, color:'var(--muted)', textAlign:'center', lineHeight:1.6 }}>
                      {recipientInput.trim().length > 0
                        ? <>{t('transfer.noContactsMatch', { query: recipientInput.trim() })}</>
                        : <>{t('transfer.noContactsYet')}<br/><span style={{fontSize:10, opacity:0.7}}>{t('transfer.noContactsHint')}</span></>
                      }
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <QRScanButton onScan={shortId => {
            setRecipientId(shortId)
            setRecipientInput(shortId)
            setShowContactSuggestions(false)
          }} />
        </div>

          {/* Resolved recipient with DNA color */}
          {resolving && <div style={{ fontSize:10, color:'var(--muted)', marginTop:2, padding:'0 14px 6px' }}>{t('transfer.checking')}</div>}
          {recipient && !resolving && (() => {
            const dnaHue = getDnaHue(recipient.shortId || '')
            return (
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 14px 6px', fontSize:11, fontWeight:600 }}>
                <span style={{ color:'#22c55e' }}>✓</span>
                <span style={{ color:'var(--text)' }}>{recipient.nickname || recipient.shortId}</span>
                <span style={{ fontSize:10, color:`hsl(${dnaHue}, 55%, 55%)`, fontFamily:'monospace' }}>
                  @{recipient.shortId}
                </span>
              </div>
            )
          })()}
          {resolveErr && !resolving && (
            <div style={{ fontSize:10, color:'#ef4444', padding:'2px 14px 6px' }}>⚠ {resolveErr}</div>
          )}
        </div>

        {/* Amount row */}
        <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={formLabel}>{t('transfer.amountLabel')}</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              min="0.1"
              step="0.1"
              style={{ flex:1, background:'transparent', border:'none', outline:'none',
                       fontSize:18, fontWeight:700, color:'var(--text)', minWidth:0 }}
            />
            <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600, flexShrink:0 }}>iUSD</span>
          </div>
          {(amountTooSmall || amountTooBig) && (
            <div style={{ fontSize:10, color:'#ef4444', marginTop:2 }}>
              {amountTooSmall ? t('transfer.amountMin') : t('transfer.amountMax')}
            </div>
          )}
        </div>
        {/* Amount slider — uses global .ipay-slider (44px touch target) */}
        <style>{`
          .amt-slider.at-max::-webkit-slider-thumb { width: 0; height: 0; opacity: 0; }
          .amt-slider.at-max::-moz-range-thumb { width: 0; height: 0; opacity: 0; }
          .amt-slider:disabled { opacity: 0.3; cursor: default; }
          .amt-slider:disabled::-webkit-slider-thumb { cursor: default; }
        `}</style>
        <div style={{ padding:'4px 14px 8px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:9, color:'var(--muted)', flexShrink:0 }}>0</span>
          <input
            className={`amt-slider ipay-slider${amountNum >= MAX_AMOUNT_IUSD ? ' at-max' : ''}`}
            type="range"
            min={0}
            max={100}
            value={myBalance && parseFloat(amount) > 0
              ? Math.round(Math.min(parseFloat(amount) / Math.min(myBalance, MAX_AMOUNT_IUSD), 1) * 100)
              : 0}
            onChange={e => {
              if (!myBalance || myBalance <= 0) return
              const pct = parseInt(e.target.value)
              const max = Math.min(myBalance, MAX_AMOUNT_IUSD)
              if (pct === 100) { setAmount(max.toFixed(2)); return }
              if (pct === 0) { setAmount(''); return }
              const val = Math.floor(max * pct) / 100
              setAmount(val < 0.1 ? '' : val.toFixed(2))
            }}
            disabled={!myBalance || myBalance <= 0}
          />
          {amountNum >= MAX_AMOUNT_IUSD ? (
            <button onClick={() => setAmount(String(MAX_AMOUNT_IUSD))}
              style={{ fontSize:8, fontWeight:800, color:'#fff', background:'#f59e0b',
                       border:'none', borderRadius:10, padding:'4px 8px', cursor:'pointer',
                       whiteSpace:'nowrap', flexShrink:0, letterSpacing:'0.04em' }}>
              MAX {MAX_AMOUNT_IUSD}
            </button>
          ) : (
            <span style={{ fontSize:9, color:'var(--muted)', flexShrink:0, whiteSpace:'nowrap' }}>
              {myBalance !== null ? `${myBalance.toFixed(2)}` : '—'}
            </span>
          )}
        </div>

        {/* Memo row */}
        <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:6 }}>
          <span style={formLabel}>{t('transfer.memoLabel')}</span>
          <input
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder={t('transfer.memoPlaceholder')}
            maxLength={100}
            style={{ flex:1, background:'transparent', border:'none', outline:'none',
                     fontSize:13, color:'var(--text)', minWidth:0 }}
          />
        </div>
      </div>

      {/* Fee summary (inline) */}
      {recipient && amountNum > 0 && (
        <div style={{ width:'100%', maxWidth:480, display:'flex', justifyContent:'space-between',
                      alignItems:'center', fontSize:11, color:'var(--muted)', padding:'0 4px' }}>
          <span>{t('transfer.fee', { amount: feeNum.toFixed(4) })}{feeNum >= FEE_CAP ? ` ${t('transfer.feeCap')}` : ''}</span>
          <span style={{ fontWeight:700, color:'var(--text)' }}>{t('transfer.total', { amount: depositNum.toFixed(4) })}</span>
        </div>
      )}

      {/* Error */}
      {step === 'error' && error && (
        <div style={{ width:'100%', maxWidth:480, padding:'12px 16px',
                      background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)',
                      borderRadius:10, fontSize:12, color:'#ef4444' }}>
          ⚠ {error}
          <button onClick={() => { setStep('idle'); setError(null) }}
            style={{ marginLeft:12, fontSize:10, color:'var(--muted)', background:'none', border:'none',
                     cursor:'pointer', textDecoration:'underline' }}>
            {t('auth.tryAgain')}
          </button>
        </div>
      )}

      {step === 'idle' && recipient && (
        <div style={{ textAlign:'center', fontSize:10, color:'var(--muted)', marginTop:-8 }}>
          🤝 {t('transfer.autoSaveContact')}
        </div>
      )}
      {/* Payment QR + Send buttons */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', gap:8 }}>
        <button onClick={() => setMyQrOpen(true)}
          style={{ flex:'0 0 auto', padding:'14px 16px', fontSize:12, fontWeight:600,
                   background:'none', color:'var(--text)', border:'1px solid var(--border)', borderRadius:12,
                   cursor:'pointer', display:'flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          {t('transfer.paymentQR')}
        </button>
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{ ...btnFill, flex:1, opacity: canSend ? 1 : 0.4,
                   cursor: canSend ? 'pointer' : 'not-allowed',
                   fontSize:14, padding:'14px', minWidth:0 }}>
          {step === 'building' ? t('transfer.building') :
           step === 'signing'  ? t('transfer.confirming') :
           amountNum > 0 ? t('transfer.sendAmount', { amount: amountNum }) : t('transfer.send')}
        </button>
      </div>

    </div>
  )
}

// ── Shared styles ───────────────────────────────────────────────────────────
const formLabel: React.CSSProperties = {
  fontSize:11, fontWeight:600, color:'var(--muted)', flexShrink:0, minWidth:42,
}
const btnFill: React.CSSProperties = {
  background:'var(--text)', color:'var(--surface)', border:'none', borderRadius:12,
  padding:'12px 24px', fontSize:13, fontWeight:700, cursor:'pointer', textAlign:'center',
}
const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
