/**
 * IdentityCard — Premium iUSD Pay payment card
 *
 * Debit-card style, ~85.6×53.98mm ratio (standard ISO/IEC 7810 ID-1)
 * Rendered at 2× (400×252px) for sharpness.
 *
 * Contains:
 *  - Address-hue gradient background + decorative SVG layer
 *  - iUSD Pay wordmark logo
 *  - EMV chip
 *  - Identity Seal (nickname @ HEAD◆◆◆TAIL)
 *  - VALID FROM / THROUGH ∞
 *  - QR code (receive link)
 *  - PAYMENT ACCOUNT label
 */

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ApiAccount } from '@ipay/shared'
import { StyledQR } from './StyledQR'

const APP_URL = 'https://iusd-pay.xyz'

// ── Helpers ──────────────────────────────────────────────────────────────
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function idHue(addr: string): number { return fnv(addr.toLowerCase()) % 360 }
function hsl(h: number, s: number, l: number, a = 1): string {
  return a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`
}

export type CardStatus = 'active' | 'frozen' | 'deactivated'

// ── Background texture generator ─────────────────────────────────────────
// 20 background texture patterns; seed picks pattern + density + opacity variant
// density = (seed >> 4) % 3  →  0=sparse / 1=normal / 2=dense
// opacity base = 0.04 + ((seed >> 7) % 4) * 0.015  →  0.04 / 0.055 / 0.07 / 0.085
function bgTexture(seed: number, accentHex: string): React.ReactElement {
  const t    = seed % 20
  const dens = (seed >> 4) % 3          // 0 sparse · 1 normal · 2 dense
  const op   = 0.04 + ((seed >> 7) % 4) * 0.015
  const sz   = [20, 15, 11][dens]       // cell size shrinks when dense
  const sw   = [0.5, 0.7, 0.9][dens]   // stroke width

  const c = accentHex   // shorthand

  if (t === 0) return (        // dot grid
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse">
      <circle cx={sz/2} cy={sz/2} r={0.9 + dens * 0.3} fill={c} opacity={op}/>
    </pattern>)

  if (t === 1) return (        // diagonal /
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse">
      <line x1="0" y1={sz} x2={sz} y2="0" stroke={c} strokeWidth={sw} opacity={op}/>
    </pattern>)

  if (t === 2) return (        // diagonal \
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2={sz} y2={sz} stroke={c} strokeWidth={sw} opacity={op}/>
    </pattern>)

  if (t === 3) return (        // crosshatch
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse">
      <line x1="0" y1={sz/2} x2={sz} y2={sz/2} stroke={c} strokeWidth={sw * 0.8} opacity={op}/>
      <line x1={sz/2} y1="0" x2={sz/2} y2={sz} stroke={c} strokeWidth={sw * 0.8} opacity={op}/>
    </pattern>)

  if (t === 4) return (        // X crosshatch
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2={sz} y2={sz} stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
      <line x1={sz} y1="0" x2="0" y2={sz} stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
    </pattern>)

  if (t === 5) {               // circuit nodes
    const h = sz * 1.5
    return (
    <pattern id="bgtex" width={sz * 2} height={h} patternUnits="userSpaceOnUse">
      <line x1="0" y1={h/2} x2={sz*2} y2={h/2} stroke={c} strokeWidth={sw * 0.6} opacity={op * 0.8}/>
      <line x1={sz} y1="0" x2={sz} y2={h} stroke={c} strokeWidth={sw * 0.6} opacity={op * 0.8}/>
      <circle cx={sz} cy={h/2} r={1.8 + dens * 0.5} fill="none" stroke={c} strokeWidth={sw * 0.8} opacity={op * 1.5}/>
      <circle cx="0" cy="0" r={1.1} fill={c} opacity={op * 1.2}/>
      <circle cx={sz*2} cy={h} r={1.1} fill={c} opacity={op * 1.2}/>
    </pattern>)
  }

  if (t === 6) {               // hex grid
    const hw = sz * 0.8, hh = sz
    const hex = `M${hw},0 L${hw*2},${hh*0.25} L${hw*2},${hh*0.75} L${hw},${hh} L0,${hh*0.75} L0,${hh*0.25} Z`
    return (
    <pattern id="bgtex" width={hw*2} height={hh*1.5} patternUnits="userSpaceOnUse">
      <path d={hex} fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
      <path d={hex} fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op} transform={`translate(${hw},${hh*0.75})`}/>
    </pattern>)
  }

  if (t === 7) return (        // wave horizontal
    <pattern id="bgtex" width="60" height={sz} patternUnits="userSpaceOnUse">
      <path d={`M0,${sz/2} Q15,${sz/2 - sz*0.35} 30,${sz/2} Q45,${sz/2 + sz*0.35} 60,${sz/2}`}
            fill="none" stroke={c} strokeWidth={sw * 0.8} opacity={op}/>
    </pattern>)

  if (t === 8) return (        // wave vertical
    <pattern id="bgtex" width={sz} height="60" patternUnits="userSpaceOnUse">
      <path d={`M${sz/2},0 Q${sz/2 + sz*0.35},15 ${sz/2},30 Q${sz/2 - sz*0.35},45 ${sz/2},60`}
            fill="none" stroke={c} strokeWidth={sw * 0.8} opacity={op}/>
    </pattern>)

  if (t === 9) return (        // triangle grid
    <pattern id="bgtex" width={sz} height={sz * 0.866} patternUnits="userSpaceOnUse">
      <line x1="0" y1={sz * 0.866} x2={sz/2} y2="0" stroke={c} strokeWidth={sw * 0.6} opacity={op}/>
      <line x1={sz/2} y1="0" x2={sz} y2={sz * 0.866} stroke={c} strokeWidth={sw * 0.6} opacity={op}/>
      <line x1="0" y1={sz * 0.866} x2={sz} y2={sz * 0.866} stroke={c} strokeWidth={sw * 0.6} opacity={op}/>
    </pattern>)

  if (t === 10) return (       // diamond grid (rotated squares)
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect x={sz * 0.15} y={sz * 0.15} width={sz * 0.7} height={sz * 0.7}
            fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
    </pattern>)

  if (t === 11) return (       // chevron (zigzag)
    <pattern id="bgtex" width={sz * 2} height={sz} patternUnits="userSpaceOnUse">
      <polyline points={`0,${sz} ${sz},0 ${sz*2},${sz}`}
                fill="none" stroke={c} strokeWidth={sw * 0.8} opacity={op} strokeLinejoin="round"/>
    </pattern>)

  if (t === 12) return (       // brick pattern
    <pattern id="bgtex" width={sz * 2} height={sz} patternUnits="userSpaceOnUse">
      <rect x="0" y="0" width={sz * 2} height={sz} fill="none" stroke={c} strokeWidth={sw * 0.5} opacity={op}/>
      <line x1={sz} y1={sz} x2={sz} y2={sz * 2} stroke={c} strokeWidth={sw * 0.5} opacity={op}/>
    </pattern>)

  if (t === 13) return (       // polka dots offset
    <pattern id="bgtex" width={sz} height={sz} patternUnits="userSpaceOnUse">
      <circle cx={sz * 0.25} cy={sz * 0.25} r={0.8 + dens * 0.4} fill={c} opacity={op}/>
      <circle cx={sz * 0.75} cy={sz * 0.75} r={0.8 + dens * 0.4} fill={c} opacity={op}/>
    </pattern>)

  if (t === 14) return (       // concentric rings
    <pattern id="bgtex" width={sz * 2} height={sz * 2} patternUnits="userSpaceOnUse">
      <circle cx={sz} cy={sz} r={sz * 0.3} fill="none" stroke={c} strokeWidth={sw * 0.6} opacity={op}/>
      <circle cx={sz} cy={sz} r={sz * 0.65} fill="none" stroke={c} strokeWidth={sw * 0.5} opacity={op * 0.7}/>
      <circle cx={sz} cy={sz} r={sz} fill="none" stroke={c} strokeWidth={sw * 0.4} opacity={op * 0.5}/>
    </pattern>)

  if (t === 15) return (       // fine horizontal lines
    <pattern id="bgtex" width="100%" height={sz * 0.6} patternUnits="userSpaceOnUse">
      <line x1="0" y1={sz * 0.3} x2="360" y2={sz * 0.3} stroke={c} strokeWidth={sw * 0.5} opacity={op}/>
    </pattern>)

  if (t === 16) return (       // star/asterisk grid
    <pattern id="bgtex" width={sz * 1.5} height={sz * 1.5} patternUnits="userSpaceOnUse">
      <line x1={sz * 0.75 - sz * 0.3} y1={sz * 0.75} x2={sz * 0.75 + sz * 0.3} y2={sz * 0.75} stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
      <line x1={sz * 0.75} y1={sz * 0.75 - sz * 0.3} x2={sz * 0.75} y2={sz * 0.75 + sz * 0.3} stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
      <line x1={sz * 0.75 - sz * 0.21} y1={sz * 0.75 - sz * 0.21} x2={sz * 0.75 + sz * 0.21} y2={sz * 0.75 + sz * 0.21} stroke={c} strokeWidth={sw * 0.5} opacity={op * 0.8}/>
      <line x1={sz * 0.75 + sz * 0.21} y1={sz * 0.75 - sz * 0.21} x2={sz * 0.75 - sz * 0.21} y2={sz * 0.75 + sz * 0.21} stroke={c} strokeWidth={sw * 0.5} opacity={op * 0.8}/>
    </pattern>)

  if (t === 17) return (       // scattered square dots
    <pattern id="bgtex" width={sz * 2} height={sz * 2} patternUnits="userSpaceOnUse">
      <rect x={sz * 0.4} y={sz * 0.4} width={1.2 + dens * 0.4} height={1.2 + dens * 0.4} fill={c} opacity={op}/>
      <rect x={sz * 1.4} y={sz * 0.9} width={1.2 + dens * 0.4} height={1.2 + dens * 0.4} fill={c} opacity={op}/>
      <rect x={sz * 0.9} y={sz * 1.5} width={1.2 + dens * 0.4} height={1.2 + dens * 0.4} fill={c} opacity={op}/>
    </pattern>)

  if (t === 18) return (       // fish-scale / arc tiles
    <pattern id="bgtex" width={sz} height={sz * 0.7} patternUnits="userSpaceOnUse">
      <path d={`M0,${sz * 0.7} Q${sz/2},0 ${sz},${sz * 0.7}`} fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
      <path d={`M${-sz/2},${sz * 0.7} Q0,0 ${sz/2},${sz * 0.7}`} fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
    </pattern>)

  // t === 19: spiral-arm suggestion via arc grid
  return (
    <pattern id="bgtex" width={sz * 2} height={sz * 2} patternUnits="userSpaceOnUse">
      <path d={`M0,${sz} Q${sz},${sz * 0.2} ${sz * 2},${sz}`} fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op}/>
      <path d={`M${sz},0 Q${sz * 1.8},${sz} ${sz},${sz * 2}`} fill="none" stroke={c} strokeWidth={sw * 0.7} opacity={op * 0.7}/>
    </pattern>)
}

// ── Hex helper ────────────────────────────────────────────────────────────
function hslHexCard(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

interface Props {
  account:   ApiAccount
  status?:   CardStatus
  className?: string
}


function privId(id?: string | null) {
  if (!id || id.length < 8) return id ?? '—'
  return `${id.slice(0, 4)}◆${id.slice(-4)}`
}

function ProfileModal({ account, onClose }: { account: ApiAccount; onClose: () => void }) {
  const { t } = useTranslation()
  const profileUrl = `${APP_URL}/profile/${account.shortId}`
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  const dnaHue = idHue(account.address)

  async function handleShare() {
    if (isMobile && navigator.share) {
      try { await navigator.share({ title: t('components.identityCard.shareText'), url: profileUrl }); return } catch {}
    }
    setShowShareMenu(s => !s)
  }

  function copyUrl() {
    navigator.clipboard?.writeText(profileUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
    setShowShareMenu(false)
  }

  const encUrl = encodeURIComponent(profileUrl)
  const encTitle = encodeURIComponent(t('components.identityCard.shareText'))

  const modal = (
    <div
      onClick={() => { setShowShareMenu(false); onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
        animation: 'modalFadeIn 0.25s ease-out',
      }}
    >
      <style>{`@keyframes modalFadeIn{from{opacity:0}to{opacity:1}} @keyframes modalSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 380,
        background: `radial-gradient(ellipse at 60% 0%, hsl(${dnaHue},35%,15%) 0%, #0d0d0d 55%)`,
        borderRadius: 20, overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.9)',
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        position: 'relative',
        animation: 'modalSlideUp 0.3s ease-out',
      }}>
        {/* Top bar — DNA colored */}
        <div style={{ height: 4, background: `linear-gradient(90deg, hsl(${dnaHue},70%,45%), hsl(${dnaHue},70%,60%), hsl(${dnaHue},70%,45%))` }} />
        {/* Close button */}
        <div style={{ display:'flex', justifyContent:'flex-end', padding:'12px 16px 0' }}>
          <button onClick={onClose} style={{
            width:30, height:30, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.15)',
            background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.7)', fontSize:16,
            cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
          }}>✕</button>
        </div>
        <div style={{ padding:'8px 24px 28px' }}>
          {/* Name@ID */}
          <div style={{ textAlign:'center', marginBottom:18 }}>
            <span style={{ fontSize:20, fontWeight:700, color:'#fff' }}>{account.nickname || account.merchantName}</span>
            <span style={{ fontSize:13, color:`hsla(${dnaHue},70%,55%,0.85)`, fontWeight:500 }}>@{privId(account.shortId)}</span>
            <div style={{ textAlign:'center', fontSize:13, color:'rgba(255,255,255,0.45)', marginTop:8 }}>
              {t('components.identityCard.scanAndGift')}
            </div>
          </div>
          {/* QR */}
          <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}>
            <div style={{ background:'#fff', borderRadius:14, padding:10, boxShadow:'0 8px 32px rgba(0,0,0,0.4)' }}>
              <StyledQR url={profileUrl} address={account.address} size={180} theme="light" />
            </div>
          </div>
          <div style={{ marginBottom:18 }} />
          {/* Share button */}
          <div style={{ position:'relative', display:'flex', justifyContent:'center' }}>
            <button onClick={handleShare} style={{
              fontSize:13, fontWeight:600, color:'#fff',
              background:`hsla(${dnaHue},65%,45%,0.15)`, border:`1px solid hsla(${dnaHue},65%,45%,0.35)`,
              borderRadius:10, padding:'9px 28px', cursor:'pointer',
              display:'flex', alignItems:'center', gap:6,
            }}>
              {t('components.identityCard.share')}
            </button>
            {/* Desktop share menu */}
            {showShareMenu && (
              <div onClick={e => e.stopPropagation()} style={{
                position:'absolute', bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)',
                background:'#1e1e1e', border:'1px solid rgba(255,255,255,0.12)',
                borderRadius:12, padding:'8px 12px',
                boxShadow:'0 16px 48px rgba(0,0,0,0.6)',
                display:'flex', alignItems:'center', gap:6,
              }}>
                {/* X (Twitter) */}
                <a href={`https://twitter.com/intent/tweet?text=${encTitle}&url=${encUrl}`} target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)} title="X"
                  style={{ width:36, height:36, borderRadius:8, background:'rgba(255,255,255,0.08)',
                           display:'flex', alignItems:'center', justifyContent:'center', color:'#e8e8e3', textDecoration:'none' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                {/* Facebook */}
                <a href={`https://www.facebook.com/sharer/sharer.php?u=${encUrl}`} target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)} title="Facebook"
                  style={{ width:36, height:36, borderRadius:8, background:'rgba(255,255,255,0.08)',
                           display:'flex', alignItems:'center', justifyContent:'center', color:'#e8e8e3', textDecoration:'none' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
                {/* Telegram */}
                <a href={`https://t.me/share/url?url=${encUrl}&text=${encTitle}`} target="_blank" rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)} title="Telegram"
                  style={{ width:36, height:36, borderRadius:8, background:'rgba(255,255,255,0.08)',
                           display:'flex', alignItems:'center', justifyContent:'center', color:'#e8e8e3', textDecoration:'none' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12.056 0h-.112zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                </a>
                {/* Copy link */}
                <button onClick={copyUrl} title={copied ? t('components.identityCard.copied') : t('components.identityCard.copyLink')}
                  style={{ width:36, height:36, borderRadius:8, background: copied ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)',
                           display:'flex', alignItems:'center', justifyContent:'center',
                           border:'none', color: copied ? '#22c55e' : '#e8e8e3', cursor:'pointer' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}

export function IdentityCard({ account, status = 'active', className = '' }: Props) {
  const { t } = useTranslation()
  const receiveUrl = `${APP_URL}/profile/${account.shortId}`
  const [showProfile, setShowProfile] = useState(false)
  const hue  = idHue(account.address)

  // Status display
  const statusLabel = status === 'active'
    ? t('components.identityCard.statusActive')
    : status === 'frozen'
    ? t('components.identityCard.statusFrozen')
    : t('components.identityCard.statusDeactivated')
  const statusColor = status === 'active'
    ? hsl(hue, 75, 68)
    : '#f87171'  // frozen / deactivated = red



  // ── DNA Color System v2 — 6 VISUAL THEMES + 8 GRADIENT ANGLES ─────────────
  // Each address deterministically falls into a visual theme → highly varied cards

  const texSeed  = fnv(account.address.toLowerCase() + 'tex')
  const rawL     = fnv(account.address.toLowerCase() + 'lit') % 48
  const rawS     = fnv(account.address.toLowerCase() + 'sat') % 48
  const themeIdx = fnv(account.address.toLowerCase() + 'theme') % 6

  // 8 gradient angles — variety over just 135deg
  const ANGLES  = [45, 90, 120, 135, 160, 200, 225, 315]
  const gradAngle = ANGLES[fnv(account.address.toLowerCase() + 'ang') % ANGLES.length]

  // hue offsets per theme
  const hue2Offsets = [18, 60, 120, 150, 180, 240]
  const h2off = hue2Offsets[themeIdx] + (fnv(account.address.toLowerCase() + 'h2o') % 30)
  const hue2  = (hue + h2off) % 360
  const hue3  = (hue + 200) % 360

  // 6 visual themes with dramatically different lightness+saturation profiles
  type ThemeParams = { L1:number; L2:number; S1:number; S2:number; acLift:number }
  const THEMES: ThemeParams[] = [
    { L1: 8  + rawL % 20, L2: 4,              S1: 70 + rawS % 25, S2: 60, acLift: 25 }, // Dark vivid
    { L1: 28 + rawL % 20, L2: 12 + rawL % 12, S1: 55 + rawS % 20, S2: 45, acLift: 22 }, // Mid-dark saturated
    { L1: 50 + rawL % 20, L2: 30 + rawL % 15, S1: 80 + rawS % 15, S2: 65, acLift: 15 }, // Vivid bright
    { L1: 6  + rawL % 15, L2: 3,              S1: 90 + rawS % 10, S2: 75, acLift: 28 }, // Neon dark
    { L1: 15 + rawL % 25, L2: 5  + rawL % 10, S1: 48 + rawS % 20, S2: 38, acLift: 20 }, // Moody desaturated
    { L1: 35 + rawL % 22, L2: 18 + rawL % 14, S1: 65 + rawS % 20, S2: 50, acLift: 18 }, // Warm pastel-mid
  ]
  const th = THEMES[themeIdx]

  const bgL1 = th.L1
  const bgL2 = th.L2
  const bgS1 = th.S1
  const bgS2 = th.S2
  const acL  = Math.min(90, bgL1 + th.acLift)

  // Some themes use 3-stop gradients for more drama
  const useMidStop  = themeIdx === 2 || themeIdx === 3  // neon + vivid
  const hueMid      = (hue + h2off / 2) % 360
  const bgMid       = useMidStop ? hsl(hueMid, bgS1, Math.max(bgL1, bgL2) - 6) : null

  const accentHex   = hslHexCard(hue, bgS1 + 10, acL)
  const bg1         = hsl(hue,  bgS1, bgL1)
  const bg2         = hsl(hue2, bgS2, bgL2)
  const accent      = hsl(hue,  bgS1 + 10, acL)

  // Text shadow: bright cards need darker shadow for readability
  const textShadow = bgL1 > 30 ? '0 1px 5px rgba(0,0,0,0.80)' : '0 1px 3px rgba(0,0,0,0.50)'

  // Date
  const today = new Date().toISOString().slice(0, 10)

  return (
  <>
    <div
      className={`relative select-none ${className}`}
      dir="ltr"
      style={{
        width: '100%',
        maxWidth: 360,
        aspectRatio: '360/227',
        borderRadius: 14,
        overflow: 'hidden',
        background: bgMid ? `linear-gradient(${gradAngle}deg, ${bg1} 0%, ${bgMid} 50%, ${bg2} 100%)` : `linear-gradient(${gradAngle}deg, ${bg1} 0%, ${bg2} 100%)`,
        boxShadow: `0 20px 60px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'left',
      }}
    >
      {/* ── Background decoration layer ─────────────────────────────── */}
      <svg
        width="360" height="227"
        viewBox="0 0 360 227"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="rg1" cx="70%" cy="30%" r="55%">
            <stop offset="0%" stopColor={hsl(hue, 70, 45, 0.35)}/>
            <stop offset="100%" stopColor={hsl(hue, 70, 45, 0)}/>
          </radialGradient>
          <radialGradient id="rg2" cx="20%" cy="80%" r="45%">
            <stop offset="0%" stopColor={hsl(hue3, 60, 50, 0.18)}/>
            <stop offset="100%" stopColor={hsl(hue3, 60, 50, 0)}/>
          </radialGradient>
          <linearGradient id="sheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)"/>
            <stop offset="45%" stopColor="rgba(255,255,255,0.07)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.02)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </linearGradient>
          <filter id="bgblur"><feGaussianBlur stdDeviation="28"/></filter>
          {bgTexture(texSeed, accentHex)}
        </defs>

        {/* ── Background texture ── */}
        <rect width="360" height="227" fill="url(#bgtex)" rx="14"/>

        {/* Ambient glows */}
        <ellipse cx="280" cy="60" rx="130" ry="110" fill="url(#rg1)" filter="url(#bgblur)"/>
        <ellipse cx="60"  cy="180" rx="100" ry="80"  fill="url(#rg2)" filter="url(#bgblur)"/>

        {/* Holographic sheen */}
        <rect width="360" height="227" fill="url(#sheen)"/>

        {/* Decorative arcs — position/radius vary by address */}
        {(() => {
          const s = fnv(account.address.toLowerCase() + 'arc')
          // Center: pick from 4 zones based on seed
          const zones = [[300,-30],[360,50],[-20,50],[180,-40]] as const
          const [ax, ay] = zones[s % 4]
          const r1 = 100 + (s >> 4) % 80
          const r2 = r1 + 30 + (s >> 12) % 40
          const arcHue = (hue + (s >> 8) % 60) % 360
          return (
            <>
              <circle cx={ax} cy={ay} r={r1} fill="none"
                stroke={hsl(arcHue, 55, 60, 0.1)} strokeWidth="0.8"/>
              <circle cx={ax} cy={ay} r={r2} fill="none"
                stroke={hsl(arcHue, 50, 55, 0.06)} strokeWidth="0.5"/>
            </>
          )
        })()}



        {/* Edge highlight */}
        <rect width="360" height="227" rx="14" fill="none"
          stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      </svg>

      {/* ── Logo (top-left) ────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 18, left: 22, display: 'flex', alignItems: 'center', gap: 7 }}>
        <img src="/images/iusd.png?v=20260414" style={{ width: 20, height: 20, borderRadius: '50%', opacity: 0.9 }} />
        <span style={{ fontSize: 12, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.85)', fontWeight: 400, lineHeight: 1 }}>
          iUSD<span style={{ fontWeight: 700, letterSpacing: '0.12em', marginLeft: 3 }}>pay</span>
        </span>
      </div>

      {/* ── Identity Seal — responsive, golden-ratio Y ────────────── */}
      {(() => {
        const svg  = account.avatarSvg
        const svgW  = svg ? parseInt(svg.match(/width="(\d+)"/) ?.[1] ?? '400', 10) : 400
        const svgH  = svg ? parseInt(svg.match(/height="(\d+)"/) ?.[1] ?? '50',  10) : 50

        return svg ? (
          <div className="idcard-seal-wrap" style={{
            position:     'absolute',
            left:         '6.1%',  // 22/360
            right:        '6.1%',  // 22/360
            top:          '61.8%', // golden ratio
            transform:    'translateY(-50%)',
            aspectRatio:  `${svgW}/${svgH}`,
            lineHeight:   0,
            textShadow,
          }}>
            <style>{`.idcard-seal-wrap svg{width:100%!important;height:100%!important;display:block}`}</style>
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        ) : (
          <div style={{ position: 'absolute', top: '61.8%', left: '6.1%', right: '6.1%',
                        transform: 'translateY(-50%)',
                        fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.5)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {account.nickname} #{account.shortId}
          </div>
        )
      })()}

      {/* ── Valid From / Status (bottom-left) ─────────────────────── */}
      <div style={{ position: 'absolute', bottom: 20, left: 22, display: 'flex', gap: 22, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 6, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.28)', marginBottom: 4 }}>
            {t('components.identityCard.validFrom')}
          </div>
          <div style={{ fontSize: 9, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
            {today}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 6, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.28)', marginBottom: 4 }}>
            {t('components.identityCard.status')}
          </div>
          <div style={{
            fontSize: 9, letterSpacing: '0.08em', fontFamily: 'monospace', fontWeight: 600,
            color: statusColor,
            textShadow: status === 'active' ? `0 0 8px ${statusColor}80` : '0 0 8px #f8717180',
          }}>
            {statusLabel}
          </div>
        </div>
      </div>



      {/* ── iUSD pay wordmark — bottom-right ──────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 16, right: 20,
        display: 'flex', alignItems: 'baseline', gap: 3, whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, fontStyle: 'italic', color: accent, letterSpacing: '-0.01em' }}>iUSD</span>
        <span style={{ fontSize: 11, fontWeight: 400, fontStyle: 'italic', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em' }}>pay</span>
      </div>

      {/* ── Styled QR — click to open profile modal ──────────────── */}
      <div
        onClick={e => { e.stopPropagation(); setShowProfile(true) }}
        style={{ position: 'absolute', top: 6, right: 6, cursor: 'pointer' }}
        title={t('components.identityCard.viewProfile')}
      >
        <StyledQR url={receiveUrl} address={account.address} size={101} />
      </div>

    </div>

    {/* ── Profile Card Modal (portal → document.body, bypasses transform stacking) */}
    {showProfile && <ProfileModal account={account} onClose={() => setShowProfile(false)} />}
  </>
  )
}
