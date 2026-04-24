/**
 * /install — PWA Install Guide
 * Detects iOS/Android and shows step-by-step installation instructions.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent)
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true
}

export default function InstallGuide() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const standalone = isStandalone()

  // Capture Android beforeinstallprompt
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  if (standalone) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t('installGuide.alreadyInstalled')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 24 }}>{t('installGuide.usingStandalone')}</div>
        <button onClick={() => navigate('/app')} style={{ padding: '12px 32px', borderRadius: 12, border: 'none', background: 'var(--text)', color: 'var(--surface)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {t('payLink.goToDashboard')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px', background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
        <img src="/images/iusd.png?v=20260414" alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.04em' }}>iUSD <span style={{ fontWeight: 400 }}>Pay</span></span>
      </div>

      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 24, textAlign: 'center' }}>
        {t('install.installTitle')}
      </div>

      {/* Android: native install prompt */}
      {isAndroid() && deferredPrompt && (
        <button onClick={handleInstall} style={{
          padding: '14px 40px', borderRadius: 14, border: 'none',
          background: 'var(--text)', color: 'var(--surface)',
          fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 24,
        }}>
          {t('installGuide.installApp')}
        </button>
      )}

      {/* iOS: step-by-step guide */}
      {isIOS() && (
        <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            { step: 1, icon: '📤', text: t('installGuide.ios.step1') },
            { step: 2, icon: '➕', text: t('installGuide.ios.step2') },
            { step: 3, icon: '✅', text: t('installGuide.ios.step3') },
          ].map(s => (
            <div key={s.step} style={{
              display: 'flex', gap: 12, alignItems: 'center',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '14px 16px',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: 'var(--text)', flexShrink: 0,
              }}>{s.step}</div>
              <div>
                <span style={{ fontSize: 20, marginRight: 8 }}>{s.icon}</span>
                <span style={{ fontSize: 13 }}>{s.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Android without prompt / Desktop */}
      {!isIOS() && !deferredPrompt && (
        <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '14px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13 }}>
              {isAndroid() ? t('installGuide.androidHint') : t('installGuide.desktopHint')}
            </div>
          </div>
        </div>
      )}

      {/* Close */}
      <button onClick={() => navigate('/')} style={{
        marginTop: 32, background: 'none', border: 'none', color: 'var(--muted)',
        fontSize: 12, cursor: 'pointer',
      }}>
        {t('installGuide.skip')}
      </button>
    </div>
  )
}
