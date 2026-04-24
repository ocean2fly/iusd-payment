/**
 * IdentityCardBack — V1-style dashboard panel (back face of flip card)
 *
 * Layout mirrors V1 Home.tsx balance card:
 *  Top-left:  DNA ID pill (shortId◆◆◆[checksum])  |  Top-right: Deposit / Withdraw
 *  Center:    iUSD balance (large) + Refresh + Eye(=flip) icons
 *  Bottom:    Only on INITIA  |  Gas OK indicator
 *
 * Click any blank area → flip to front. Eye icon = flip button.
 * No QR code.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import type { ApiAccount } from '@ipay/shared'
import { useConfig } from '../hooks/useConfig'
import { IUSD_DENOM as DEFAULT_IUSD_DENOM, IUSD_FA, IUSD_DENOM } from '../networks'

const REST_URL   = import.meta.env.VITE_REST_URL || 'https://rest.initia.xyz'
const INIT_DENOM = 'uinit'
const USDC_DENOM = 'ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4'

// ── Helpers ───────────────────────────────────────────────────────────────
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function idHue(addr: string) { return fnv(addr.toLowerCase()) % 360 }
function hsl(h: number, s: number, l: number, a = 1) {
  return a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`
}

async function fetchBalances(address: string, iusdDenom: string) {
  try {
    const res  = await fetch(`${REST_URL}/cosmos/bank/v1beta1/balances/${address}`)
    const data = await res.json()
    const bal: any[] = data.balances ?? []
    const get = (denom: string) => bal.find((b: any) => b.denom === denom)
    function fmt(coin: any, dec = 6): string {
      if (!coin) return '0'
      const raw = BigInt(coin.amount), d = 10n ** BigInt(dec)
      const w = raw / d, f = raw % d
      return f === 0n ? w.toLocaleString() : `${w.toLocaleString()}.${f.toString().padStart(dec,'0').replace(/0+$/,'')}`
    }
    const iusdCoin =
      get(iusdDenom) ??
      bal.find((b: any) => b.denom === `move/${IUSD_FA.replace(/^0x/, '')}`) ??
      null
    return { iusd: fmt(iusdCoin), init: fmt(get(INIT_DENOM)), usdc: fmt(get(USDC_DENOM)) }
  } catch {
    return { iusd: '0', init: '0', usdc: '0' }
  }
}

export interface GasData {
  initBal: string | null
  usdcBal: string | null
  initLow: boolean
  usdcLow: boolean
  gasOk: boolean
}

interface Props {
  account:     ApiAccount
  address:     string
  onFlip:      () => void
  gasOpen:     boolean
  onGasToggle: () => void
  onGasData?:  (d: GasData) => void
  onDeposit?:  (mode: 'deposit' | 'withdraw', denom: string, label: string) => void
  onRefreshRef?: React.MutableRefObject<(() => void) | null>
}

// ── Copy ID button ────────────────────────────────────────────────────────
function CopyIdButton({ shortId }: { shortId: string; accent?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(shortId)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={handleCopy} title={t('profile.copyFullId')}
      style={{ background:'none', border:'none', cursor:'pointer', padding:2,
               color: copied ? '#4ade80' : 'rgba(255,255,255,0.40)',
               display:'flex', alignItems:'center', transition:'color 0.2s' }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}


export function IdentityCardBack({ account, address, onFlip, gasOpen, onGasToggle, onGasData, onDeposit, onRefreshRef }: Props) {
  const { t } = useTranslation()
  const { config } = useConfig()
  const iusdDenom = config?.iusd?.denom ?? DEFAULT_IUSD_DENOM


  const [iusdBal, setIusdBal] = useState<string | null>(null)
  const [initBal, setInitBal] = useState<string | null>(null)
  const [usdcBal, setUsdcBal] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hidden,  setHidden]  = useState(() => localStorage.getItem('ipay_hide_balance') === '1')

  const hue   = idHue(account.address)
  const rawL  = fnv(account.address.toLowerCase() + 'lit') % 48
  const rawS  = fnv(account.address.toLowerCase() + 'sat') % 48
  const h2off = 18 + fnv(account.address.toLowerCase() + 'h2o') % 150
  const hue2  = (hue + h2off) % 360

  // Muted palette
  const bgL1  = Math.max(8,  Math.round((8 + rawL) * 0.60))
  const bgL2  = Math.max(5,  bgL1 - 5)
  const bgS1  = Math.max(22, Math.round((48 + rawS) * 0.50))
  const bgS2  = Math.max(16, bgS1 - 8)

  const acL    = Math.min(75, bgL1 + 32)
  const accent = hsl(hue, bgS1 + 18, acL)
  const dim    = 'rgba(255,255,255,0.40)'
  const dim2   = 'rgba(255,255,255,0.22)'

  const refresh = useCallback(() => {
    if (!address) return
    setLoading(true)
    fetchBalances(address, iusdDenom).then(({ iusd, init, usdc }) => {
      setIusdBal(iusd); setInitBal(init); setUsdcBal(usdc)
    }).finally(() => setLoading(false))
  }, [address, iusdDenom])

  useEffect(() => { refresh() }, [refresh])

  // Expose refresh to parent via ref
  useEffect(() => {
    if (onRefreshRef) onRefreshRef.current = refresh
  }, [onRefreshRef, refresh])

  const initNum = parseFloat((initBal ?? '0').replace(/,/g, ''))
  const usdcNum = parseFloat((usdcBal ?? '0').replace(/,/g, ''))
  const gasOk   = initNum >= 1 || usdcNum >= 1
  const initLow = initNum < 1
  const usdcLow = usdcNum < 1

  // Propagate gas data to parent (for external panel rendering)
  useEffect(() => {
    onGasData?.({ initBal, usdcBal, initLow, usdcLow, gasOk })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initBal, usdcBal, gasOk])

  function toggleHide() {
    const n = !hidden; setHidden(n)
    localStorage.setItem('ipay_hide_balance', n ? '1' : '0')
  }

  // DNA ID display: first 4 ◆◆◆ [last 4] — 16-char shortId abbreviated with ellipsis
  const sid   = account.shortId ?? '????????????????'
  const dnaId = `${sid.slice(0,4)} *** [${sid.slice(-4)}]`

  // Stop propagation on interactive elements
  const sp = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      onClick={onFlip}
      dir="ltr"
      style={{
        position:     'relative',
        width:        '100%',
        maxWidth:     360,
        aspectRatio:  '360/227',
        borderRadius: 18,
        overflow:     'hidden',
        background:   `linear-gradient(135deg, ${hsl(hue,bgS1,bgL1)} 0%, ${hsl(hue2,bgS2,bgL2)} 100%)`,
        boxShadow:    '0 8px 40px rgba(0,0,0,0.55)',
        userSelect:   'none',
        cursor:       'pointer',
        color:        'white',
        textAlign:    'left',
      }}
    >
      {/* ── Row 1: DNA ID pill  |  Deposit / Withdraw ────────────── */}
      <div style={{ position:'absolute', top:16, left:16, right:16, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        {/* DNA ID display + copy icon */}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* ID label + formatted shortId */}
          <div style={{
            display:'flex', alignItems:'center', gap:6,
            padding: '5px 10px',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 8,
          }}>
            <span style={{ color:'rgba(255,255,255,0.40)', fontSize:8, letterSpacing:'0.15em', fontWeight:700 }}>{t('components.identityCardBack.idLabel')}</span>
            <span style={{ fontFamily:'monospace', fontSize:11, letterSpacing:'0.08em', color:accent, fontWeight:600 }}>
              {dnaId}
            </span>
          </div>
          {/* Copy icon button */}
          <CopyIdButton shortId={account.shortId ?? ''} accent={accent} />
        </div>

        {/* Deposit / Withdraw */}
        <div onClick={sp} style={{ display:'flex', border:'1px solid rgba(255,255,255,0.18)', borderRadius:8, overflow:'hidden' }}>
          {[
            { key:'deposit',  label: t('components.identityCardBack.deposit'),  fn: () => onDeposit?.('deposit', IUSD_DENOM, 'iUSD') },
            { key:'withdraw', label: t('components.identityCardBack.withdraw'), fn: () => onDeposit?.('withdraw', IUSD_DENOM, 'iUSD') },
          ].map((b, i) => (
            <button key={b.key} onClick={b.fn} style={{
              padding:'5px 11px', fontSize:10, fontWeight:600, cursor:'pointer',
              background:'rgba(255,255,255,0.10)', color:'rgba(255,255,255,0.80)',
              border:'none', borderRight: i===0 ? '1px solid rgba(255,255,255,0.18)' : 'none',
            }}>{b.label}</button>
          ))}
        </div>
      </div>

      {/* ── Balance (center-right) + Refresh + Eye(flip) ─────────── */}
      <div style={{ position:'absolute', top:58, right:16, display:'flex', alignItems:'center', gap:8 }}>
        {/* Balance number */}
        <div style={{ textAlign:'right' }}>
          {loading && iusdBal === null
            ? <div style={{ fontSize:42, fontWeight:700, color:'rgba(255,255,255,0.25)', letterSpacing:'-0.02em', lineHeight:1 }}>···</div>
            : hidden
            ? <div style={{ fontSize:42, fontWeight:700, color:'rgba(255,255,255,0.25)', userSelect:'none', lineHeight:1, letterSpacing:'0.06em' }}>••••••</div>
            : <div style={{ fontSize: Math.min(42, Math.max(20, 42 - ((iusdBal ?? '0').length - 4) * 3)), fontWeight:700, letterSpacing:'-0.03em', lineHeight:1 }}>
                {(() => {
                  const [int, dec] = (iusdBal ?? '0').split('.')
                  const decSize = Math.min(20, Math.max(12, 20 - ((iusdBal ?? '0').length - 4) * 2))
                  return dec
                    ? <>{int}<span style={{ fontSize:decSize, fontWeight:600, color:'rgba(255,255,255,0.45)' }}>.{dec}</span></>
                    : <>{int}</>
                })()}
              </div>
          }
        </div>
        {/* Refresh + Eye(flip) icons */}
        <div onClick={sp} style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'center' }}>
          <button onClick={refresh} style={{ background:'none', border:'none', cursor:'pointer', color:dim, padding:2 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 style={loading ? { animation:'spin 1s linear infinite' } : {}}>
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
          <button onClick={(e) => { sp(e); toggleHide() }} style={{ background:'none', border:'none', cursor:'pointer', color:dim, padding:2 }}>
            {hidden
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
            }
          </button>
        </div>
      </div>

      {/* ── Row 3: Only on INITIA  |  Gas OK ─────────────────────── */}
      <div style={{ position:'absolute', bottom:16, left:16, right:16, display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:9, color:dim2 }}>{t('components.identityCardBack.onlyOn')}</span>
          <div style={{ display:'flex', alignItems:'center', gap:3 }}>
            <img src="/images/initia.png" style={{ width:12, height:12, borderRadius:'50%' }}
                 onError={(e: any) => { e.target.style.display='none' }}/>
            <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,0.65)' }}>INITIA</span>
          </div>
        </div>

        <div onClick={sp} style={{ position:'relative', display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <button onClick={(e) => { e.stopPropagation(); onGasToggle() }} style={{
            display:'flex', alignItems:'center', gap:5, padding:'3px 10px',
            background: gasOk ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${gasOk ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
            borderRadius:20, cursor:'pointer',
            color: gasOk ? '#10b981' : '#ef4444', fontSize:10, fontWeight:600,
          }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background: gasOk ? '#10b981' : '#ef4444', display:'inline-block'}}/>
            {hidden ? t('components.identityCardBack.gas') : gasOk ? t('components.identityCardBack.gasOk') : t('components.identityCardBack.lowGas')}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                 style={{ transform: gasOpen ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>


        </div>
      </div>
    </div>
  )
}
