/**
 * Settings — /app/settings
 * V2: theme, disconnect, delete account, default claim address
 */
import { useState, useEffect } from 'react'
import { useSmartClose } from '../lib/navUtil'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { ikSign } from '../services/ikSigner'
import { useAuthContext } from '../hooks/AuthContext'
import { handleDisconnect } from '../hooks/useAuth'
import { TosContent, PrivacyContent } from '../components/LegalContent'
import { API_BASE } from '../config'
import { useConfig } from '../hooks/useConfig'
import { InstallTip } from '../components/InstallTip'
import { NicknameEditorModal } from '../components/NicknameEditorModal'
import {
  isMuted, setMuted, playTick,
  getTickStyle, setTickStyle, previewTick, TICK_STYLES, type TickStyle,
  getCardFlipStyle, setCardFlipStyle, previewCardFlip, CARD_FLIP_STYLES, type CardFlipStyle,
  getGiftStyle, setGiftStyle, previewGift, GIFT_STYLES, type GiftStyle,
  getTransactionStyle, setTransactionStyle, previewTransaction, TRANSACTION_STYLES, type TransactionStyle,
  getMenuStyle, setMenuStyle, previewMenu, MENU_STYLES, type MenuStyle,
} from '../lib/sound'
import { getBrowserEnvironment, canInstallPWA } from '../lib/browserDetection'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, setLocale, type LocaleCode } from '../i18n'


type ThemeMode = 'auto' | 'light' | 'dark'

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  if (mode === 'dark')  root.classList.add('dark')
  if (mode === 'light') root.classList.add('light')
  localStorage.setItem('ipay_theme', mode)
}

