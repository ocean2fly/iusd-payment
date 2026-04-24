/**
 * Landing Page — environment-aware wallet UX
 *
 * Desktop              → Connect button → popup tip modal → IK modal
 * Mobile wallet browser→ Wallet icon + Connect button
 * Mobile browser       → Social login (one button, 3 icons) + MetaMask/Phantom/Other
 *
 * Auth flow:
 *   Wallet connects → auth enters 'connected' state → user clicks "Sign in"
 *   → triggerSign (from click handler, avoids popup blocker) → navigates when done
 */
import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { useAuthContext } from '../hooks/AuthContext'
import {
  getBrowserEnvironment,
  detectWalletBrowser,
  isMobile,
  canInstallPWA,
  MOBILE_WALLET_LINKS,
  type WalletName,
} from '../lib/browserDetection'
import { InstallTip } from '../components/InstallTip'
import { PullToRefresh } from '../components/PullToRefresh'
import { MobileWalletChoice } from '../components/MobileWalletChoice'
import { LangSwitcher } from '../components/LangSwitcher'
import {
  restoreSession,
  preInitWalletConnect,
} from '../lib/walletConnectMobile'
import { checkCallback as mwpCheckCallback } from '../lib/mwpConnect'
import { checkCoinbaseCallback } from '../lib/coinbaseMWP'
import { checkForApprovedSession } from '../lib/wcSessionRecovery'
import { resumePollingIfNeeded, getPending as getWCPending } from '../lib/wcLocalProxy'

// ─── Icons ────────────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)
const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
)
const EmailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
)

// ─── Shared UI ────────────────────────────────────────────────────────────
function ForceRefreshButton() {
  const { t } = useTranslation()
  const [showTip, setShowTip] = useState(false)

  function handleForceRefresh() {
    // Clear all local data
    localStorage.clear()
    sessionStorage.clear()
    // Hard reload with cache bust
    window.location.href = window.location.origin + '/?v=' + Date.now()
  }

  return (
    <div className="relative flex items-center justify-center">
      <button
        onClick={handleForceRefresh}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onTouchStart={() => setShowTip(v => !v)}
        className="flex items-center gap-1 transition-opacity hover:opacity-70 active:opacity-50"
        style={{ color: 'var(--muted)' }}
        title={t('landing.forceRefresh')}
      >
        {/* Refresh icon */}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 15-6.7L21 9M21 3v6h-6"/>
          <path d="M21 12a9 9 0 0 1-15 6.7L3 15M3 21v-6h6"/>
        </svg>
        <span className="text-[8px] tracking-[0.15em] uppercase">{t('landing.refresh', 'Refresh')}</span>
      </button>

      {/* Tooltip */}
      {showTip && (
        <div
          className="absolute top-5 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-lg px-3 py-1.5 text-[10px] text-[var(--muted)] pointer-events-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {t('landing.forceRefreshTip', 'Force refresh to resolve local page issues')}
        </div>
      )}
    </div>
  )
}

function Wordmark() {
  const { t } = useTranslation()
  // Render tagline with bold "Initia" — split on the brand token to keep it
  // safely localizable (translators move "Initia" wherever fits their grammar).
  const tagline = t('landing.tagline')
  const parts = tagline.split('Initia')
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        <img src="/images/iusd.png?v=20260414" alt="iUSD" className="w-10 h-10 rounded-full opacity-90" />
        <h1
          className="text-4xl sm:text-5xl font-light tracking-[0.08em] whitespace-nowrap"
          style={{ color: 'var(--text)' }}
        >
          iUSD<span style={{ color: 'var(--text)' }}> pay</span>
        </h1>
      </div>
      <p className="text-[8px] tracking-[0.22em] uppercase text-center" style={{ color: 'var(--muted)' }}>
        {parts[0]}
        <span style={{ color: 'var(--text)' }}>Initia</span>
        {parts[1] ?? ''}
      </p>
      <ForceRefreshButton />
    </div>
  )
}

