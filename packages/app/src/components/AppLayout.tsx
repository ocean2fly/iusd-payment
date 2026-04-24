/**
 * AppLayout — Persistent sidebar (desktop) or bottom nav (mobile)
 * Wrap all /app/* pages with this to keep navigation visible.
 */
import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users, ArrowUpRight, Home, ArrowDownLeft, Inbox, QrCode,
         Gift, Clock, Settings, MoreHorizontal, X } from 'lucide-react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { handleDisconnect } from '../hooks/useAuth'
import { useInboxBadge } from '../hooks/useInboxBadge'
import { PullToRefresh } from './PullToRefresh'
import React from 'react'

interface Props {
  children: React.ReactNode
}

export function AppLayout({ children }: Props) {
  const { t } = useTranslation()
  const nav      = useNavigate()
  const location = useLocation()
  const { address, disconnect } = useInterwovenKit()
  const { count: inboxCount } = useInboxBadge()

  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 640)
  const [showMore, setShowMore] = useState(false)
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const NAV_ITEMS = [
    { icon: <Home size={16} strokeWidth={1.5}/>,          label: t('nav.dashboard'),           route: '/app' },
    { icon: <ArrowUpRight size={16} strokeWidth={1.5}/>,  label: t('dashboard.actions.transfer'), route: '/app/transfer' },
    { icon: <ArrowDownLeft size={16} strokeWidth={1.5}/>, label: t('dashboard.actions.request'),  route: '/app/request' },
    { icon: <Gift size={16} strokeWidth={1.5}/>,          label: t('dashboard.actions.gift'),     route: '/app/gift' },
    { icon: <Inbox size={16} strokeWidth={1.5}/>,         label: t('dashboard.actions.inbox'),    route: '/app/inbox',      badge: true },
    { icon: <QrCode size={16} strokeWidth={1.5}/>,        label: t('dashboard.actions.scan'),     route: '/app/scan' },
    { icon: <Users size={16} strokeWidth={1.5}/>,         label: t('dashboard.actions.contacts'), route: '/app/contacts' },
    { icon: <Clock size={16} strokeWidth={1.5}/>,         label: t('dashboard.actions.history'),  route: '/app/history' },
    { icon: <Settings size={16} strokeWidth={1.5}/>,      label: t('dashboard.actions.settings'), route: '/app/settings' },
  ] as const

  function handleLogout() {
    if (address) handleDisconnect(address)
    window.location.href = '/'
    setTimeout(() => disconnect?.(), 100)
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <PullToRefresh />
      {/* ── Desktop Sidebar ───────────────────────────────────── */}
      {isDesktop && (
        <nav style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 200, zIndex: 50,
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
          backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column',
          padding: '24px 12px 24px',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28, padding: '0 8px' }}>
            <img src="/images/iusd.png?v=20260414" style={{ width: 22, height: 22, borderRadius: '50%' }} alt="iUSD Pay" />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>iUSD <span style={{ fontWeight: 400 }}>Pay</span></span>
          </div>

          {/* Nav items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            {NAV_ITEMS.map(item => {
              const active = item.route ? location.pathname === item.route || (item.route !== '/app' && location.pathname.startsWith(item.route)) : false
              return (
                <button key={item.label}
                  onClick={() => item.route && nav(item.route)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
                    borderRadius: 9, border: 'none',
                    cursor: item.route ? 'pointer' : 'default',
                    background: active ? 'var(--bg-elevated)' : 'transparent',
                    color: item.route ? (active ? 'var(--text)' : 'var(--text)') : 'var(--muted)',
                    opacity: item.route ? 1 : 0.4,
                    fontSize: 12, fontWeight: active ? 600 : 400,
                    letterSpacing: '0.02em', textAlign: 'left',
                    transition: 'background 0.15s',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { if (item.route) (e.currentTarget as HTMLButtonElement).style.background = active ? 'var(--bg-elevated)' : 'rgba(128,128,128,0.08)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = active ? 'var(--bg-elevated)' : 'transparent' }}
                >
                  {item.icon}
                  {item.label}
                  {(item as any).badge && inboxCount > 0 && (
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444',
                                   position: 'absolute', top: 8, left: 22 }}/>
                  )}
                </button>
              )
            })}
          </div>

          {/* Bottom: Disconnect / Refresh */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 16,
                        borderTop: '1px solid var(--border)' }}>
            <button onClick={() => { localStorage.removeItem('ipay2_auth_refreshed'); window.location.reload() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '7px 10px',
                       borderRadius: 8, fontSize: 10, color: 'var(--muted)', letterSpacing: '0.12em',
                       textAlign: 'left' }}>
              {t('settings.about.forceRefresh')}
            </button>
            <button onClick={handleLogout}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '7px 10px',
                       borderRadius: 8, fontSize: 10, color: 'var(--muted)', letterSpacing: '0.12em',
                       textAlign: 'left' }}>
              {t('settings.danger.disconnect')}
            </button>
          </div>
        </nav>
      )}

      {/* ── Main content ──────────────────────────────────────── */}
      <div style={{
        flex: 1,
        marginLeft: isDesktop ? 200 : 0,
        paddingBottom: isDesktop ? 0 : 60,
        minHeight: '100vh',
        maxWidth: '100%',
        overflow: 'hidden',
      }}>
        {children}
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      {!isDesktop && (
        <>
          {/* More menu overlay */}
          {showMore && (
            <div onClick={() => setShowMore(false)} style={{
              position: 'fixed', inset: 0, zIndex: 55,
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
            }}>
              <div onClick={e => e.stopPropagation()} style={{
                position: 'absolute', bottom: 68, right: 8,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '8px 0', minWidth: 180,
                boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
              }}>
                {/* Items not in bottom bar */}
                {[
                  { icon: <Inbox size={16} strokeWidth={1.5}/>,         label: t('dashboard.actions.inbox'),    route: '/app/inbox', badge: true },
                  { icon: <ArrowDownLeft size={16} strokeWidth={1.5}/>, label: t('dashboard.actions.request'),  route: '/app/request' },
                  { icon: <Users size={16} strokeWidth={1.5}/>,         label: t('dashboard.actions.contacts'), route: '/app/contacts' },
                  { icon: <Clock size={16} strokeWidth={1.5}/>,         label: t('dashboard.actions.history'),  route: '/app/history' },
                  { icon: <Settings size={16} strokeWidth={1.5}/>,      label: t('dashboard.actions.settings'), route: '/app/settings' },
                ].map(item => {
                  const active = location.pathname === item.route || location.pathname.startsWith(item.route + '/')
                  return (
                    <button key={item.label}
                      onClick={() => { nav(item.route); setShowMore(false) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '10px 16px', background: active ? 'var(--bg-elevated)' : 'transparent',
                        border: 'none', cursor: 'pointer', color: 'var(--text)',
                        fontSize: 13, fontWeight: active ? 600 : 400, textAlign: 'left',
                      }}>
                      {item.icon} {item.label}
                      {(item as any).badge && inboxCount > 0 && (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', marginLeft: 'auto' }}/>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <nav style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 56,
            background: 'var(--surface)', borderTop: '1px solid var(--border)',
            backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center',
            justifyContent: 'space-around', height: 60, padding: '0 4px',
          }}>
            {/* Home */}
            {(() => {
              const active = location.pathname === '/app'
              return (
                <button onClick={() => { nav('/app'); setShowMore(false) }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                           background: 'none', border: 'none', cursor: 'pointer', flex: 1,
                           color: active ? 'var(--accent)' : 'var(--muted)', padding: '4px 0' }}>
                  <Home size={20} strokeWidth={1.5}/>
                  <span style={{ fontSize: 7, letterSpacing: '0.05em' }}>{t('nav.home')}</span>
                </button>
              )
            })()}

            {/* Gift */}
            {(() => {
              const active = location.pathname.startsWith('/app/gift')
              return (
                <button onClick={() => { nav('/app/gift'); setShowMore(false) }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                           background: 'none', border: 'none', cursor: 'pointer', flex: 1,
                           color: active ? 'var(--accent)' : 'var(--muted)', padding: '4px 0' }}>
                  <Gift size={20} strokeWidth={1.5}/>
                  <span style={{ fontSize: 7, letterSpacing: '0.05em' }}>{t('dashboard.actions.gift')}</span>
                </button>
              )
            })()}

            {/* SCAN center */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <button onClick={() => { nav('/app/scan'); setShowMore(false) }} style={{
                width: 52, height: 52, borderRadius: '50%',
                border: '2px solid var(--border)', background: 'var(--surface)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 12px rgba(0,0,0,0.15)', marginBottom: 16,
              }}>
                <QrCode size={22} strokeWidth={1.5} color="var(--text)" />
              </button>
            </div>

            {/* Transfer */}
            {(() => {
              const active = location.pathname.startsWith('/app/transfer')
              return (
                <button onClick={() => { nav('/app/transfer'); setShowMore(false) }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                           background: 'none', border: 'none', cursor: 'pointer', flex: 1,
                           color: active ? 'var(--accent)' : 'var(--muted)', padding: '4px 0' }}>
                  <ArrowUpRight size={20} strokeWidth={1.5}/>
                  <span style={{ fontSize: 7, letterSpacing: '0.05em' }}>{t('dashboard.actions.transfer')}</span>
                </button>
              )
            })()}

            {/* More */}
            <button onClick={() => setShowMore(s => !s)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                       background: 'none', border: 'none', cursor: 'pointer', flex: 1,
                       color: showMore ? 'var(--accent)' : 'var(--muted)', padding: '4px 0' }}>
              {showMore ? <X size={20} strokeWidth={1.5}/> : <MoreHorizontal size={20} strokeWidth={1.5}/>}
              <span style={{ fontSize: 7, letterSpacing: '0.05em' }}>{t('nav.more')}</span>
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