export function Settings() {
  const { t } = useTranslation()
  const smartClose = useSmartClose('/app')
  const { address, account, token, refreshAccount } = useAuthContext()
  const { disconnect, offlineSigner } = useInterwovenKit()
  const { config } = useConfig()

  const [theme, setTheme] = useState<ThemeMode>(() =>
    (localStorage.getItem('ipay_theme') as ThemeMode) || 'auto'
  )
  const [copied, setCopied] = useState(false)
  const [defaultClaim, setDefaultClaim] = useState<string | null>(null)
  const [savingClaim, setSavingClaim]   = useState(false)
  const [claimInput, setClaimInput]     = useState('')
  const [showDisconnect, setShowDisconnect] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const [legalModal, setLegalModal] = useState<'tos'|'privacy'|null>(null)
  const [privacyModal, setPrivacyModal] = useState(false)
  const [signingPrivacy, setSigningPrivacy] = useState(false)
  const [buildLabel, setBuildLabel] = useState('build: unknown')
  const [showInstallTip, setShowInstallTip] = useState(false)
  const [editNick, setEditNick] = useState(false)
  const [soundMuted, setSoundMuted] = useState(() => isMuted())
  const [soundStyle, setSoundStyle] = useState<TickStyle>(() => getTickStyle())
  const [cardFlipStyle, setCardFlipStyleState] = useState<CardFlipStyle>(() => getCardFlipStyle())
  const [giftStyle, setGiftStyleState] = useState<GiftStyle>(() => getGiftStyle())
  const [txnStyleState, setTxnStyleState] = useState<TransactionStyle>(() => getTransactionStyle())
  const [menuStyleState, setMenuStyleState] = useState<MenuStyle>(() => getMenuStyle())
  const [showStyleModal, setShowStyleModal] = useState(false)
  const [soundTab, setSoundTab] = useState<'click' | 'card' | 'gift' | 'txn' | 'menu'>('click')
  // autoClaimEnabled: from server (account.autoClaimEnabled), not localStorage
  const [autoClaimPref, setAutoClaimPref] = useState(() => !!account?.autoClaimEnabled)
  const [bioText,      setBioText]       = useState(() => account?.bio ?? '')
  const [bioSaving,    setBioSaving]     = useState(false)
  const [bioSaved,     setBioSaved]      = useState(false)
  useEffect(() => { setAutoClaimPref(!!account?.autoClaimEnabled) }, [account?.autoClaimEnabled])
  async function toggleAutoClaim() {
    const next = !autoClaimPref
    setAutoClaimPref(next)  // optimistic
    if (!token) return
    try {
      await fetch(`${API_BASE}/account/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body: JSON.stringify({ autoClaimEnabled: next }),
      })
      await refreshAccount()  // sync context so other pages see fresh value
    } catch {
      setAutoClaimPref(!next)  // revert on failure
    }
  }

  // Apply theme on mount + change
  useEffect(() => { applyTheme(theme) }, [theme])

  // Build id (from loaded script)
  useEffect(() => {
    const s = document.querySelector('script[src*="/assets/index-"]') as HTMLScriptElement | null
    const src = s?.src ?? ''
    const m = src.match(/index-([^./?]+)\.js(?:\?v=([^&]+))?/) 
    if (!m) return
    const hash = m[1]
    const v = m[2]
    setBuildLabel(`build: ${hash}${v ? ` · v=${v}` : ''}`)
  }, [])

  // Load default claim address
  useEffect(() => {
    if (!account) return
    setDefaultClaim(account.defaultClaimAddress ?? null)
  }, [account])

  async function handleLogout() {
    // 1. Actually disconnect the wallet provider FIRST so WalletConnect /
    //    InterwovenKit drops its relayer session and the dApp authorization
    //    is revoked on the wallet side.
    try { await disconnect?.() } catch {}

    // 2. Clear iPay's own session (token, viewing key, account cache)
    if (address) handleDisconnect(address)

    // 3. Nuke any third-party wallet state left in localStorage.
    //    WalletConnect v2, @interwoven-kit, wagmi, etc. all persist here.
    try {
      const keysToKill: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (
          k.startsWith('wc@')           ||   // WalletConnect v2
          k.startsWith('walletconnect') ||   // WalletConnect v1 legacy
          k.startsWith('@w3m')          ||   // Web3Modal
          k.startsWith('interwoven')    ||   // InterwovenKit
          k.startsWith('@interwoven')   ||
          k.startsWith('ik:')           ||
          k.startsWith('wagmi')         ||
          k === 'ipay_wc_wallet'        ||   // our own cached wc wallet name
          k === 'ipay2_return_path'
        ) {
          keysToKill.push(k)
        }
      }
      keysToKill.forEach(k => localStorage.removeItem(k))
      // Keep theme preference, but clear everything else session-scoped
      sessionStorage.clear()
    } catch {}

    // 4. Hard-reload to the landing page (ensures no stale React state
    //    and clears in-memory caches like contacts)
    window.location.href = '/'
  }

  function copyAddress() {
    if (!address) return
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  async function saveClaimAddress() {
    if (!token) return
    setSavingClaim(true)
    try {
      await fetch(`${API_BASE}/account/default-claim-address`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ address: claimInput.trim() || null }),
      })
      setDefaultClaim(claimInput.trim() || null)
      setPrivacyModal(false)
    } catch {}
    setSavingClaim(false)
  }

  const shortAddr = address ? `${address.slice(0,10)}…${address.slice(-6)}` : '—'
  const shortId   = account?.shortId ?? '—'

  const chainId = config?.chainId ?? 'interwoven-1'
  const contractBech32 = config?.contract?.addressBech32 ?? ''
  const contractHex = (config?.contract as any)?.moduleAddress ?? config?.contract?.address ?? ''
  const explorerBase = `https://scan.initia.xyz/${chainId}`
  const contractDisplay = contractBech32
    ? `${contractBech32.slice(0,8)}…${contractBech32.slice(-4)}`
    : contractHex
      ? `${contractHex.slice(0,8)}…${contractHex.slice(-4)}`
      : '—'
  const contractHref = contractBech32
    ? `${explorerBase}/accounts/${contractBech32}/modules`
    : contractHex
      ? `${explorerBase}/accounts/${contractHex}/modules`
      : '#'

  return (
    <>
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 16px 100px', gap: 16, boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12,
                    borderBottom: '1px solid var(--border)' }}>
        <button onClick={smartClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 18, padding: '0 4px 0 0', lineHeight: 1 }}>
          ←
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text)' }}>{t('settings.title')}</span>
      </div>

      {/* Account card */}
      <div style={card}>
        <div style={sectionLabel}>{t('settings.account.title')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Nickname — click to edit */}
          <div onClick={() => setEditNick(true)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.account.nickname')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {account?.nickname || <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{t('settings.account.setNickname')}</span>}
              </span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)' }}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </span>
          </div>
          {/* Bio / Slogan */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:12, color:'var(--muted)' }}>{t('settings.account.bio')}</span>
              <button
                onClick={async () => {
                  setBioSaving(true)
                  await fetch(`${API_BASE}/account/preferences`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ bio: bioText }),
                  }).catch(() => {})
                  setBioSaving(false); setBioSaved(true)
                  setTimeout(() => setBioSaved(false), 2000)
                  refreshAccount?.()
                }}
                disabled={bioSaving}
                style={{ fontSize:11, color: bioSaved ? '#22c55e' : 'var(--muted)', background:'none',
                         border:'none', cursor:'pointer', padding:0, fontWeight:600 }}>
                {bioSaving ? t('common.saving') : bioSaved ? `✓ ${t('common.saved')}` : t('common.save')}
              </button>
            </div>
            <textarea
              value={bioText}
              onChange={e => setBioText(e.target.value.slice(0, 120))}
              placeholder={t('settings.account.bioPlaceholder')}
              rows={2}
              style={{ width:'100%', boxSizing:'border-box', background:'var(--bg)',
                       border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px',
                       fontSize:12, color:'var(--text)', resize:'none', fontFamily:'inherit',
                       outline:'none', lineHeight:1.4 }}
            />
            <div style={{ fontSize:10, color:'var(--muted)', textAlign:'right', marginTop:2 }}>
              {bioText.length}/120
            </div>
          </div>

          {/* Short ID */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.account.id')}</span>
            <button onClick={() => {
                navigator.clipboard.writeText(account?.shortId ?? '')
                setIdCopied(true); setTimeout(() => setIdCopied(false), 1500)
              }}
              style={{ fontFamily: 'monospace', fontSize: 11, color: idCopied ? '#4ade80' : 'var(--text)', background: 'var(--bg-elevated)',
                       border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', display:'flex', alignItems:'center', gap:5 }}>
              {shortId ? `${shortId.slice(0,4)} *** [${shortId.slice(-4)}]` : '—'}
              {idCopied ? ' ✓' : ''}
            </button>
          </div>
          {/* Wallet address */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.account.wallet')}</span>
            <button onClick={copyAddress}
              style={{ fontFamily: 'monospace', fontSize: 12, color: copied ? '#22c55e' : 'var(--text-secondary)',
                       background: 'var(--bg-elevated)', border: 'none', borderRadius: 6,
                       padding: '3px 8px', cursor: 'pointer' }}>
              {copied ? `✓ ${t('settings.account.copied')}` : shortAddr}
            </button>
          </div>
          {/* Ecosystem link */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.account.ecosystem')}</span>
            <a href="https://app.initia.xyz/" target="_blank" rel="noreferrer"
               style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.10em',
                        background: 'var(--text)', color: 'var(--bg)', padding: '2px 8px', borderRadius: 4,
                        textDecoration: 'none' }}>
              INITIA ↗
            </a>
          </div>
        </div>
        {/* Auto-Claim row */}
        <div style={{ ...row, paddingTop:12, borderTop:'1px solid var(--border)', marginTop:4 }}>
          <span style={rowLabel}>{t('settings.account.autoClaim')}</span>
          <button onClick={toggleAutoClaim}
            style={{ width:44, height:24, borderRadius:12, border:'none', cursor:'pointer',
                     background: autoClaimPref ? '#22c55e' : 'var(--border)',
                     position:'relative', transition:'background 0.2s', flexShrink:0 }}>
            <div style={{ width:18, height:18, borderRadius:'50%', background:'white',
                          position:'absolute', top:3, transition:'left 0.2s',
                          left: autoClaimPref ? 23 : 3,
                          boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }}/>
          </button>
        </div>
      </div>

      {/* Appearance — single row, theme toggles right-aligned */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={sectionLabel}>{t('settings.appearance.title')}</div>
          <div style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden',
                        border: '1px solid var(--border)' }}>
            {(['auto','light','dark'] as ThemeMode[]).map((m, i) => (
              <button key={m} onClick={() => setTheme(m)}
                style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 500, cursor: 'pointer', border: 'none',
                  borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                  background: theme === m ? 'var(--text)' : 'transparent',
                  color: theme === m ? 'var(--surface)' : 'var(--muted)',
                  transition: 'background 0.15s',
                }}>
                {m === 'auto' ? t('settings.appearance.auto') : m === 'light' ? t('settings.appearance.light') : t('settings.appearance.dark')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Language — native <select> so the list of 19 fits nicely on mobile */}
      <LanguageCard />

      {/* Sound — master mute toggle + style picker */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={sectionLabel}>{t('settings.sound.title')}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
              {t('settings.sound.desc')}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span style={{ fontSize: 11, color: soundMuted ? 'var(--muted)' : 'var(--text)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {soundMuted ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                  </svg>
                  {t('settings.sound.muted')}
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                  </svg>
                  {t('settings.sound.on')}
                </>
              )}
            </span>
            <div
              data-no-sound="true"
              onClick={() => {
                const next = !soundMuted
                setMuted(next)
                setSoundMuted(next)
                if (!next) setTimeout(playTick, 60)  // brief confirmation
              }}
              style={{
                width: 40, height: 22, borderRadius: 11, position: 'relative',
                background: soundMuted ? 'var(--border)' : '#22c55e',
                transition: 'background 0.2s', cursor: 'pointer',
              }}>
              <div style={{
                position: 'absolute', top: 2, left: soundMuted ? 2 : 20,
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </div>
          </label>
        </div>

        {/* Sound Styles — compact trigger opens tabbed modal */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      opacity: soundMuted ? 0.5 : 1 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('settings.sound.styles')}</div>
          <button
            onClick={() => setShowStyleModal(true)}
            style={{
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 11, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {t('settings.sound.customize')}
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>▸</span>
          </button>
        </div>
      </div>

      {/* Sound Styles modal — tabbed per category */}
      {showStyleModal && (() => {
        const tabs = [
          { id: 'click' as const, label: t('settings.sound.cat.click'),       styles: TICK_STYLES,        current: soundStyle,    setCurrent: (s: any) => { setTickStyle(s); setSoundStyle(s); previewTick(s) } },
          { id: 'card'  as const, label: t('settings.sound.cat.cardFlip'),    styles: CARD_FLIP_STYLES,   current: cardFlipStyle, setCurrent: (s: any) => { setCardFlipStyle(s); setCardFlipStyleState(s); previewCardFlip(s) } },
          { id: 'gift'  as const, label: t('settings.sound.cat.gift'),        styles: GIFT_STYLES,        current: giftStyle,     setCurrent: (s: any) => { setGiftStyle(s); setGiftStyleState(s); previewGift(s) } },
          { id: 'txn'   as const, label: t('settings.sound.cat.transaction'), styles: TRANSACTION_STYLES, current: txnStyleState, setCurrent: (s: any) => { setTransactionStyle(s); setTxnStyleState(s); previewTransaction(s) } },
          { id: 'menu'  as const, label: t('settings.sound.cat.menu'),        styles: MENU_STYLES,        current: menuStyleState, setCurrent: (s: any) => { setMenuStyle(s); setMenuStyleState(s); previewMenu(s) } },
        ]
        const tab = tabs.find(t => t.id === soundTab) ?? tabs[0]
        return (
          <div onClick={() => setShowStyleModal(false)} style={{
            position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: 'var(--surface)', borderRadius: 16, padding: 20,
              maxWidth: 420, width: '100%', maxHeight: '85vh', overflowY: 'auto',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
                              color: 'var(--text)', textTransform: 'uppercase' }}>
                  {t('settings.sound.styles')}
                </div>
                <button onClick={() => setShowStyleModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           color: 'var(--muted)', fontSize: 18 }}>✕</button>
              </div>
              {/* Category tabs */}
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginBottom: 14,
                            paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
                {tabs.map(t => {
                  const active = t.id === soundTab
                  return (
                    <button key={t.id}
                      data-no-sound="true"
                      onClick={() => setSoundTab(t.id)}
                      style={{
                        padding: '6px 12px', fontSize: 11, fontWeight: 700,
                        border: 'none', background: 'transparent',
                        color: active ? 'var(--text)' : 'var(--muted)',
                        borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
                        cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -5,
                      }}>
                      {t.label}
                    </button>
                  )
                })}
              </div>
              {/* Style options for current tab */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {tab.styles.map((s: any) => {
                  const active = tab.current === s.id
                  return (
                    <button key={s.id}
                      data-no-sound="true"
                      onClick={() => tab.setCurrent(s.id)}
                      style={{
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        background: active ? 'var(--text)' : 'var(--bg-elevated)',
                        color: active ? 'var(--surface)' : 'var(--text)',
                        border: `1px solid ${active ? 'var(--text)' : 'var(--border)'}`,
                        transition: 'all 0.15s',
                      }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        {active && '✓ '}{t(`soundStyles.${tab.id}.${s.id}.name`, { defaultValue: s.name })}
                      </div>
                      <div style={{ fontSize: 9, opacity: active ? 0.75 : 0.55, marginTop: 2 }}>
                        {t(`soundStyles.${tab.id}.${s.id}.desc`, { defaultValue: s.desc })}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
                {soundMuted ? t('settings.sound.unmutePreview') : t('settings.sound.tapPreview')}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Default Claim Address — compact row, full info in modal */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={sectionLabel}>{t('settings.receive.title')}</div>
          <span style={{ fontSize:9, color:'var(--muted)' }}>{t('settings.receive.privacyProtection')}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8,
                      background:'var(--bg-elevated)', borderRadius:10, padding:'10px 12px' }}>
          <span style={{ flex:1, fontFamily:'monospace', fontSize:11, color:'var(--text-secondary)' }}>
            {defaultClaim
              ? `${defaultClaim.slice(0,12)}…${defaultClaim.slice(-6)}`
              : t('settings.receive.defaultWallet')}
          </span>
          <button onClick={() => { setClaimInput(defaultClaim ?? ''); setPrivacyModal(true) }}
            style={{ ...btnFill, padding:'5px 12px', fontSize:10 }}>
            {t('settings.receive.change')}
          </button>
        </div>
      </div>

      {/* Privacy Modal */}
      {privacyModal && (
        <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center',
                      justifyContent:'center', background:'rgba(0,0,0,0.5)',
                      backdropFilter:'blur(4px)', padding:'20px' }}
          onClick={e => { if (e.target === e.currentTarget) setPrivacyModal(false) }}>
          <div style={{ background:'var(--surface)', borderRadius:20, padding:'24px',
                        maxWidth:400, width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:'0.14em',
                          color:'var(--muted)', marginBottom:12 }}>🔒 PRIVACY</div>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8, lineHeight:1.4 }}>
              {t('settings.receive.modalTitle')}
            </div>
            <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.6, marginBottom:12 }}>
              {t('settings.receive.modalDesc')}
            </div>
            <div style={{ fontSize:11, color:'#f59e0b', fontWeight:600, marginBottom:4 }}>
              {t('settings.receive.complianceHeader')}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', lineHeight:1.5, marginBottom:16 }}>
              {t('settings.receive.complianceDesc')}
            </div>
            {/* Address input */}
            <input value={claimInput} onChange={e => setClaimInput(e.target.value)}
              placeholder={t('settings.receive.placeholder')}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box',
                       marginBottom:12, fontSize:12 }} />
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => { setPrivacyModal(false); setPrivacyModal(false) }}
                style={{ ...btnOutline, flex:1, padding:'10px' }}>{t('common.cancel')}</button>
              <button
                disabled={savingClaim || signingPrivacy || claimInput.trim() === (defaultClaim ?? '').trim()}
                onClick={async () => {
                  if (!address || !token) return
                  setSigningPrivacy(true)
                  try {
                    // Require wallet signature as confirmation
                    const msg = `iPay: I consent to set my receive address to: ${claimInput || 'my connected wallet'}. I understand this change is logged for compliance.`
                    let sig: string | null = null
                    try {
                      sig = await ikSign(offlineSigner, msg)
                    } catch (e: any) {
                      throw new Error(e.message ?? 'Signature cancelled')
                    }
                    if (!sig) throw new Error('Signature required')
                    // Apply the change
                    setPrivacyModal(false)
                    setSavingClaim(true)
                    await saveClaimAddress()
                  } catch (e: any) {
                    alert(e.message)
                  } finally {
                    setSigningPrivacy(false)
                    setSavingClaim(false)
                  }
                }}
                style={{ ...btnFill, flex:2, padding:'10px',
                         opacity: savingClaim || signingPrivacy ? 0.6 : 1 }}>
                {signingPrivacy ? `✍️ ${t('settings.receive.signing')}` : savingClaim ? t('common.saving') : `✍️ ${t('settings.receive.signSave')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About */}
      <div style={card}>
        <div style={sectionLabel}>{t('settings.about.title')}</div>
        {/* Version */}
        <div style={row}>
          <span style={rowLabel}>{t('settings.about.iusdPay')}</span>
          <span style={rowVal}>v2.0.0</span>
        </div>
        {/* Network */}
        <div style={{ ...row, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <span style={rowLabel}>{t('settings.about.network')}</span>
          <a href={explorerBase} target="_blank" rel="noreferrer"
            style={{ ...linkSt }}>
            {chainId} ↗
          </a>
        </div>
        {/* Contract */}
        <div style={{ ...row, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <span style={rowLabel}>{t('settings.about.contract')}</span>
          <a href={contractHref}
            target="_blank" rel="noreferrer" style={{ ...linkSt, fontFamily: 'monospace', fontSize: 10 }}>
            {contractDisplay} <span style={{ fontSize: 11 }}>↗</span>
          </a>
        </div>
        {/* TOS */}
        <div style={{ ...row, paddingTop: 10, borderTop: '1px solid var(--border)', cursor:'pointer' }}
             onClick={() => setLegalModal('tos')}>
          <span style={rowLabel}>{t('settings.about.tos')}</span>
          <span style={linkSt}>{t('common.view')} ↗</span>
        </div>
        {/* Privacy Policy */}
        <div style={{ ...row, paddingTop: 10, borderTop: '1px solid var(--border)', cursor:'pointer' }}
             onClick={() => setLegalModal('privacy')}>
          <span style={rowLabel}>{t('settings.about.privacy')}</span>
          <span style={linkSt}>{t('common.view')} ↗</span>
        </div>
        {/* Community — Discord + X */}
        <div style={{ ...row, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <span style={rowLabel}>{t('settings.about.community')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <a href="https://discord.gg/kKFd4nya" target="_blank" rel="noopener noreferrer"
               title="Discord" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4c-.06 0-.12.03-.15.09-.19.33-.39.76-.54 1.12-1.62-.24-3.24-.24-4.84 0-.15-.37-.36-.8-.54-1.12-.03-.06-.09-.09-.15-.09-1.5.26-2.93.71-4.27 1.33-.03 0-.05.03-.07.05C2.2 9.36 1.56 13.29 1.88 17.18c0 .04.03.07.06.1 1.78 1.29 3.51 2.07 5.21 2.59.06.02.12 0 .15-.05.4-.55.76-1.13 1.07-1.74.02-.05-.01-.1-.06-.12-.57-.21-1.11-.47-1.64-.77-.05-.03-.05-.1-.01-.13.11-.08.22-.17.33-.25.02-.02.06-.02.08-.01 3.44 1.57 7.16 1.57 10.55 0 .03-.01.06-.01.08.01.11.08.22.17.33.25.04.03.04.1-.02.13-.52.3-1.07.56-1.64.77-.05.02-.07.08-.06.12.32.61.68 1.19 1.07 1.74.03.05.09.07.15.05 1.7-.52 3.43-1.3 5.22-2.59.03-.02.05-.05.06-.09.37-4.5-.64-8.41-2.69-12.02-.01-.03-.03-.05-.06-.06zM8.52 14.85c-1.03 0-1.88-.95-1.88-2.12s.84-2.12 1.88-2.12c1.05 0 1.89.96 1.88 2.12 0 1.17-.84 2.12-1.88 2.12zm6.97 0c-1.03 0-1.88-.95-1.88-2.12s.84-2.12 1.88-2.12c1.05 0 1.89.96 1.88 2.12 0 1.17-.83 2.12-1.88 2.12z"/>
              </svg>
            </a>
            <a href="https://x.com/iusdpay" target="_blank" rel="noopener noreferrer"
               title="X (Twitter)" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
          </div>
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{buildLabel}</span>
          <button onClick={() => {
              // Force refresh only clears app-level cache (feature flags, chunk
              // reload guard, visit counts, install dismiss, etc.) — NEVER
              // touches wallet session or viewing keys. Use "Disconnect Wallet"
              // for a real wallet signout.
              const preserved: Record<string, string | null> = {}
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i)
                  if (!k) continue
                  // Keep: theme, iPay session tokens, viewing keys, all wallet
                  // connector state (IK / WalletConnect / wagmi / web3modal)
                  if (
                    k === 'ipay_theme'             ||
                    k === 'ipay_tos_accepted'      ||
                    k.startsWith('ipay2_session_') ||
                    k.startsWith('ipay2_vk_')      ||
                    k.startsWith('ipay_session_')  ||  // v1 legacy
                    k.startsWith('ipay_vk_')       ||
                    k.startsWith('ipay_account_')  ||
                    k.startsWith('wc@')            ||
                    k.startsWith('walletconnect')  ||
                    k.startsWith('@w3m')           ||
                    k.startsWith('interwoven')     ||
                    k.startsWith('@interwoven')    ||
                    k.startsWith('ik:')            ||
                    k.startsWith('wagmi')          ||
                    k === 'ipay_wc_wallet'
                  ) {
                    preserved[k] = localStorage.getItem(k)
                  }
                }
                localStorage.clear()
                sessionStorage.clear()
                Object.entries(preserved).forEach(([k, v]) => {
                  if (v !== null) localStorage.setItem(k, v)
                })
              } catch {}
              // Cache-bust via query param so CDN serves the newest index.html
              window.location.href = window.location.origin + '/?v=' + Date.now()
            }}
            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)',
                     background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
            {t('settings.about.forceRefresh')}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div style={{ ...card, border: '1px solid rgba(239,68,68,0.25)' }}>
        <div style={{ ...sectionLabel, color: '#ef4444' }}>{t('settings.danger.title')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => setShowDisconnect(true)}
            style={{ ...btnOutline, color: 'var(--text)', justifyContent: 'center' }}>
            {t('settings.danger.disconnect')}
          </button>
          <DeleteAccountButton token={token} onDeleted={() => { window.location.href = '/' }} />
        </div>
      </div>

      {/* Install App link (mobile browser only, not wallet browser, PWA-install-capable) */}
      {(() => {
        const env = getBrowserEnvironment()
        if (env !== 'mobile-browser') return null
        if (!canInstallPWA()) return null  // iOS Chrome/Firefox/etc can't install — Apple restricts to Safari
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
        if (isStandalone) return null
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        return (
          <div style={{ ...card, cursor: 'pointer' }} onClick={() => setShowInstallTip(true)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isIOS
                  ? <span style={{ fontSize: 16 }}>{'\uF8FF'}</span>
                  : <img src="https://cdn-icons-png.flaticon.com/128/160/160138.png" alt="" style={{ width: 16, height: 16 }} />}
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t('landing.installAsApp')}</span>
              </div>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>→</span>
            </div>
          </div>
        )
      })()}
      {showInstallTip && <InstallTip onClose={() => setShowInstallTip(false)} />}
      {editNick && account && (
        <NicknameEditorModal
          account={account}
          token={token}
          onSaved={() => { setEditNick(false); refreshAccount?.() }}
          onClose={() => setEditNick(false)}
        />
      )}

      {/* Disconnect confirm */}
      {showDisconnect && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🔌</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t('settings.danger.disconnectTitle')}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{t('settings.danger.disconnectDesc')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowDisconnect(false)} style={{ ...btnOutline, flex: 1, justifyContent: 'center' }}>{t('common.cancel')}</button>
              <button onClick={handleLogout}
                style={{ flex: 1, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                         background: '#ef4444', color: 'white', fontSize: 12, fontWeight: 600 }}>
                {t('settings.danger.disconnect')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    {/* ── Legal modal ─────────────────────────────────────────────── */}
      {legalModal && (
        <div onClick={() => setLegalModal(null)} style={{
          position:'fixed', inset:0, zIndex:300, background:'rgba(0,0,0,0.65)',
          backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:'var(--surface)', borderRadius:16, padding:'24px 20px',
            width:'90%', maxWidth:480, maxHeight:'80vh', overflowY:'auto',
            boxShadow:'0 24px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <span style={{ fontSize:13, fontWeight:700, letterSpacing:'0.12em', color:'var(--text)', textTransform:'uppercase' }}>
                {legalModal === 'tos' ? t('settings.about.tos') : t('settings.about.privacy')}
              </span>
              <button onClick={() => setLegalModal(null)}
                style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--muted)', padding:4 }}>✕</button>
            </div>
            <div style={{ fontSize:12, lineHeight:1.7, color:'var(--muted)' }} className="flex flex-col gap-4">
              {legalModal === 'tos' ? <TosContent /> : <PrivacyContent />}
            </div>
          </div>
        </div>
      )}
    </>
  )
}


// ── Inline DeleteAccountButton ───────────────────────────────────────────────
function DeleteAccountButton({ token, onDeleted }: { token: string | null; onDeleted: () => void }) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading]       = useState(false)


  async function doDelete() {
    if (!token) return
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/account/me`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error('Failed')
      onDeleted()
    } catch { setLoading(false) }
  }

  if (confirming) return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:11, color:'#ef4444', textAlign:'center' }}>
        {t('settings.danger.deleteConfirmWarn')}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={()=>setConfirming(false)} style={{ ...btnOutline, flex:1, justifyContent:'center' }}>{t('common.cancel')}</button>
        <button onClick={doDelete} disabled={loading}
          style={{ flex:1, padding:'9px', borderRadius:10, border:'none', cursor:'pointer',
                   background:'#ef4444', color:'white', fontSize:12, fontWeight:600 }}>
          {loading ? t('settings.danger.deleting') : t('settings.danger.confirmDelete')}
        </button>
      </div>
    </div>
  )
  return (
    <button onClick={()=>setConfirming(true)}
      style={{ ...btnOutline, justifyContent:'center', color:'#ef4444', borderColor:'rgba(239,68,68,0.4)' }}>
      {t('settings.danger.delete')}
    </button>
  )
}

// ── Language picker — native <select> for compact mobile UI ────────────────
function LanguageCard() {
  const { t, i18n } = useTranslation()
  const currentCode = SUPPORTED_LOCALES.find(l => l.code === i18n.language)?.code
    ?? SUPPORTED_LOCALES.find(l => i18n.language?.startsWith(l.code))?.code
    ?? 'en'
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={sectionLabel}>{t('common.language')}</div>
        <select
          value={currentCode}
          onChange={e => setLocale(e.target.value as LocaleCode)}
          data-no-sound="true"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
            minWidth: 140,
          }}
        >
          {SUPPORTED_LOCALES.map(l => (
            <option key={l.code} value={l.code}>
              {l.native}{l.code !== 'en' ? ` — ${l.name}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Shared inline styles ────────────────────────────────────────────────────
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11,
}
const rowLabel: React.CSSProperties = { color: 'var(--muted)' }
const rowVal:   React.CSSProperties = { color: 'var(--text)', fontWeight: 500 }
const linkSt:   React.CSSProperties = {
  color: 'var(--text)', textDecoration: 'none', fontSize: 11, fontWeight: 500,
}

const card: React.CSSProperties = {
  width: '100%', maxWidth: 480, background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px',
  display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box',
}
const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--muted)',
}
const inputSt: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '9px 12px', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none',
}
const btnFill: React.CSSProperties = {
  background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 10,
  padding: '9px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const btnOutline: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', borderRadius: 10,
  padding: '9px 16px', fontSize: 12, color: 'var(--muted)', cursor: 'pointer',
  display: 'flex', alignItems: 'center',
}
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24,
}
const modal: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
  padding: '24px', width: '100%', maxWidth: 320,
}