function Rings() {
  return (
    <>
      <div className="absolute w-[300px] h-[300px] rounded-full border animate-pulse-ring" style={{ borderColor: 'var(--border)' }} />
      <div className="absolute w-[480px] h-[480px] rounded-full border animate-pulse-ring" style={{ borderColor: 'var(--border)', animationDelay: '1.5s' }} />
      <div className="absolute w-[660px] h-[660px] rounded-full border animate-pulse-ring" style={{ borderColor: 'var(--border)', animationDelay: '3s' }} />
    </>
  )
}

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIOS) return false
  // Exclude in-app webviews (Chrome/Firefox on iOS, wallet browsers) — only real Safari
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)
}

function ErrorBlock({ error, errorKind, onRetry, onReconnect, onShowPopupDetail }: {
  error: string
  errorKind: string | null
  onRetry: () => void
  onReconnect: () => void
  onShowPopupDetail?: () => void
}) {
  const { t } = useTranslation()
  const isConnectorError = errorKind === 'connector'
  // Popup-suspect on iOS Safari: anything that isn't a user cancel, a
  // connector loss, or a network/API failure. Stage-tagged [nonce] and
  // [verify] errors land in 'network' and are excluded — those are fetch
  // issues (CORS / TLS / ITP), not popup blocks, so sending users into
  // the safari_bad/safari_good settings guide would be misleading.
  const isPopupError = errorKind === 'popup' || (
    isIOSSafari()
      && errorKind !== null
      && errorKind !== 'cancelled'
      && errorKind !== 'connector'
      && errorKind !== 'network'
  )
  return (
    <div className="flex flex-col items-center gap-2">
      <p className={`text-xs text-center ${isPopupError ? 'text-sky-400' : 'text-red-400'}`}>
        {error}
        {isPopupError && onShowPopupDetail && (
          <>
            {' '}
            <button
              onClick={onShowPopupDetail}
              className="text-sky-400 underline hover:text-sky-300"
            >
              {t('popup.checkDetail')}
            </button>
          </>
        )}
      </p>
      {isConnectorError ? (
        <button onClick={onReconnect} className="text-xs text-[var(--muted)] underline">
          {t('auth.reconnect')}
        </button>
      ) : (
        <button onClick={onRetry} className="text-xs text-[var(--muted)] underline">
          {t('auth.tryAgain')}
        </button>
      )}
    </div>
  )
}

