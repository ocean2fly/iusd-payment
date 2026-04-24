/**
 * Register — new user account creation.
 *
 * Only reached if wallet is connected + session valid + no account yet.
 * After successful registration → navigate to /app.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthContext } from '../hooks/AuthContext'
import { registerAccount } from '../services/account'

// ─── Random nickname generator ────────────────────────────────────────────
const ADJECTIVES = ['swift','bold','quiet','wild','bright','cool','brave','sharp','lucky','dark','zen','lazy','happy','tiny','mighty','frozen','electric','golden','silver','cosmic']
const NOUNS      = ['fox','wolf','panda','eagle','tiger','shark','falcon','phoenix','dragon','turtle','rabbit','otter','whale','lynx','cobra','hawk','bear','raven','crane','lion']

function randomNickname(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const num  = Math.floor(Math.random() * 99) + 1
  return `${adj}${noun.charAt(0).toUpperCase() + noun.slice(1)}${num}`
}

export default function Register() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token, account, status } = useAuthContext()

  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already registered
  if (status === 'registered' || account) {
    navigate('/app', { replace: true })
    return null
  }
  // TOS not accepted — go back to welcome
  if (localStorage.getItem('ipay_tos_accepted') !== '1') {
    navigate('/app/welcome', { replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      await registerAccount(token, nickname.trim())
      // Show celebration page before going to dashboard
      navigate('/app/registered', { replace: true })
    } catch (e: any) {
      if (/ALREADY_REGISTERED/i.test(e.message)) {
        navigate('/app/registered', { replace: true })
        return
      }
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const valid = nickname.trim().length >= 1 && nickname.trim().length <= 12

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="w-full max-w-xs flex flex-col gap-8">

        <div className="flex flex-col items-center gap-2">
          <img src="/images/iusd.png?v=20260414" alt="iUSD" className="w-10 h-10 rounded-full opacity-90" />
          <h1 className="text-2xl font-light tracking-widest text-[var(--text)]">
            {t('register.title')}
          </h1>
          <p className="text-xs text-[var(--muted)] text-center">
            {t('register.chooseNickname')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] tracking-widest uppercase text-[var(--muted)]">
              {t('settings.account.nickname')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder={t('register.nicknamePlaceholder')}
                maxLength={12}
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 pr-12 text-[var(--text)] text-sm focus:outline-none focus:border-[var(--text)] placeholder:text-[var(--border)] transition-colors"
                autoFocus
              />
              {/* Dice / random button */}
              <button
                type="button"
                onClick={() => setNickname(randomNickname())}
                title={t('register.randomNickname')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--muted)] transition-colors text-base leading-none"
              >
                🎲
              </button>
            </div>
            <p className="text-[10px] text-[var(--muted)]">
              {t('register.nicknameHint')}
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={!valid || loading}
            className="w-full border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-elevated)] hover:border-[var(--text)] rounded-xl px-8 py-3.5 text-[11px] tracking-[0.2em] uppercase transition-all disabled:opacity-40"
          >
            {loading ? t('register.creating') : t('register.submit')}
          </button>
        </form>

      </div>
    </div>
  )
}
