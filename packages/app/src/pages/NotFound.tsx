/**
 * 404 Not Found — matches Landing page branding, supports light/dark mode
 */
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function NotFound() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tagline = t('landing.tagline')
  const [pre, post] = tagline.split('Initia')

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      {/* Pulsing rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-[300px] h-[300px] rounded-full border animate-pulse-ring" style={{ borderColor: 'var(--border)' }} />
        <div className="absolute w-[480px] h-[480px] rounded-full border animate-pulse-ring" style={{ borderColor: 'var(--border)', animationDelay: '1.5s' }} />
        <div className="absolute w-[660px] h-[660px] rounded-full border animate-pulse-ring" style={{ borderColor: 'var(--border)', animationDelay: '3s' }} />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-xs px-6 text-center">

        {/* Logo */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <img src="/images/iusd.png?v=20260414" alt="iUSD" className="w-10 h-10 rounded-full opacity-90" />
            <span className="text-4xl font-light tracking-[0.08em] whitespace-nowrap" style={{ color: 'var(--text)' }}>
              iUSD<span style={{ color: 'var(--muted)' }}> pay</span>
            </span>
          </div>
          <p className="text-[8px] tracking-[0.22em] uppercase" style={{ color: 'var(--muted)' }}>
            {pre}<span style={{ color: 'var(--text)' }}>Initia</span>{post ?? ''}
          </p>
        </div>

        {/* 404 */}
        <div className="flex flex-col items-center gap-2">
          <span className="font-light tracking-[0.12em]" style={{ fontSize: 72, lineHeight: 1, color: 'var(--border)' }}>
            404
          </span>
          <p className="text-sm tracking-[0.06em]" style={{ color: 'var(--muted)' }}>
            {t('notFound.title')}
          </p>
          <p className="text-[11px] tracking-wide leading-relaxed" style={{ color: 'var(--muted)' }}>
            {t('notFound.desc')}
          </p>
        </div>

        {/* Button */}
        <button
          onClick={() => navigate('/', { replace: true })}
          className="w-full text-[11px] tracking-[0.15em] uppercase transition-all duration-300"
          style={{ color: 'var(--muted)', padding: '10px 0', marginTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {t('verify.goHomepage')}
        </button>
      </div>
    </div>
  )
}