// ─── Popup tip modal ──────────────────────────────────────────────────────
function PopupTipModal({ onContinue, onClose }: { onContinue: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const mobile = isMobile()
  const iosSafari = isIOSSafari()
  const [step, setStep] = useState<'bad' | 'good'>('bad')

  const finish = () => { onClose(); onContinue() }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      style={{ background: 'var(--bg)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-4 sm:p-5 flex flex-col"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          maxHeight: 'calc(100dvh - 1.5rem)',
          overflowY: 'auto',
          // Only stretch to ~90% of viewport for the iOS Safari guide — the
          // non-iOS branch is just short copy + Continue button, so forcing
          // 90dvh there would leave huge empty space.
          ...(iosSafari ? { minHeight: '90dvh' } : {}),
        }}
        onClick={e => e.stopPropagation()}
      >
        {iosSafari ? (
          <>
            <h3 className="text-lg font-semibold text-sky-400 text-center mb-2">
              {t('popup.title')}
            </h3>
            <p className="text-sm text-[var(--muted)] text-center mb-5">
              {t('popup.subtitle')}
            </p>
            <div
              className="flex-1 flex items-center justify-center mb-5"
              style={{ minHeight: 0 }}
            >
              <img
                src={step === 'bad' ? '/images/setting_bad.png' : '/images/setting_good.png'}
                alt=""
                className="rounded-lg"
                style={{
                  maxWidth: '100%',
                  maxHeight: '50dvh',
                  objectFit: 'contain',
                  border: '1px solid var(--border)',
                }}
              />
            </div>
            {step === 'bad' ? (
              <button
                onClick={() => setStep('good')}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-elevated)]"
                style={{ background: 'var(--bg-elevated)' }}
              >
                {t('popup.next')}
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setStep('bad')}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-[var(--muted)] transition-all hover:bg-[var(--bg-elevated)]"
                  style={{ border: '1px solid var(--border)' }}
                >
                  {t('popup.back')}
                </button>
                <button
                  onClick={finish}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-elevated)]"
                  style={{ background: 'var(--bg-elevated)' }}
                >
                  {t('popup.gotIt')}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="text-sm font-medium text-[var(--text)] text-center mb-3">{t('popup.enableTitle')}</h3>
            <p className="text-xs text-[var(--muted)] text-center mb-5">
              {t('popup.signinNeedsPopup')}<br />
              {mobile ? t('popup.gotoMobile') : t('popup.gotoDesktop')}
            </p>
            <button
              onClick={finish}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-elevated)]"
              style={{ background: 'var(--bg-elevated)' }}
            >
              {t('popup.continue')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Other wallets modal ───────────────────────────────────────────────────
function OtherWalletsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--bg)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-2xl p-5 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs text-[var(--muted)] mb-3">{t('wallets.openInWalletBrowser')}</p>
        <p className="text-xs text-[var(--muted)] mb-5 flex items-center justify-center gap-1.5 flex-wrap">
          <img src="/images/iusd.png?v=20260414" alt="iUSD" className="w-4 h-4 rounded-full inline" />
          <span>{t('wallets.pasteUrl')}</span>
        </p>
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-elevated)]"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          {t('wallets.done')}
        </button>
      </div>
    </div>
  )
}

