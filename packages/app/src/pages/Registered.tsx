/**
 * Registered — WOW! You got a card. Share it.
 * Click the card → transition into Dashboard (with auto-flip animation)
 */
import { useNavigate, useLocation } from 'react-router-dom'
import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthContext, useAuthContext } from '../hooks/AuthContext'
import { IdentityCard } from '../components/IdentityCard'
import { playWelcome } from '../lib/sound'

const APP_URL = import.meta.env.VITE_APP_URL ?? 'https://iusd-pay.xyz'

// ── Main page ─────────────────────────────────────────────────────────────
export default function Registered() {
  const { t } = useTranslation()
  const navigate  = useNavigate()
  const location  = useLocation()
  const ctx = useContext(AuthContext)
  const { account: authAccount, status, ikLoading, refreshAccount } = useAuthContext()
  const account = authAccount ?? (location.state as any)?.account ?? null

  // If no account, try to refresh from server
  useEffect(() => {
    if (!account && status === 'registered') {
      refreshAccount?.()
    }
  }, [account, status])

  // Welcome fanfare on mount — plays once when the card first appears
  useEffect(() => {
    if (account) {
      // Small delay so audio context is ready after page transition
      setTimeout(() => playWelcome(), 250)
    }
  }, [!!account])

  if (!ctx) return null

  // Show loading while waiting for account data
  if (ikLoading || !account) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('common.loading')}</p>
      </div>
    )
  }

  const receiveUrl = account ? `${APP_URL}/profile/${account.shortId}` : APP_URL
  const shareText  = t('registered.shareText')

  function goToDashboard() {
    navigate('/app', { replace: true, state: { fromRegistration: true } })
  }

  if (!account) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('common.loading')}</p>
        <button onClick={goToDashboard} style={{
          background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 12,
          padding: '12px 32px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>{t('registered.openWallet')}</button>
      </div>
    )
  }

  return (
    <div style={{
      minHeight:      '100vh',
      background:     'var(--bg)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        '32px 20px',
      gap:            22,
    }}>

      {/* ── WOW header ─────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 6 }}>🎉</div>
        <h1 style={{
          fontFamily:    "'Press Start 2P', monospace",
          fontSize:      13,
          color:         'var(--text)',
          letterSpacing: '0.04em',
          lineHeight:    1.6,
          margin:        0,
        }}>
          {t('registered.wow')}<br/>
          <span style={{ color: 'rgba(255,220,100,0.95)' }}>{t('registered.wowCard')}</span>
        </h1>
      </div>

      {/* ── Card ────────────────────────────────────────────────── */}
      <div
        onClick={goToDashboard}
        style={{ cursor: 'pointer', borderRadius: 18, transition: 'transform 0.2s', width: '100%', maxWidth: 360 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.025)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
      >
        <IdentityCard account={account} status="active" />
      </div>

      {/* ── TAP CARD + share button ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <p style={{ fontSize: 9, color: 'var(--muted)', margin: 0, letterSpacing: '0.12em',
                    fontFamily: "'Press Start 2P', monospace" }}>
          {t('registered.tapCard')}
        </p>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (navigator.share) {
              navigator.share({ title: `${account.nickname} · iUSD Pay`, url: receiveUrl, text: shareText })
            } else {
              navigator.clipboard.writeText(receiveUrl)
            }
          }}
          title="Share"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--muted)', display: 'flex', alignItems: 'center',
            transition: 'color 0.15s, transform 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </button>
      </div>

    </div>
  )
}
