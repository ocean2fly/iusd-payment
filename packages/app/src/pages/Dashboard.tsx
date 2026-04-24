import { Users, ArrowUpRight, ArrowDownLeft, Inbox, QrCode, Gift, Clock, Settings } from 'lucide-react'
import { SlideIn } from '../components/Skeleton'
/**
 * Dashboard — main authenticated view.
 *
 * Card at top with 3D flip:
 *  - Front: public face (nickname + seal + QR) — privacy mode
 *  - Back:  private face (balance + ID copy + flip icon) — default
 *
 * If navigated from /app/registered → auto-flip animation (front → back).
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthContext } from '../hooks/AuthContext'
import { useInboxBadge } from '../hooks/useInboxBadge'
import { FlippableCard } from '../components/FlippableCard'
import { IdentityCard } from '../components/IdentityCard'
import { IdentityCardBack, type GasData } from '../components/IdentityCardBack'
import { NicknameEditorModal } from '../components/NicknameEditorModal'
import DepositModal from '../components/DepositModal'
import { PromoBanner } from '../components/PromoBanner'
import { InstallTip } from '../components/InstallTip'
import { getBrowserEnvironment, canInstallPWA } from '../lib/browserDetection'

// ── Share button + social picker ─────────────────────────────────────────

export default function Dashboard() {
  const { t } = useTranslation()
  const { account, address, token } = useAuthContext()
  const { count: inboxCount } = useInboxBadge()

  // Custom deposit modal state
  const [depositModal, setDepositModal] = useState<{
    open: boolean; mode: 'deposit' | 'withdraw'; denom: string; chainId: string; label: string
  }>({ open: false, mode: 'deposit', denom: '', chainId: 'interwoven-1', label: '' })

  // Start on BACK (private) by default.
  // If coming from registration, start on FRONT then auto-flip to BACK.
  const nav = useNavigate()
  const location = useLocation()
  const fromReg  = (location.state as any)?.fromRegistration === true

  const [flipped,      setFlipped]      = useState(false)  // always start at front
  const [editNick,     setEditNick]     = useState(false)
  const [localAccount, setLocalAccount] = useState(account)
  const [gasOpen,      setGasOpen]      = useState(false)
  const [gasData,      setGasData]      = useState<GasData | null>(null)
  const [gasRefreshing, setGasRefreshing] = useState(false)
  const [showInstallTip, setShowInstallTip] = useState(false)
  const refreshRef = useRef<(() => void) | null>(null)

  // Auto-refresh balances when gas panel opens
  useEffect(() => {
    if (gasOpen) refreshRef.current?.()
  }, [gasOpen])

  // First-time entry from /app/registered: auto-flip to balance view once
  useEffect(() => {
    if (!fromReg) return
    const t = setTimeout(() => setFlipped(true), 900)
    return () => clearTimeout(t)
  }, [fromReg])

  if (!account) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, animationName: 'pulse' }}>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <SlideIn>
    <div style={{
      minHeight:      '100vh',
      background:     'var(--bg)',  // follows Settings theme (dark/light/auto)
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      padding:        '32px 16px 48px',
      gap:            28,
      overflowX:      'hidden',
      boxSizing:      'border-box',
    }}>


      {/* ── Flippable card + gas overlay ────────────────────────────── */}
      <div style={{ width: '100%', maxWidth: 360, position: 'relative', display: 'flex', justifyContent: 'center' }}>
      <FlippableCard flipped={flipped} width={Math.min(360, window.innerWidth - 32)} height={Math.round(Math.min(360, window.innerWidth - 32) * (227/360))}>
        {/* Front — public / privacy mode */}
        <div onClick={() => { setFlipped(true); setTimeout(() => refreshRef.current?.(), 100) }} style={{ cursor: 'pointer', position: 'relative' }}>
          <IdentityCard account={localAccount ?? account} status="active" />
          {/* Transparent nickname tap zone — only on front face */}
          {!flipped && (
            <div
              onClick={e => { e.stopPropagation(); setEditNick(true) }}
              title={t('dashboard.tapEditNickname')}
              style={{
                position: 'absolute', top: '32%', left: 0, right: '30%', height: '36%',
                cursor: 'pointer', zIndex: 10,
              }}
            />
          )}
          {/* Share entry removed — function kept, will be placed elsewhere */}
        </div>
        {/* Back — private / balance view */}
        <IdentityCardBack
          account={localAccount ?? account}
          address={address ?? ''}
          onFlip={() => setFlipped(false)}
          gasOpen={gasOpen}
          onGasToggle={() => setGasOpen(g => !g)}
          onGasData={setGasData}
          onDeposit={(mode, denom, label) => setDepositModal({ open: true, mode, denom, chainId: 'interwoven-1', label })}
          onRefreshRef={refreshRef}
        />
      </FlippableCard>
      {/* ── Gas dropdown — absolute overlay over action grid ──────── */}
      {gasOpen && gasData && flipped && (
        <>
          {/* Invisible full-screen backdrop — click to close */}
          <div onClick={() => setGasOpen(false)}
               style={{ position:'fixed', inset:0, zIndex:49 }} />
          <div style={{ position:'absolute', bottom:-8, right:0, zIndex:50, display:'flex', justifyContent:'flex-end' }}>
          <div style={{
            width:210, background:'var(--surface)', borderRadius:12, marginTop:-2,
            border:'1px solid var(--border)', padding:'12px 14px',
            boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
            display:'flex', flexDirection:'column', gap:10,
            animation:'gasPanelIn 0.18s cubic-bezier(0.34,1.2,0.64,1)',
          }}>
            <style>{`@keyframes gasPanelIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
            {/* INIT */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:10, color:'var(--muted)', width:36, letterSpacing:'0.08em', fontWeight:600 }}>INIT</span>
              <span style={{ fontSize:13, fontFamily:'monospace', flex:1,
                             color: gasData.initLow ? '#ef4444' : 'var(--text)' }}>
                {gasData.initBal}
              </span>
              <button onClick={() => setDepositModal({ open:true, mode:'deposit', denom:'uinit', chainId:'interwoven-1', label:'INIT' })}
                style={{ width:26, height:26, borderRadius:6, border:'1px solid var(--border)',
                         background:'var(--bg-elevated)', color:'var(--text)',
                         fontSize:16, fontWeight:700, cursor:'pointer', lineHeight:1,
                         display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            </div>
            {/* USDC */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:10, color:'var(--muted)', width:36, letterSpacing:'0.08em', fontWeight:600 }}>USDC</span>
              <span style={{ fontSize:13, fontFamily:'monospace', flex:1,
                             color: gasData.usdcLow ? '#ef4444' : 'var(--text)' }}>
                {gasData.usdcBal}
              </span>
              <button onClick={() => setDepositModal({ open:true, mode:'deposit', denom:'ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4', chainId:'interwoven-1', label:'USDC' })}
                style={{ width:26, height:26, borderRadius:6, border:'1px solid var(--border)',
                         background:'var(--bg-elevated)', color:'var(--text)',
                         fontSize:16, fontWeight:700, cursor:'pointer', lineHeight:1,
                         display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            </div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:-4 }}>
              <div style={{ fontSize:8, color:'var(--muted)', letterSpacing:'0.04em' }}>
                {t('dashboard.minGasHint')}
              </div>
              <button onClick={() => {
                  setGasRefreshing(true)
                  refreshRef.current?.()
                  setTimeout(() => setGasRefreshing(false), 1500)
                }}
                title={t('dashboard.refreshBalances')}
                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--muted)', padding:2, display:'flex' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  style={gasRefreshing ? { animation:'spin 1s linear infinite' } : {}}>
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        </>
      )}
            </div>


      {/* ── Promo Banner ──────────────────────────────────────────── */}
      <div style={{ width:'100%', maxWidth:360 }}>
        <PromoBanner />
      </div>

      {/* ── PWA install hint removed — now fixed at page bottom ──── */}

      {/* ── Quick actions 4×2 grid ──────────────────────────────────── */}
      <div style={{ width:'100%', maxWidth:360, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
        {([
          { icon: <ArrowUpRight size={20} strokeWidth={1.5}/>,   label:t('dashboard.actions.transfer'), id:'transfer',  route:'/app/transfer' },
          { icon: <ArrowDownLeft size={20} strokeWidth={1.5}/>,  label:t('dashboard.actions.request'),  id:'request',   route:'/app/request' },
          { icon: <Gift size={20} strokeWidth={1.5}/>,           label:t('dashboard.actions.gift'),     id:'gifts',     route:'/app/gift' },
          { icon: <Inbox size={20} strokeWidth={1.5}/>,          label:t('dashboard.actions.inbox'),    id:'inbox',     route:'/app/inbox', badge:true },
          { icon: <Users size={20} strokeWidth={1.5}/>,          label:t('dashboard.actions.contacts'), id:'contacts',  route:'/app/contacts' },
          { icon: <QrCode size={20} strokeWidth={1.5}/>,         label:t('dashboard.actions.scan'),     id:'scan',      route:'/app/scan' },
          { icon: <Clock size={20} strokeWidth={1.5}/>,          label:t('dashboard.actions.history'),  id:'history',   route:'/app/history' },
          { icon: <Settings size={20} strokeWidth={1.5}/>,       label:t('dashboard.actions.settings'), id:'settings',  route:'/app/settings' },
        ] as Array<{icon:React.ReactNode;label:string;id:string;route:string|null;badge?:boolean}>).map(item => (
          <div key={item.id}
            onClick={() => item.route && nav(item.route)}
            style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                     background:'var(--bg-elevated)', border:'1px solid var(--border)',
                     borderRadius:12, padding:'14px 4px', cursor: item.route ? 'pointer' : 'default',
                     position:'relative', opacity: item.route ? 1 : 0.4,
                     color: item.route ? 'var(--text)' : 'var(--muted)' }}>
            {item.icon}
            {item.badge && inboxCount > 0 && (
              <span style={{ position:'absolute', top:6, right:6, width:7, height:7,
                             borderRadius:'50%', background:'#ef4444' }}/>
            )}
            <span style={{ fontSize:8, color:'inherit', letterSpacing:'0.06em',
                           textAlign:'center', lineHeight:1.2 }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* ── Nickname editor modal ──────────────────────────────────── */}
      {editNick && (localAccount ?? account) && (
        <NicknameEditorModal
          account={localAccount ?? account}
          token={token}
          onSaved={updated => { setLocalAccount(updated); setEditNick(false) }}
          onClose={() => setEditNick(false)}
        />
      )}

      {/* ── Custom deposit/withdraw modal ─────────────────────────── */}
      <DepositModal
        open={depositModal.open}
        onClose={() => setDepositModal(s => ({ ...s, open: false }))}
        mode={depositModal.mode}
        denom={depositModal.denom}
        chainId={depositModal.chainId}
        label={depositModal.label}
      />

      {/* ── PWA install button (fixed bottom, mobile browser only) ── */}
      {(() => {
        const env = getBrowserEnvironment()
        if (env !== 'mobile-browser') return null
        if (!canInstallPWA()) return null  // iOS Chrome/Firefox/etc can't install — Apple restricts to Safari
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
        if (isStandalone) return null
        const dismissed = localStorage.getItem('ipay_install_dismissed')
        if (dismissed) return null
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        return (
          <div style={{ position: 'fixed', bottom: 20, left: 0, right: 0, textAlign: 'center', zIndex: 10 }}>
            <button onClick={() => setShowInstallTip(true)}
              style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', border: 'none', cursor: 'pointer',
                       fontSize: 12, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6,
                       padding: '10px 20px', borderRadius: 20 }}>
              {isIOS
                ? <span style={{ fontSize: 14 }}>{'\uF8FF'}</span>
                : <img src="https://cdn-icons-png.flaticon.com/128/160/160138.png" alt="" style={{ width: 16, height: 16 }} />}
              {t('landing.installAsApp')}
            </button>
          </div>
        )
      })()}
      {showInstallTip && <InstallTip onClose={() => { setShowInstallTip(false); localStorage.setItem('ipay_install_dismissed', '1') }} />}

    </div>
    </SlideIn>
  )
}
