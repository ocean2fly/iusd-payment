/**
 * /pay-request/:token — Payee fills in their ID + amount
 * Opened when someone scans a payer's dynamic payment QR code.
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { API_BASE } from '../config'
import { useAuthContext } from '../hooks/AuthContext'

export default function PayRequest() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const { account } = useAuthContext()
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [shortId, setShortId] = useState('')
  const [amount, setAmount]   = useState('')
  const [memo, setMemo]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Auto-fill shortId from logged-in account
  useEffect(() => {
    if (account?.shortId && !shortId) setShortId(account.shortId)
  }, [account?.shortId])  // eslint-disable-line

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/pay-session/${token}`)
      .then(r => r.json())
      .then(d => { setSession(d); setLoading(false) })
      .catch(() => { setError('Failed to load session'); setLoading(false) })
  }, [token])

  async function handleSubmit() {
    if (!shortId.trim() || !amount.trim() || !token) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/pay-session/${token}/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortId: shortId.trim(), amount: amount.trim(), memo: memo.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const page: React.CSSProperties = {
    minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e3',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: '24px 16px',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  }
  const card: React.CSSProperties = {
    width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20,
    padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16,
  }
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10,
    fontSize: 14, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#e8e8e3', outline: 'none',
  }

  if (loading) return <div style={page}><div style={{ color: 'rgba(255,255,255,0.4)' }}>{t('common.loading')}</div></div>

  if (session?.status === 'expired') return (
    <div style={page}><div style={card}>
      <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700 }}>{t('transfer.sessionExpired')}</div>
      <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
        Ask the payer to generate a new payment code.
      </div>
    </div></div>
  )

  if (session?.status === 'filled' || done) return (
    <div style={page}><div style={card}>
      <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{t('payRequest.requestSent')}</div>
      <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
        The payer will see your request and confirm payment.
      </div>
      <a href="/app"
        style={{ display:'block', textAlign:'center', padding:'11px 0', borderRadius:10,
                 background:'rgba(255,255,255,0.08)', color:'#fff', fontSize:13, fontWeight:600,
                 textDecoration:'none', marginTop:8 }}>
        Back to Home
      </a>
    </div></div>
  )

  if (error && !session) return (
    <div style={page}><div style={card}>
      <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{t('payRequest.error')}</div>
      <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{error}</div>
    </div></div>
  )

  return (
    <div style={page}>
      <div style={card}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <img src="/images/iusd.png?v=20260414" style={{ width: 40, height: 40, borderRadius: '50%', marginBottom: 12 }} alt="" />
          <div style={{ fontSize: 18, fontWeight: 700 }}>{t('payRequest.title')}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            Enter your ID and amount to request payment
          </div>
        </div>

        {/* Form */}
        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>
            Your Account ID
          </label>
          <input style={input} value={shortId} onChange={e => setShortId(e.target.value)}
            placeholder="e.g. 66EA315LRMLDOYY7" autoFocus />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>
            Amount (iUSD)
          </label>
          <input style={input} value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" type="number" step="0.01" min="0.1" />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>
            Memo (optional)
          </label>
          <input style={input} value={memo} onChange={e => setMemo(e.target.value)}
            placeholder="What's this for?" />
        </div>

        {error && <div style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{error}</div>}

        <button onClick={handleSubmit} disabled={submitting || !shortId.trim() || !amount.trim()}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
            background: shortId.trim() && amount.trim() ? '#22c55e' : 'rgba(255,255,255,0.1)',
            color: shortId.trim() && amount.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>
          {submitting ? 'Sending...' : 'Send Request'}
        </button>

        {!account && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            Don't have an account?{' '}
            <a href="/welcome" style={{ color: '#22c55e', textDecoration: 'none', fontWeight: 600 }}>Register</a>
          </div>
        )}
        {account && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(34,197,94,0.6)' }}>
            Logged in as {account.nickname ?? account.shortId}
          </div>
        )}
        <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          iusd-pay.xyz · INITIA
        </div>
      </div>
    </div>
  )
}
