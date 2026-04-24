/**
 * QuickLogin — Universal login component for all public pages.
 *
 * Handles auth states: idle/error → connected → signing/checking → registered
 * For unregistered users: redirects to /app/welcome (normal registration flow with TOS).
 *
 * Adapts to 3 browser environments (same as Landing.tsx):
 *   - Desktop: Single button → IK connect modal
 *   - Mobile wallet browser: Connect button
 *   - Mobile browser: Social login (Email/Google/X) + wallet deep links
 */
import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { useAuthContext } from '../hooks/AuthContext'
import { getBrowserEnvironment } from '../lib/browserDetection'

// ── Icons (same as Landing.tsx) ──────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
)

const EmailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
)

// ── Component ────────────────────────────────────────────────────────────

interface QuickLoginProps {
  /** Label for action, e.g. "Open", "Pay", "interact" */
  actionLabel?: string
  /** Accent color for primary button */
  accentColor?: string
}

export function QuickLogin({ actionLabel = 'Continue', accentColor }: QuickLoginProps) {
  const { t } = useTranslation()
  const auth = useAuthContext()
  const navigate = useNavigate()
  const { openConnect } = useInterwovenKit() as any
  const [showOtherModal, setShowOtherModal] = useState(false)

  const env = getBrowserEnvironment()
  const isLoading = auth.status === 'signing' || auth.status === 'checking' || auth.ikLoading

  // Redirect unregistered users to Welcome page (save return path)
  useEffect(() => {
    if (auth.status === 'unregistered') {
      sessionStorage.setItem('ipay2_return_path', window.location.pathname + window.location.search)
      navigate('/app/welcome', { replace: true })
    }
  }, [auth.status, navigate])

  // Social login helper (auto-click Email/Socials in IK shadow DOM)
  const openSocialLogin = useCallback(() => {
    openConnect()
    let attempts = 0
    const timer = setInterval(() => {
      attempts++
      if (attempts > 40) { clearInterval(timer); return }
      const ikEl = document.querySelector('interwoven-kit')
      const shadow = (ikEl as any)?.shadowRoot as ShadowRoot | null
      if (!shadow) return
      const btns = Array.from(shadow.querySelectorAll('button')) as HTMLButtonElement[]
      const socialBtn = btns.find(b =>
        /email|social/i.test(b.textContent ?? '') ||
        /email|social/i.test(b.getAttribute('aria-label') ?? '')
      )
      if (socialBtn) { clearInterval(timer); socialBtn.click() }
    }, 100)
  }, [openConnect])

  const statusHint = auth.status === 'signing' ? t('components.quickLogin.signing')
    : auth.status === 'checking' ? t('components.quickLogin.verifying')
    : null

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    width: '100%', padding: '14px', borderRadius: 12, border: 'none',
    fontSize: 14, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: accentColor || 'var(--text)',
    color: accentColor ? '#fff' : 'var(--surface)',
    opacity: disabled ? 0.4 : 1,
  })

  // ── registered: parent handles this, QuickLogin shouldn't render ──
  if (auth.status === 'registered') return null

  // ── connected / signing / checking: show "Sign in to [action]" ──
  // User has wallet connected but hasn't signed yet (or is in progress)
  if (auth.status === 'connected' || auth.status === 'signing' || auth.status === 'checking') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        <button onClick={() => auth.triggerSign?.()} disabled={isLoading}
          style={btnStyle(isLoading)}>
          {isLoading ? (statusHint ?? t('components.quickLogin.processing')) : t('components.quickLogin.signInTo', { action: actionLabel })}
        </button>
        {auth.status === 'connected' && !isLoading && (
          <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
            {t('components.quickLogin.walletTapToSignIn')}
          </div>
        )}
      </div>
    )
  }

  // ── unregistered: redirect to Welcome (normal TOS + registration flow) ──
  // This state means wallet signed but no account yet — need proper registration
  if (auth.status === 'unregistered') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('components.quickLogin.almostThere', { action: actionLabel.toLowerCase() })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {t('components.quickLogin.redirecting')}
        </div>
      </div>
    )
  }

  // ── error: show error + retry ──
  if (auth.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: '#f87171' }}>
          {auth.error || t('components.quickLogin.connectionFailed')}
        </div>
        <button onClick={() => auth.retry?.()} style={btnStyle(false)}>
          {t('components.quickLogin.tryAgain')}
        </button>
      </div>
    )
  }

  // ── idle: need to connect wallet ──

  // Desktop
  if (env === 'desktop') {
    return (
      <button onClick={() => openConnect()} disabled={isLoading}
        style={btnStyle(isLoading)}>
        {isLoading ? t('components.quickLogin.connecting') : t('components.quickLogin.connectTo', { action: actionLabel })}
      </button>
    )
  }

  // Mobile wallet browser
  if (env === 'mobile-wallet-browser') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <button onClick={() => openConnect()} disabled={isLoading}
          style={btnStyle(isLoading)}>
          {isLoading ? t('components.quickLogin.connecting') : t('components.quickLogin.connectTo', { action: actionLabel })}
        </button>
        {!isLoading && (
          <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
            {t('components.quickLogin.tapConnectHint')}
          </div>
        )}
      </div>
    )
  }

  // Mobile browser: social + wallet deep links
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {/* Social login */}
      <button onClick={openSocialLogin} disabled={isLoading}
        style={{
          width: '100%', padding: '14px', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.4 : 1,
        }}>
        <span style={{ fontSize: 11, color: 'var(--text)', letterSpacing: '0.04em' }}>{t('components.quickLogin.signInWith')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <EmailIcon /><GoogleIcon /><XIcon />
        </div>
      </button>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.1em' }}>{t('components.quickLogin.orWallet')}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      {/* Wallet deep links */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
        <button onClick={() => { window.location.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}${window.location.search}` }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <img src="/images/metamask.svg" alt="MetaMask" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <span style={{ fontSize: 8, color: 'var(--muted)' }}>MetaMask</span>
        </button>

        <button onClick={() => { window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}` }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <img src="/images/phantom.webp" alt="Phantom" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <span style={{ fontSize: 8, color: 'var(--muted)' }}>Phantom</span>
        </button>

        <button onClick={async () => {
          try { await navigator.clipboard.writeText(window.location.href) } catch {}
          setShowOtherModal(true)
        }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '8px 10px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <img src="/images/rabby.svg" alt="" style={{ width: 22, height: 22, borderRadius: 5 }} />
            <img src="/images/keplr.svg" alt="" style={{ width: 22, height: 22, borderRadius: 5 }} />
            <img src="/images/okx.svg" alt="" style={{ width: 22, height: 22, borderRadius: 5 }} />
            <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 2 }}>...</span>
          </div>
          <span style={{ fontSize: 8, color: 'var(--muted)' }}>{t('components.quickLogin.other')}</span>
        </button>
      </div>

      {showOtherModal && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text)', marginBottom: 6, fontWeight: 600 }}>{t('components.quickLogin.openInWalletBrowser')}</div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 8, wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.5 }}>{window.location.href}</div>
          <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 6 }}>{t('components.quickLogin.linkCopied')}</div>
          <button onClick={() => setShowOtherModal(false)} style={{ fontSize: 10, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('components.quickLogin.dismiss')}</button>
        </div>
      )}
    </div>
  )
}
