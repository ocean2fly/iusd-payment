/**
 * InstallTip — Lightweight install guide overlay.
 * Detects browser and shows contextual "{t('install.addToHome')}" guidance.
 *
 * iOS Safari: bottom sheet with Share icon → {t('install.addToHome')}
 * iOS Chrome: top tooltip with ··· icon → {t('install.addToHome')}
 * Android: triggers beforeinstallprompt or shows ⋮ menu guide
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
function isChrome(): boolean {
  return /CriOS|Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent)
}
function isSafari(): boolean {
  return /Safari/.test(navigator.userAgent) && !/CriOS|Chrome|Edg/.test(navigator.userAgent)
}

interface Props {
  onClose: () => void
}

export function InstallTip({ onClose }: Props) {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const ios = isIOS()
  const safari = isSafari()
  const chrome = isChrome()

  // Android: capture beforeinstallprompt
  useEffect(() => {
    if (ios) return
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [ios])

  // Android: trigger native install
  async function handleAndroidInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    onClose()
  }

  // Share icon (iOS Safari)
  const ShareIcon = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  )

  // Plus icon
  const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: ios && safari ? 'flex-end' : 'flex-start',
      justifyContent: ios && safari ? 'center' : 'flex-end',
      padding: ios && safari ? '0 0 20px' : '60px 12px 0',
    }}>
      <style>{`
        @keyframes tipSlideUp { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes tipSlideDown { from{transform:translateY(-40px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes tipBounceUR { 0%,100%{transform:translate(0,0)} 50%{transform:translate(6px,-6px)} }
      `}</style>

      <div onClick={e => e.stopPropagation()} style={{
        width: ios && safari ? '90%' : undefined, maxWidth: 340,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '20px', boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
        animation: ios && safari ? 'tipSlideUp 0.3s ease-out' : 'tipSlideDown 0.3s ease-out',
        position: 'relative',
      }}>
        {/* iOS Safari — bottom sheet */}
        {ios && safari && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t('install.addToHome')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ color: '#007AFF' }}><ShareIcon /></div>
                <span style={{ fontSize: 9, color: 'var(--muted)' }}>{t('install.tapShare')}</span>
              </div>
              <span style={{ fontSize: 18, color: 'var(--muted)' }}>→</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <PlusIcon />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t('install.addToHome')}</span>
              </div>
            </div>
            {/* Arrow pointing down to Safari share button */}
            <div style={{ fontSize: 24, color: '#007AFF', animation: 'tipSlideUp 0.8s ease-in-out infinite alternate' }}>↓</div>
          </div>
        )}

        {/* iOS Chrome — top tooltip */}
        {ios && chrome && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', paddingTop: 4 }}>{t('install.addToHome')}</div>
              <div style={{ fontSize: 22, color: 'var(--muted)', animation: 'tipBounceUR 0.8s ease-in-out infinite' }}>↗</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 18, color: 'var(--text)' }}>···</span>
                <span style={{ fontSize: 9, color: 'var(--muted)' }}>{t('install.tapMenu')}</span>
              </div>
              <span style={{ fontSize: 18, color: 'var(--muted)' }}>→</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <PlusIcon />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t('install.addToHome')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Android */}
        {!ios && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {deferredPrompt ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t('install.installTitle')}</div>
                <button onClick={handleAndroidInstall} style={{
                  padding: '12px 32px', borderRadius: 12, border: 'none',
                  background: 'var(--text)', color: 'var(--surface)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}>{t('install.install')}</button>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', paddingTop: 4 }}>{t('install.addToHome')}</div>
                  <div style={{ fontSize: 22, color: 'var(--muted)', animation: 'tipBounceUR 0.8s ease-in-out infinite' }}>↗</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: 2 }}>⋮</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>{t('install.tapMenu')}</span>
                  </div>
                  <span style={{ fontSize: 18, color: 'var(--muted)' }}>→</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                    <PlusIcon />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t('install.addToHome')}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
