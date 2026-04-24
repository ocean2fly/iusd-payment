/**
 * /profile/:shortId — Simplified profile page after scanning QR.
 * Shows nickname + ID-DNA, Transfer & Gift buttons.
 * Auto-adds to contacts. Redirects unregistered users to register with return.
 *
 * Background uses server-provided DNA params (derived from the private
 * address so the gradient matches the owner's IdentityCard exactly), with
 * a shortId-hash fallback for older API responses.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useAuthContext } from '../hooks/AuthContext'
import { upsertContact, loadContacts } from '../lib/contactsStore'
import { ArrowUpRight, Gift, UserPlus, Check } from 'lucide-react'
import { QuickLogin } from '../components/QuickLogin'
import { dnaColor as getDnaColor } from '../lib/dnaColor'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://api.iusd-pay.xyz/v1'

// ── Color helpers (same FNV as IdentityCard) ────────────────────────────
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function hsl(h: number, s: number, l: number, a = 1): string {
  return a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`
}

type DnaParams = { hue: number; rawL: number; rawS: number; themeIdx: number; angIdx: number; h2oRaw: number }

function paramsFromSeed(seed: string): DnaParams {
  const s = seed.toLowerCase()
  return {
    hue:      fnv(s) % 360,
    rawL:     fnv(s + 'lit')   % 48,
    rawS:     fnv(s + 'sat')   % 48,
    themeIdx: fnv(s + 'theme') % 6,
    angIdx:   fnv(s + 'ang')   % 8,
    h2oRaw:   fnv(s + 'h2o')   % 30,
  }
}

function deriveColors(params: DnaParams) {
  const { hue, rawL, rawS, themeIdx, angIdx, h2oRaw } = params
  const ANGLES   = [45, 90, 120, 135, 160, 200, 225, 315]
  const gradAngle = ANGLES[angIdx]
  const hue2Offsets = [18, 60, 120, 150, 180, 240]
  const h2off = hue2Offsets[themeIdx] + h2oRaw
  const hue2  = (hue + h2off) % 360

  type ThemeParams = { L1:number; L2:number; S1:number; S2:number; acLift:number }
  const THEMES: ThemeParams[] = [
    { L1: 8  + rawL % 20, L2: 4,              S1: 70 + rawS % 25, S2: 60, acLift: 25 },
    { L1: 28 + rawL % 20, L2: 12 + rawL % 12, S1: 55 + rawS % 20, S2: 45, acLift: 22 },
    { L1: 50 + rawL % 20, L2: 30 + rawL % 15, S1: 80 + rawS % 15, S2: 65, acLift: 15 },
    { L1: 6  + rawL % 15, L2: 3,              S1: 90 + rawS % 10, S2: 75, acLift: 28 },
    { L1: 15 + rawL % 25, L2: 5  + rawL % 10, S1: 48 + rawS % 20, S2: 38, acLift: 20 },
    { L1: 35 + rawL % 22, L2: 18 + rawL % 14, S1: 65 + rawS % 20, S2: 50, acLift: 18 },
  ]
  const th = THEMES[themeIdx]
  const bgL1 = th.L1
  const bgS1 = th.S1
  const bgL2 = th.L2
  const bgS2 = th.S2

  const useMidStop = themeIdx === 2 || themeIdx === 3
  const hueMid     = (hue + h2off / 2) % 360
  const bgMid      = useMidStop ? hsl(hueMid, bgS1, Math.max(bgL1, bgL2) - 6) : null
  const bg1        = hsl(hue,  bgS1, bgL1)
  const bg2        = hsl(hue2, bgS2, bgL2)

  // Card gradient
  const cardGradient = bgMid
    ? `linear-gradient(${gradAngle}deg, ${bg1} 0%, ${bgMid} 50%, ${bg2} 100%)`
    : `linear-gradient(${gradAngle}deg, ${bg1} 0%, ${bg2} 100%)`

  // Outer page: very muted version of the primary hue
  const outerBg = hsl(hue, Math.max(12, bgS1 * 0.2), Math.max(6, bgL1 * 0.35))

  // Text readability
  const isLight = bgL1 > 40
  const textColor = isLight ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.90)'
  const mutedText = isLight ? 'rgba(0,0,0,0.50)' : 'rgba(255,255,255,0.45)'
  const borderColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  // Button colors
  const btnPrimary = isLight ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.90)'
  const btnPrimaryText = isLight ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.90)'
  const btnSecondary = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'
  const btnSecondaryBorder = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'

  // DNA accent color for ID-DNA text
  const dnaAccent = hsl(hue, 70, isLight ? 40 : 65)

  return { cardGradient, outerBg, textColor, mutedText, borderColor,
           btnPrimary, btnPrimaryText, btnSecondary, btnSecondaryBorder, hue, bgS1, bgL1, dnaAccent }
}

function privId(id?: string | null): string {
  if (!id || id.length < 8) return id ?? '—'
  return `${id.slice(0, 4)}◆${id.slice(-4)}`
}

export default function ProfileCard() {
  const { t } = useTranslation()
  const { shortId } = useParams<{ shortId: string }>()
  const navigate = useNavigate()
  const smartClose = useSmartClose('/')
  const { address, status } = useAuthContext()
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState<string | null>(null)
  const [copied, setCopied]   = useState(false)
  const [contactSaved, setContactSaved] = useState(false)

  // Fetch profile
  useEffect(() => {
    if (!shortId) { setErr('No ID'); setLoading(false); return }
    fetch(`${API_BASE}/account/public/${shortId}/profile`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setErr(d.error)
        else {
          setData(d)
          document.title = `${d.nickname || shortId} · iUSD Pay`
        }
        setLoading(false)
      })
      .catch(() => { setErr('Failed to load'); setLoading(false) })
  }, [shortId])

  // Auto-add to contacts when profile loads and user is authenticated
  useEffect(() => {
    if (!data || !address) return
    upsertContact(address, {
      shortId: data.shortId || shortId!,
      nickname: data.nickname ?? '',
      shortSealSvg: data.shortSealSvg ?? null,
    })
    setContactSaved(true)
  }, [data, address, shortId])

  // Action handler: pre-save return path then navigate.
  // RequireAuth may or may not save it (depends on timing with 1500ms ready timeout),
  // so we save it here as a safety net. Landing/Welcome will restore it after auth.
  function handleAction(path: string) {
    sessionStorage.setItem('ipay2_return_path', path)
    navigate(path)
  }

  // DNA colors: prefer backend-computed params (derived from the private
  // address server-side) so the profile matches the owner's IdentityCard.
  // Fall back to hashing shortId if the server didn't return dna (old
  // clients / not-found responses).
  const dnaParams: DnaParams = data?.dna ?? paramsFromSeed(shortId || '')
  const colors = deriveColors(dnaParams)

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
                  background: colors.outerBg, color: colors.mutedText, fontFamily:'system-ui,sans-serif' }}>
      Loading…
    </div>
  )

  if (err || !data) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
                  background: colors.outerBg, color: colors.mutedText, fontFamily:'system-ui,sans-serif' }}>
      Profile not found.
    </div>
  )

  const { nickname, bio } = data
  const displayName = nickname || shortId
  const slogan = bio || t('profile.defaultSlogan')
  const dnaAccentColor = getDnaColor(shortId || '')

  // Check if already in contacts
  const contacts = address ? loadContacts(address) : []
  const isContactAdded = contacts.some(c => c.shortId === shortId?.toUpperCase()) || contactSaved

  function addContact() {
    if (!address || !shortId || isContactAdded) return
    upsertContact(address, {
      shortId: data.shortId || shortId,
      nickname: data.nickname ?? '',
      shortSealSvg: data.shortSealSvg ?? null,
    })
    setContactSaved(true)
  }

  return (
    <div style={{
      minHeight: '100vh', background: colors.outerBg,
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '24px 16px',
    }}>

      <div style={{
        width: '100%', maxWidth: 380,
        background: colors.cardGradient,
        border: `1px solid ${colors.borderColor}`,
        borderRadius: 20, padding: '28px 24px 32px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)',
      }}>
        {/* Header: logo left + close right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/images/iusd.png?v=20260414" alt="iUSD" style={{ width: 22, height: 22, borderRadius: '50%', opacity: 0.85 }} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', color: colors.textColor, opacity: 0.7 }}>
              iUSD <span style={{ fontWeight: 400, opacity: 0.7 }}>pay</span>
            </span>
          </div>
          <button onClick={smartClose}
            style={{ background: 'none', border: 'none', color: colors.mutedText, cursor: 'pointer',
                     fontSize: 18, padding: '2px 6px', lineHeight: 1 }}
            title={t('common.close')}>✕</button>
        </div>

        {/* nickname@ID-DNA — one line (matches Scan result) */}
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: colors.textColor }}>
            {displayName}
          </span>
          <span style={{ fontSize: 11, color: dnaAccentColor, fontFamily: 'monospace', marginLeft: 4 }}>
            @{privId(shortId)}
          </span>
          {/* Copy full ID */}
          <button
            onClick={() => { navigator.clipboard.writeText(shortId ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            title={t('profile.copyFullId')}
            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: dnaAccentColor, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 4 }}
          >
            {copied ? (
              <Check size={13} strokeWidth={2.5} />
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>

        {/* Slogan — Dancing Script like Scan page */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@500&display=swap" />
        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 16, color: colors.textColor,
                      fontFamily: "'Dancing Script', cursive", opacity: 0.75, lineHeight: 1.5 }}>
          {slogan}
        </div>

        {/* Action buttons */}
        {status === 'registered' ? (
          /* Authenticated: Transfer + Gift buttons */
          <div style={{ display:'flex', gap:10, marginTop: 24 }}>
            <button onClick={() => handleAction(`/app/transfer?to=${shortId}`)}
              style={{ flex:2, padding:'13px 0', borderRadius:12,
                       background: colors.dnaAccent, color: '#fff',
                       border:'none', fontSize:14, fontWeight:700, cursor:'pointer',
                       display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                       transition: 'transform 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}>
              <ArrowUpRight size={16} strokeWidth={2} />
              {t('dashboard.actions.transfer')}
            </button>
            <button onClick={() => handleAction(`/app/gift?sendTo=${shortId}`)}
              style={{ flex:1, padding:'13px 0', borderRadius:12,
                       background: colors.btnSecondary, color: colors.textColor,
                       border: `1px solid ${colors.btnSecondaryBorder}`, fontSize:14, fontWeight:700, cursor:'pointer',
                       display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                       transition: 'transform 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}>
              <Gift size={16} strokeWidth={2} />
              {t('dashboard.actions.gift')}
            </button>
          </div>
        ) : (
          /* Not authenticated: QuickLogin */
          <div style={{ marginTop: 24 }}>
            <QuickLogin actionLabel="interact" accentColor={colors.dnaAccent} />
          </div>
        )}

        {/* Contact status */}
        <button onClick={addContact} disabled={isContactAdded}
          style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 10,
                   background: 'transparent', border: `1px solid ${colors.btnSecondaryBorder}`,
                   color: colors.textColor, fontSize: 12, cursor: isContactAdded ? 'default' : 'pointer',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                   opacity: isContactAdded ? 0.5 : 0.8 }}>
          {isContactAdded ? (
            <><Check size={14} strokeWidth={2.5} color="#22c55e" /> {t('profile.contactAlreadyAdded')}</>
          ) : (
            <><UserPlus size={14} strokeWidth={2} /> {t('profile.addToContacts')}</>
          )}
        </button>

        {/* Subtle footer */}
        <div style={{ marginTop: 16, fontSize: 9, color: colors.mutedText, letterSpacing: '0.1em', textAlign: 'center' }}>
          iusd-pay.xyz · INITIA
        </div>
      </div>
    </div>
  )
}
