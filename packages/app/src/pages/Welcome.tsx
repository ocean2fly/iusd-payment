/**
 * Welcome — shown to first-time users before registration.
 *
 * Flow: unregistered → /app/welcome → accept TOS → /app/register
 */
import { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthContext, useAuthContext } from '../hooks/AuthContext'
import { registerAccount } from '../services/account'
import { TosContent, PrivacyContent } from '../components/LegalContent'

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ─── Terms of Service modal ───────────────────────────────────────────────
function TosSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'var(--bg)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl flex flex-col"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-sm font-medium text-[var(--text)] tracking-wide">{t('welcome.tos')}</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--muted)] transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="h-px bg-[var(--border)] shrink-0" />

        {/* Content */}
        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ fontSize: '12px', lineHeight: '1.75', color: 'var(--muted)' }}>
          <TosContent />
        </div>

        <div className="px-5 py-4 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl text-xs tracking-widest uppercase text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Privacy Policy modal ─────────────────────────────────────────────────
function PrivacySheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'var(--bg)', backdropFilter: 'blur(12px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl flex flex-col"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-sm font-medium text-[var(--text)] tracking-wide">{t('welcome.privacy')}</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--muted)] transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="h-px bg-[var(--border)] shrink-0" />

        <div className="overflow-y-auto px-5 py-4 flex flex-col gap-4" style={{ fontSize: '12px', lineHeight: '1.75', color: 'var(--muted)' }}>
          <PrivacyContent />
        </div>

        <div className="px-5 py-4 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl text-xs tracking-widest uppercase text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Welcome page ─────────────────────────────────────────────────────────
export default function Welcome() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const rawCtx = useContext(AuthContext)
  const { status, account, token, refreshAccount, triggerSign } = useAuthContext()
  const [agreed, setAgreed]         = useState(false)

  // Auto-trigger sign-in if wallet connected but no session token
  useEffect(() => {
    if (status === 'connected' && !token) triggerSign()
  }, [status, token, triggerSign])

  // Redirect to dashboard (or return path) if already registered
  useEffect(() => {
    if (status === 'registered' || account) {
      const returnPath = sessionStorage.getItem('ipay2_return_path')
      if (returnPath) {
        sessionStorage.removeItem('ipay2_return_path')
        navigate(returnPath, { replace: true })
      } else {
        navigate('/app', { replace: true })
      }
    }
  }, [status, account, navigate])

  const [loading, setLoading]       = useState(false)
  const [showTos, setShowTos]       = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)

  // Return null only when AuthProvider hasn't mounted yet (concurrent render fallback)
  if (!rawCtx) return null
  // Still waiting for auth flow to complete
  if (status === 'checking' || status === 'signing') return null
  if (status === 'registered' || account) return null

  async function handleGetStarted() {
    if (!agreed || !token) return
    localStorage.setItem('ipay_tos_accepted', '1')
    setLoading(true)
    try {
      // Auto-register with server-generated nickname + avatar
      const newAccount = await registerAccount(token, '') // empty → server picks random nickname
      await refreshAccount()  // update auth context so RequireAuth passes
      const returnPath = sessionStorage.getItem('ipay2_return_path')
      if (returnPath) {
        sessionStorage.removeItem('ipay2_return_path')
        navigate(returnPath, { replace: true })
      } else {
        navigate('/app/registered', { replace: true, state: { account: newAccount } })
      }
    } catch {
      // If already registered, go to registered page (account loaded via /me)
      navigate('/app/registered', { replace: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      <div className="absolute w-[400px] h-[400px] rounded-full border border-[var(--border)] pointer-events-none" />

      <div className="relative z-10 w-full max-w-xs flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <img src="/images/iusd.png?v=20260414" alt="iUSD" className="w-9 h-9 rounded-full opacity-90" />
            <span className="text-2xl font-light tracking-[0.08em] text-[var(--text)]">
              iUSD <span className="text-[var(--muted)]">pay</span>
            </span>
          </div>
          <p className="text-[8px] tracking-[0.22em] uppercase text-[var(--muted)]">
            {t('welcome.tagline')}
          </p>
        </div>

        {/* Feature highlights */}
        <div className="flex flex-col gap-3">
          <p className="text-[9px] tracking-[0.22em] uppercase text-[var(--muted)]">{t('welcome.whatYouGet')}</p>
          <div className="flex flex-col gap-2">
            {[
              t('welcome.features.transfer'),
              t('welcome.features.merchants'),
              t('welcome.features.gifts'),
            ].map((line, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="text-[var(--muted)] shrink-0"><CheckIcon /></span>
                <span className="text-xs text-[var(--muted)] leading-relaxed">{line}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-px bg-[var(--border)]" />

        {/* TOS agreement */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setAgreed(v => !v)}
            className="flex items-start gap-3 text-left"
          >
            <div
              className="w-7 h-7 rounded-md shrink-0 border-2 flex items-center justify-center transition-all"
              style={{
                borderColor: agreed ? 'var(--text)' : 'var(--border)',
                background:   agreed ? 'var(--bg-elevated)' : 'transparent',
                color:        'var(--text)',
              }}
            >
              {agreed && <CheckIcon />}
            </div>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              {t('welcome.agreePrefix')}{' '}
              <button
                onClick={e => { e.stopPropagation(); setShowTos(true) }}
                className="text-[var(--text)] underline underline-offset-2 hover:text-[var(--text)] transition-colors"
              >
                {t('welcome.tos')}
              </button>
              {' '}{t('welcome.and')}{' '}
              <button
                onClick={e => { e.stopPropagation(); setShowPrivacy(true) }}
                className="text-[var(--text)] underline underline-offset-2 hover:text-[var(--text)] transition-colors"
              >
                {t('welcome.privacy')}
              </button>
              {t('welcome.experimentalNote')}
            </p>
          </button>

          <button
            onClick={handleGetStarted}
            disabled={!agreed || loading}
            className="w-full rounded-xl px-8 py-3.5 text-[11px] tracking-[0.2em] uppercase transition-all duration-300"
            style={{
              border:     '1px solid var(--border)',
              color:      agreed ? 'var(--text)' : 'var(--muted)',
              background: agreed ? 'var(--bg-elevated)' : 'transparent',
              cursor:     agreed && !loading ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? t('auth.settingUp') : t('welcome.getStarted')}
          </button>
        </div>


      </div>

      {showTos     && <TosSheet     onClose={() => setShowTos(false)}     />}
      {showPrivacy && <PrivacySheet onClose={() => setShowPrivacy(false)} />}
    </div>
  )
}
