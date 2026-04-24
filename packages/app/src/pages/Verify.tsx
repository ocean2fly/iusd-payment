/**
 * /verify?pid=<paymentId>
 * Public payment verification page — no auth required.
 * Linked from Receipt PDF QR code.
 */
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { verifyBadge } from '../lib/paymentStatus'
import { fetchPaymentChainStatus, CHAIN_STATUS_LABEL, triggerServerSync } from '../lib/payChainStatus'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://api.iusd-pay.xyz/v1'
const EXPLORER_TX_BASE = import.meta.env.VITE_EXPLORER_TX_BASE || 'https://scan.initia.xyz/interwoven-1/txs'

function privacyId(shortId?: string | null): string | null {
  if (!shortId || shortId.length < 8) return null
  return `${shortId.slice(0, 4)}◆${shortId.slice(-4)}`
}

const IUSD = (micro: string | number | null | undefined) => {
  if (!micro) return '0.00'
  const v = parseInt(String(micro)) / 1_000_000
  return v % 1 === 0 ? v.toFixed(2) : parseFloat(v.toFixed(6)).toString()
}

function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  // Normalize PostgreSQL timestamps: "2026-04-05 02:08:54.827+00" → ISO format
  let normalized = ts.replace(' ', 'T')
  if (/[+-]\d{2}$/.test(normalized)) normalized += ':00'  // +00 → +00:00
  if (!/[Z+-]/.test(normalized.slice(-6))) normalized += 'Z'
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Verify() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate  = useNavigate()
  const pid       = params.get('pid') ?? ''

  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<any>(null)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    if (!pid) { setErr('NO_PID'); setLoading(false); return }
    fetch(`${API_BASE}/payment/verify/${encodeURIComponent(pid)}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error ?? 'NOT_FOUND')))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setErr(String(e)); setLoading(false) })
  }, [pid])

  // After DB data loads, async check chain for true status
  useEffect(() => {
    if (!pid || !data) return
    let cancelled = false
    fetchPaymentChainStatus(pid).then(chainStatus => {
      if (cancelled || chainStatus === null) return
      const chainLabel = CHAIN_STATUS_LABEL[chainStatus] ?? data.status
      if (chainLabel !== data.status) {
        setData((prev: any) => prev ? { ...prev, status: chainLabel } : prev)
        triggerServerSync(pid)
      }
    })
    return () => { cancelled = true }
  }, [pid, data?.status])

  const { color: statusColor, label: statusLabel } = verifyBadge(data?.status)

  const page: React.CSSProperties = {
    minHeight: '100dvh',
    background: 'var(--bg)',
    color: 'var(--text)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }

  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '24px 20px',
    width: '100%',
    maxWidth: 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    fontSize: 13,
  }

  return (
    <div style={page}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:24 }}>
        <img src="/images/iusd.png?v=20260414" alt="iUSD" style={{ width:32, height:32, borderRadius:'50%' }} />
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--text)', letterSpacing:'0.05em' }}>
            iUSD <span style={{ color:'var(--muted)' }}>pay</span>
          </div>
          <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:'0.18em', textTransform:'uppercase' }}>
            {t('verify.title')}
          </div>
        </div>
      </div>

      <div style={card}>
        {loading && (
          <div style={{ textAlign:'center', color:'var(--muted)', fontSize:13 }}>
            {t('verify.verifying')}
          </div>
        )}

        {err && (
          <div style={{ textAlign:'center', gap:8, display:'flex', flexDirection:'column', alignItems:'center' }}>
            <div style={{ fontSize:13, color:'var(--muted)' }}>
              {err === 'NO_PID' ? t('verify.noPid') : err === 'NOT_FOUND' ? t('verify.notFound') : t('verify.error', { msg: err })}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', wordBreak:'break-all', fontFamily:'monospace' }}>
              {pid}
            </div>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Status badge */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:11, color:'var(--muted)', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700 }}>
                {t('verify.verification')}
              </div>
              <div style={{ fontSize:12, fontWeight:800, color: statusColor, letterSpacing:'0.06em',
                            background: statusColor + '18', borderRadius:8, padding:'3px 10px' }}>
                {statusLabel}
              </div>
            </div>

            {/* Amount */}
            <div style={{ textAlign:'center', padding:'8px 0' }}>
              <div style={{ fontSize:36, fontWeight:800, color:'var(--text)', letterSpacing:'-0.02em' }}>
                {IUSD(data.amountMicro)}
              </div>
              <div style={{ fontSize:13, color:'var(--muted)', marginTop:2 }}>iUSD</div>
            </div>

            <div style={{ height:1, background:'var(--border)' }} />

            {/* From / To */}
            {(data.senderNickname || data.recipientNickname) && (
              <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'center',
                            background:'var(--bg-elevated)', borderRadius:10, padding:'10px 14px' }}>
                <div style={{ flex:1, textAlign:'center' }}>
                  <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:'0.1em', marginBottom:4 }}>{t('giftClaim.from')}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{data.senderNickname ?? '—'}</div>
                  {privacyId(data.senderShortId) && (
                    <div style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace', marginTop:2 }}>
                      {privacyId(data.senderShortId)}
                    </div>
                  )}
                </div>
                <div style={{ color:'var(--muted)', fontSize:16 }}>→</div>
                <div style={{ flex:1, textAlign:'center' }}>
                  <div style={{ fontSize:9, color:'var(--muted)', letterSpacing:'0.1em', marginBottom:4 }}>{t('verify.to')}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{data.recipientNickname ?? '—'}</div>
                  {privacyId(data.recipientShortId) && (
                    <div style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace', marginTop:2 }}>
                      {privacyId(data.recipientShortId)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Details */}
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div style={row}>
                <span style={{ color:'var(--muted)' }}>{t('history.timeline.created')}</span>
                <span style={{ color:'var(--text)', fontWeight:600, textAlign:'right' }}>{relTime(data.createdAt)}</span>
              </div>
              {data.feeMicro && parseInt(data.feeMicro) > 0 && (
                <div style={row}>
                  <span style={{ color:'var(--muted)' }}>{t('verify.platformFee')}</span>
                  <span style={{ color:'var(--muted)', fontWeight:600 }}>{IUSD(data.feeMicro)} iUSD</span>
                </div>
              )}
              {data.claimedAt && (
                <div style={row}>
                  <span style={{ color:'var(--muted)' }}>{t('history.timeline.confirmed')}</span>
                  <span style={{ color:'#22c55e', fontWeight:600, textAlign:'right' }}>{relTime(data.claimedAt)}</span>
                </div>
              )}
              {data.txHash && (
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  <span style={{ fontSize:11, color:'var(--muted)' }}>{t('verify.txHash')}</span>
                  <a
                    href={`${EXPLORER_TX_BASE}/${data.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize:10, fontFamily:'monospace', color:'#60a5fa',
                             wordBreak:'break-all', textDecoration:'none' }}
                  >
                    {data.txHash}
                  </a>
                </div>
              )}
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ fontSize:11, color:'var(--muted)' }}>{t('history.paymentId')}</span>
                <span style={{ fontSize:10, fontFamily:'monospace', color:'var(--muted)',
                               wordBreak:'break-all' }}>
                  {data.paymentId}
                </span>
              </div>
            </div>

            <div style={{ height:1, background:'var(--border)' }} />
            <div style={{ fontSize:10, textAlign:'center', color:'var(--muted)',
                          letterSpacing:'0.08em' }}>
              iusd-pay.xyz · INITIA
            </div>
          </>
        )}
      </div>

      <button
        onClick={() => navigate('/')}
        style={{ marginTop:20, fontSize:11, color:'var(--muted)', background:'none',
                 border:'none', cursor:'pointer', letterSpacing:'0.1em', textTransform:'uppercase' }}
      >
        {t('verify.goHomepage')}
      </button>
    </div>
  )
}