// ─── Landing ──────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { address, openConnect, disconnect } = useInterwovenKit() as any
  const auth = useAuthContext()

  const [hint,                 setHint]                  = useState<string | null>(null)
  const [showPopupTip,         setShowPopupTip]          = useState(false)
  const [popupTipAction,       setPopupTipAction]        = useState<'social' | 'connect' | 'detail'>('connect')
  const [chosenWallet,         setChosenWallet]          = useState<WalletName | null>(null)
  const [showOtherWalletModal, setShowOtherWalletModal]  = useState(false)
  const [showInstallTip, setShowInstallTip] = useState(false)
  const [showSocialHint,       setShowSocialHint]        = useState(false)

  const env        = getBrowserEnvironment()
  const walletInfo = detectWalletBrowser()
  const isLoading   = auth.status === 'signing' || auth.status === 'checking'
  // "Booting" covers the gaps where the button would otherwise show a stale
  // label: IK is still restoring its persisted wallet, or the address has
  // landed but useAuth's 800ms debounce hasn't transitioned status to
  // 'connected' yet. Treat these as loading so we don't flash "Sign in"
  // before the click handler is actually wired to triggerSign.
  const isBooting   = auth.ikLoading || (!!address && auth.status === 'idle')
  // Wallet is connected AND we need the user to (re)sign. Covers both
  // the happy 'connected' state and the 'error' state after a failed sign
  // attempt — in both cases the wallet is still there, so the main CTA
  // should be Sign in (not Connect, which would reopen IK needlessly).
  const needsSign   = !!address && (auth.status === 'connected' || auth.status === 'error')

  // ── Navigate when auth completes ─────────────────────────────────────
  useEffect(() => {
    if (auth.status === 'registered') {
      // Restore intended path (set by RequireAuth on refresh), or fall back to dashboard
      const returnPath = sessionStorage.getItem('ipay2_return_path')
      if (returnPath && returnPath !== '/app/welcome'
          && (returnPath.startsWith('/app/') || returnPath.startsWith('/gift/'))) {
        sessionStorage.removeItem('ipay2_return_path')
        navigate(returnPath, { replace: true })
      } else {
        navigate('/app', { replace: true })
      }
    }
    if (auth.status === 'unregistered') navigate('/app/welcome',  { replace: true })
  }, [auth.status, navigate])

  // ── Hint messages from auth state ─────────────────────────────────────
  useEffect(() => {
    if (auth.status === 'signing')  setHint(t('auth.checkWallet'))
    else if (auth.status === 'checking') setHint(t('auth.settingUp'))
    else if (auth.status === 'connected') setHint(null)
    else if (auth.status === 'error' || auth.status === 'idle' ||
             auth.status === 'registered' || auth.status === 'unregistered') setHint(null)
  }, [auth.status, t])

  // ── Auto-open popup guide once per auth error on iOS Safari ─────────
  // On iOS Safari almost any IK failure that isn't a user cancel or a
  // connector / network issue is actually the browser blocking a pop-up —
  // IK surfaces the underlying error as a generic 'unknown' without the
  // word "popup". Treat anything that isn't clearly a known-benign kind
  // as popup-suspect so the guide auto-opens for Sign failures too, not
  // just Connect failures.
  //
  // Resets on mount (refresh), so each fresh occurrence triggers it; but
  // once the user closes the modal for a given error, it won't reopen
  // automatically — they can still reopen via the "Check detail" link.
  const autoShownForErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (auth.status !== 'error' || !auth.error) return
    if (!isIOSSafari()) return
    // Skip truly user-initiated cancels, connector losses, and network/API
    // failures. 'network' covers stage-tagged [nonce] / [verify] fetch errors
    // and iOS Safari's "Load failed" — these are CORS / TLS / ITP issues
    // unrelated to browser popup settings, so the safari_bad/safari_good
    // guide would mislead users into changing settings that can't help.
    if (
      auth.errorKind === 'cancelled' ||
      auth.errorKind === 'connector' ||
      auth.errorKind === 'network'
    ) return
    if (autoShownForErrorRef.current === auth.error) return
    autoShownForErrorRef.current = auth.error
    setPopupTipAction('detail')
    setShowPopupTip(true)
  }, [auth.status, auth.error, auth.errorKind])

  // ── Pre-init WalletConnect + handle callbacks ─────────────────────────
  useEffect(() => {
    preInitWalletConnect()

    const coinbaseResult = checkCoinbaseCallback()
    if (coinbaseResult.isCallback && coinbaseResult.address) setHint(t('auth.coinbaseConnected'))

    const mwpResult = mwpCheckCallback()
    if (mwpResult.isCallback && mwpResult.address) setHint(t('auth.walletConnected'))

    checkForApprovedSession().then(session => {
      if (session?.found) { setHint(t('auth.restoring')); restoreSession() }
    })
  }, [t])

  // ── Resume WalletConnect polling on mobile browser ────────────────────
  useEffect(() => {
    if (env !== 'mobile-browser') return
    const pending = getWCPending()
    if (pending) resumePollingIfNeeded(
      () => { /* IK address → useAuth handles */ },
      () => setHint(t('auth.wcTimeout'))
    )
  }, [env, t])

  // ── IK social login helper ─────────────────────────────────────────────
  function openSocialLogin() {
    openConnect()
    setShowSocialHint(true)
    setTimeout(() => setShowSocialHint(false), 4000)
    // Auto-click "Email / Socials" in IK shadow DOM
    let attempts = 0
    const timer = setInterval(() => {
      attempts++
      if (attempts > 40) { clearInterval(timer); return }
      const ikEl   = document.querySelector('interwoven-kit')
      const shadow = (ikEl as any)?.shadowRoot as ShadowRoot | null
      if (!shadow) return
      const btns = Array.from(shadow.querySelectorAll('button')) as HTMLButtonElement[]
      const socialBtn = btns.find(b =>
        /email|social/i.test(b.textContent ?? '') ||
        /email|social/i.test(b.getAttribute('aria-label') ?? '')
      )
      if (socialBtn) { clearInterval(timer); socialBtn.click() }
    }, 100)
  }

  function openWalletConnect(walletName?: string) {
    openConnect()
    if (!walletName) return
    let attempts = 0
    const timer = setInterval(() => {
      attempts++
      if (attempts > 40) { clearInterval(timer); return }
      const ikEl   = document.querySelector('interwoven-kit')
      const shadow = (ikEl as any)?.shadowRoot as ShadowRoot | null
      if (!shadow) return
      const re   = new RegExp(walletName, 'i')
      const btns = Array.from(shadow.querySelectorAll('button')) as HTMLButtonElement[]
      const btn  = btns.find(b => re.test(b.textContent ?? '') || re.test(b.getAttribute('aria-label') ?? ''))
      if (btn) { clearInterval(timer); btn.click() }
    }, 100)
  }

  function showPopupDetail() {
    setPopupTipAction('detail')
    setShowPopupTip(true)
  }

  // ── Action helpers (TOS guard) ────────────────────────────────────────
  function handleDesktopConnect() {
    if (isLoading) return
    // Clear the "already shown" ref so a repeat Sign attempt after the
    // user dismissed the guide can re-trigger it on the next failure.
    autoShownForErrorRef.current = null
    // Wallet still connected (either fresh-connected or recovering from a
    // prior sign error) → trigger sign from the click handler to keep
    // popups inside user activation on iOS Safari.
    if (address && (auth.status === 'connected' || auth.status === 'error')) {
      auth.triggerSign()
      return
    }
    // iOS Safari: go straight into the login flow. If pop-ups are allowed
    // the user sees nothing extra; if they're blocked, auth emits a popup
    // error and the guide auto-opens (see effect below). Showing the
    // walkthrough up-front every time was confusing users who already had
    // pop-ups enabled.
    if (isIOSSafari()) {
      openConnect()
      return
    }
    // Non-iOS: keep the simple "Enable Pop-ups" pre-flight tip.
    setPopupTipAction('connect')
    setShowPopupTip(true)
  }

  function handleSocialClick() {
    if (isLoading) return
    autoShownForErrorRef.current = null
    // Wallet still connected (or recovering from a prior sign error) →
    // sign in directly from the click handler.
    if (address && (auth.status === 'connected' || auth.status === 'error')) {
      auth.triggerSign()
      return
    }
    // iOS Safari: skip the pre-flight guide — it auto-opens on popup error.
    if (isIOSSafari()) {
      openSocialLogin()
      return
    }
    setPopupTipAction('social')
    setShowPopupTip(true)
  }

  function handleReconnect() {
    try { disconnect?.() } catch {}
    setTimeout(() => openConnect(), 300)
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <PullToRefresh />
      <Rings />
      <div className="absolute top-3 end-3 z-20">
        <LangSwitcher />
      </div>
      <div className="relative z-10 w-full max-w-xs px-6">

        {/* ═══ DESKTOP ═══════════════════════════════════════════════ */}
        {env === 'desktop' && (
          <div className="flex flex-col items-center gap-6">
            <Wordmark />

            {hint && (
              <p className="text-xs text-[var(--muted)] text-center animate-pulse">{hint}</p>
            )}

            {auth.status === 'error' && auth.error && (
              <ErrorBlock
                error={auth.error}
                errorKind={auth.errorKind}
                onRetry={auth.retry}
                onReconnect={handleReconnect}
                onShowPopupDetail={isIOSSafari() ? showPopupDetail : undefined}
              />
            )}

            <button
              onClick={handleDesktopConnect}
              disabled={isLoading || isBooting}
              className="w-full border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] hover:border-[var(--text)] rounded-xl px-8 py-3.5 text-[11px] tracking-[0.2em] uppercase transition-all duration-300 disabled:opacity-50"
            >
              {(isLoading || isBooting) ? (hint ?? t('auth.connecting')) : needsSign ? t('auth.signIn') : t('auth.connect')}
            </button>
          </div>
        )}

        {/* ═══ MOBILE WALLET BROWSER (MetaMask, Keplr app…) ══════════ */}
        {env === 'mobile-wallet-browser' && (
          <div className="flex flex-col items-center gap-8">
            <Wordmark />

            {walletInfo.walletName && MOBILE_WALLET_LINKS[walletInfo.walletName as WalletName] && (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={MOBILE_WALLET_LINKS[walletInfo.walletName as WalletName].icon}
                  alt={walletInfo.walletName}
                  className="w-12 h-12 rounded-xl opacity-90"
                />
              </div>
            )}

            {hint && (
              <p className="text-xs text-[var(--muted)] text-center animate-pulse">{hint}</p>
            )}

            {auth.status === 'error' && auth.error && (
              <ErrorBlock
                error={auth.error}
                errorKind={auth.errorKind}
                onRetry={auth.retry}
                onReconnect={handleReconnect}
                onShowPopupDetail={isIOSSafari() ? showPopupDetail : undefined}
              />
            )}

            <button
              onClick={() => {
                if (isLoading) return
                // Wallet still connected (or recovering from prior sign error)
                // → sign from the click handler; don't reopen the wallet picker.
                if (address && (auth.status === 'connected' || auth.status === 'error')) {
                  auth.triggerSign()
                  return
                }
                if (walletInfo.walletName) openWalletConnect(walletInfo.walletName)
                else openConnect()
              }}
              disabled={isLoading || isBooting}
              className="w-full border border-white/40 rounded-xl px-8 py-3.5 text-[11px] tracking-[0.2em] uppercase transition-all disabled:opacity-50"
              style={{ color: 'var(--text)', background: 'var(--bg-elevated)' }}
            >
              {(isLoading || isBooting) ? (hint ?? t('auth.signing')) : needsSign ? t('auth.signIn') : t('auth.connect')}
            </button>

            {!isLoading && (
              <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
                {t('auth.tapConnect')}
              </p>
            )}
          </div>
        )}

        {/* ═══ MOBILE BROWSER (Safari / Chrome mobile) ════════════════ */}
        {env === 'mobile-browser' && (
          <div className="flex flex-col items-center gap-5">
            <Wordmark />

            {/* Auth state feedback */}
            {hint && !auth.error && (
              <p className="text-xs text-[var(--muted)] text-center animate-pulse">{hint}</p>
            )}
            {auth.status === 'error' && auth.error && (
              <ErrorBlock
                error={auth.error}
                errorKind={auth.errorKind}
                onRetry={auth.retry}
                onReconnect={handleReconnect}
                onShowPopupDetail={isIOSSafari() ? showPopupDetail : undefined}
              />
            )}
            {showSocialHint && !auth.error && !hint && (
              <p className="text-xs text-[var(--muted)] text-center animate-pulse">
                {t('auth.openingWindow')}
              </p>
            )}

            {/* ─── Primary: Social login (ONE button, 3 icons) ─ */}
            <div className="w-full space-y-2">
              <button
                onClick={handleSocialClick}
                disabled={isLoading || isBooting}
                className="w-full flex items-center justify-center gap-3 rounded-xl py-3.5 transition-all disabled:opacity-50"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              >
                {needsSign ? (
                  <span className="text-[11px] tracking-[0.2em] uppercase" style={{ color: 'var(--text)' }}>
                    {t('auth.signIn')}
                  </span>
                ) : (
                  <>
                    <span className="text-[11px] tracking-wide" style={{ color: 'var(--text)' }}>
                      {t('auth.signInWith')}
                    </span>
                    <div className="flex items-center gap-2">
                      <EmailIcon /><GoogleIcon /><XIcon />
                    </div>
                  </>
                )}
                {(isLoading || isBooting) && (
                  <span className="text-[10px]" style={{ color: 'var(--muted)' }}>…</span>
                )}
              </button>
            </div>

            {/* ─── Divider ─ */}
            <div className="w-full flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'var(--bg-elevated)' }} />
              <span className="text-[8px] tracking-[0.18em] uppercase" style={{ color: 'var(--muted)' }}>{t('auth.or')}</span>
              <div className="flex-1 h-px" style={{ background: 'var(--bg-elevated)' }} />
            </div>

            {/* ─── Wallet deep-link buttons ─ */}
            <div className="flex items-center justify-center gap-4">
              {/* MetaMask */}
              <button
                onClick={() => { window.location.href = `https://metamask.app.link/dapp/${window.location.host}` }}
                className="flex flex-col items-center gap-1.5 transition-opacity hover:opacity-80 active:opacity-60"
                title="MetaMask"
              >
                <img src="/images/metamask.svg" alt="MetaMask" className="w-10 h-10 rounded-xl object-cover" />
                <span className="text-[8px] tracking-wide" style={{ color: 'var(--muted)' }}>MetaMask</span>
              </button>

              {/* Phantom */}
              <button
                onClick={() => { window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(window.location.href)}` }}
                className="flex flex-col items-center gap-1.5 transition-opacity hover:opacity-80 active:opacity-60"
                title="Phantom"
              >
                <img src="/images/phantom.webp" alt="Phantom" className="w-10 h-10 rounded-xl object-cover" />
                <span className="text-[8px] tracking-wide" style={{ color: 'var(--muted)' }}>Phantom</span>
              </button>

              {/* Other wallets — copy URL + show modal */}
              <button
                onClick={async () => {
                  try { await navigator.clipboard.writeText(window.location.host) } catch {}
                  setShowOtherWalletModal(true)
                }}
                className="flex flex-col items-center gap-1.5 transition-opacity hover:opacity-80 active:opacity-60"
                title="Other Wallets"
              >
                <div
                  className="flex items-center gap-0.5 px-2 py-2 rounded-xl"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  <img src="/images/rabby.svg"  alt="Rabby" className="w-6 h-6 rounded-md" />
                  <img src="/images/keplr.png"  alt="Keplr" className="w-6 h-6 rounded-md" />
                  <img src="/images/okx.svg"    alt="OKX"   className="w-6 h-6 rounded-md" />
                  <span className="text-[var(--muted)] text-xs ml-0.5">…</span>
                </div>
                <span className="text-[8px] tracking-wide" style={{ color: 'var(--muted)' }}>{t('wallets.other')}</span>
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── PWA install hint (mobile only, fixed bottom center) ──────── */}
      {env === 'mobile-browser' && canInstallPWA() && !window.matchMedia('(display-mode: standalone)').matches && (
        <div style={{ position: 'fixed', bottom: 20, left: 0, right: 0, textAlign: 'center', zIndex: 10 }}>
          <button onClick={() => setShowInstallTip(true)}
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', border: 'none', cursor: 'pointer',
                     fontSize: 12, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6,
                     padding: '10px 20px', borderRadius: 20 }}>
            {(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
              ? <span style={{ fontSize: 14 }}>{'\uF8FF'}</span>
              : <img src="https://cdn-icons-png.flaticon.com/128/160/160138.png" alt="" style={{ width: 16, height: 16 }} />}
            {t('landing.installAsApp')}
          </button>
        </div>
      )}
      {showInstallTip && <InstallTip onClose={() => setShowInstallTip(false)} />}

      {/* ── Popup Tip Modal (desktop → before opening IK) ─────────────── */}
      {showPopupTip && (
        <PopupTipModal
          onClose={() => setShowPopupTip(false)}
          onContinue={() => {
            if (popupTipAction === 'detail') return  // re-opened from error — no action
            if (popupTipAction === 'social') openSocialLogin()
            else openConnect()
          }}
        />
      )}

      {/* ── Other Wallets Modal ───────────────────────────────────────── */}
      {showOtherWalletModal && (
        <OtherWalletsModal onClose={() => setShowOtherWalletModal(false)} />
      )}



      {/* ── WalletConnect dialog ──────────────────────────────────────── */}
      {chosenWallet && (
        <MobileWalletChoice
          wallet={chosenWallet}
          onClose={() => setChosenWallet(null)}
          onConnected={() => setChosenWallet(null)}
        />
      )}
    </div>
  )
}
