/**
 * Merchant — /app/merchant
 * Business profile editor: name, logo, color, description.
 * Server DB is the sole source of truth (no localStorage).
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthContext } from '../hooks/AuthContext'
import { API_BASE } from '../config'
import { useNavigate } from 'react-router-dom'
import { type MerchantProfile } from './Request'

const FONTS: { family: string; label: string; google?: string }[] = [
  { family: 'inherit',          label: 'Default' },
  { family: 'Playfair Display', label: 'Playfair',   google: 'Playfair+Display:wght@700' },
  { family: 'Cinzel',           label: 'Cinzel',     google: 'Cinzel:wght@700' },
  { family: 'Pacifico',         label: 'Pacifico',   google: 'Pacifico' },
  { family: 'Lobster',          label: 'Lobster',    google: 'Lobster' },
  { family: 'Raleway',          label: 'Raleway',    google: 'Raleway:wght@800' },
  { family: 'Oswald',           label: 'Oswald',     google: 'Oswald:wght@600' },
  { family: 'Bebas Neue',       label: 'Bebas',      google: 'Bebas+Neue' },
  { family: 'Dancing Script',   label: 'Dancing',    google: 'Dancing+Script:wght@700' },
  { family: 'Righteous',        label: 'Righteous',  google: 'Righteous' },
]

function loadGoogleFont(family: string) {
  const id = 'gf-' + family.replace(/\s+/g, '-')
  if (document.getElementById(id)) return
  const google = FONTS.find(f => f.family === family)?.google
  if (!google) return
  const link = document.createElement('link')
  link.id   = id
  link.rel  = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${google}&display=swap`
  document.head.appendChild(link)
}


const PRESET_COLORS = [
  '#6366f1','#ec4899','#22c55e','#f59e0b','#ef4444',
  '#06b6d4','#8b5cf6','#f97316','#10b981','#3b82f6',
]

export function Merchant() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token, account } = useAuthContext()
  const [profile, setProfile] = useState<MerchantProfile>({
    name: '', logoUrl: '', color: '#6366f1', description: '',
    email: '', phone: '', website: '', address: '', taxId: '', fontFamily: 'inherit',
    invoicePrefix: 'INV-', invoiceStart: 1,
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    // Load from server DB only
    if (account?.merchantData) {
      setProfile(p => ({ ...p, ...account.merchantData }))
    }
  }, [account?.merchantData])

  async function save() {
    // Save to server DB (authoritative)
    if (token) {
      await fetch(`${API_BASE}/account/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          merchantName: profile.name || null,
          merchantData: profile,
        }),
      }).catch(() => {})
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function clear() {
    if (!window.confirm(t('merchant.clearConfirm'))) return
    setProfile({ name:'', logoUrl:'', color:'#6366f1', description:'', email:'', phone:'', website:'', address:'', taxId:'', fontFamily:'inherit', invoicePrefix:'INV-', invoiceStart:1 })
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  padding:'16px 16px 80px', gap:12, boxSizing:'border-box' }}>

      {/* Header */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', alignItems:'center',
                    gap:8, paddingBottom:10, borderBottom:'1px solid var(--border)' }}>
        <button onClick={() => navigate('/app')} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700, flex:1 }}>{t('merchant.title')}</span>
        {profile.name && (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            {profile.logoUrl
              ? <img src={profile.logoUrl} alt="" style={{ width:24, height:24, borderRadius:4, objectFit:'cover' }}/>
              : <div style={{ width:24, height:24, borderRadius:4, background:profile.color,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              fontSize:11, color:'white', fontWeight:700 }}>
                  {profile.name[0]?.toUpperCase()}
                </div>}
            <span style={{ fontSize:11, fontWeight:600 }}>{profile.name}</span>
          </div>
        )}
      </div>

      {/* Preview strip */}
      {profile.name && (
        <div style={{ width:'100%', maxWidth:480, borderRadius:10, overflow:'hidden',
                      border:`2px solid ${profile.color}44`,
                      background:'var(--surface)', display:'flex', alignItems:'center',
                      gap:10, padding:'10px 14px' }}>
          <div style={{ width:36, height:36, borderRadius:8, background:profile.color,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        overflow:'hidden', flexShrink:0 }}>
            {profile.logoUrl
              ? <img src={profile.logoUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              : <span style={{ fontSize:18, fontWeight:700, color:'white' }}>
                  {profile.name[0]?.toUpperCase()}
                </span>}
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, fontFamily: profile.fontFamily || 'inherit' }}>{profile.name}</div>
            {profile.description && (
              <div style={{ fontSize:10, color:'var(--muted)' }}>{profile.description}</div>
            )}
          </div>
          <div style={{ marginLeft:'auto', fontSize:9, color:'var(--muted)' }}>{t('merchant.preview')}</div>
        </div>
      )}

      {/* Name */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.businessName')}</div>
        <input
          type="text" placeholder={t('merchant.businessNamePlaceholder')}
          value={profile.name}
          onChange={e => setProfile(p => ({ ...p, name: e.target.value.slice(0,40) }))}
          maxLength={40}
          style={{ ...inputSt, width:'100%', boxSizing:'border-box', marginTop:6 }}
        />
      </div>

      {/* Logo Upload */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.companyLogo')}</div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:8 }}>
          {profile.logoUrl
            ? <img src={profile.logoUrl} alt="logo"
                   style={{ width:52, height:52, borderRadius:8, objectFit:'cover',
                            border:'1px solid var(--border)', flexShrink:0 }} />
            : <div style={{ width:52, height:52, borderRadius:8, background:'var(--bg)',
                            border:'1px dashed var(--border)', flexShrink:0,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:20, color:'var(--muted)' }}>🖼</div>
          }
          <div style={{ flex:1 }}>
            <label style={{ display:'inline-block', padding:'7px 14px', borderRadius:8,
                            background:'var(--text)', color:'var(--surface)', fontSize:11,
                            fontWeight:700, cursor:'pointer' }}>
              {t('merchant.uploadJpgPng')}
              <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display:'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 500 * 1024) { alert(t('merchant.maxFileSize')); return }
                  const reader = new FileReader()
                  reader.onload = ev => setProfile(p => ({ ...p, logoUrl: ev.target?.result as string }))
                  reader.readAsDataURL(file)
                }} />
            </label>
            {profile.logoUrl && (
              <button onClick={() => setProfile(p => ({ ...p, logoUrl: '' }))}
                style={{ marginLeft:8, background:'none', border:'none', cursor:'pointer',
                         fontSize:11, color:'var(--muted)' }}>{t('merchant.remove')}</button>
            )}
            <div style={{ fontSize:10, color:'var(--muted)', marginTop:5 }}>
              {t('merchant.logoHint')}
            </div>
          </div>
        </div>
      </div>

      {/* Brand color */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.brandColor')}</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:8 }}>
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => setProfile(p => ({ ...p, color: c }))}
              style={{ width:28, height:28, borderRadius:'50%', background:c, border:'none',
                       cursor:'pointer', flexShrink:0,
                       boxShadow: profile.color === c ? `0 0 0 3px var(--bg), 0 0 0 5px ${c}` : 'none',
                       transform: profile.color === c ? 'scale(1.15)' : 'scale(1)',
                       transition:'all 0.15s' }} />
          ))}
          <input type="color" value={profile.color}
                 onChange={e => setProfile(p => ({ ...p, color: e.target.value }))}
                 style={{ width:28, height:28, padding:2, borderRadius:'50%',
                          border:'1px solid var(--border)', cursor:'pointer',
                          background:'transparent' }} />
        </div>
      </div>

      {/* Description */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.tagline')}</div>
        <input
          type="text" placeholder={t('merchant.taglinePlaceholder')}
          value={profile.description}
          onChange={e => setProfile(p => ({ ...p, description: e.target.value.slice(0,80) }))}
          maxLength={80}
          style={{ ...inputSt, width:'100%', boxSizing:'border-box', marginTop:6 }}
        />
      </div>

      {/* Font picker */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.businessFont')}</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
          {FONTS.map(f => (
            <button key={f.family} onClick={() => { setProfile(p => ({ ...p, fontFamily: f.family })); loadGoogleFont(f.family) }}
              style={{
                padding:'5px 10px', borderRadius:8, border:'none', cursor:'pointer',
                fontFamily: f.family, fontSize:13, fontWeight:700,
                background: profile.fontFamily === f.family ? profile.color : 'var(--bg)',
                color:      profile.fontFamily === f.family ? 'white' : 'var(--text)',
                boxShadow:  profile.fontFamily === f.family ? `0 0 0 2px ${profile.color}` : 'none',
                transition: 'all 0.15s',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        {profile.name && (
          <div style={{ marginTop:10, padding:'8px 12px', borderRadius:8,
                        background:'var(--bg)', textAlign:'center',
                        fontSize:18, fontWeight:700, fontFamily: profile.fontFamily,
                        color: profile.color }}>
            {profile.name}
          </div>
        )}
      </div>

      {/* Contact info */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.contactInfo')}</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:8 }}>
          <div>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.email')}</div>
            <input type="email" placeholder={t('merchant.emailPlaceholder')}
              value={profile.email}
              onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.phone')}</div>
            <input type="tel" placeholder={t('merchant.phonePlaceholder')}
              value={profile.phone}
              onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.website')}</div>
            <input type="url" placeholder={t('merchant.websitePlaceholder')}
              value={profile.website}
              onChange={e => setProfile(p => ({ ...p, website: e.target.value }))}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box' }} />
          </div>
        </div>
      </div>

      {/* Address & Tax */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.addressLegal')}</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:8 }}>
          <div>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.address')}</div>
            <textarea placeholder={t('merchant.addressPlaceholder')}
              value={profile.address}
              onChange={e => setProfile(p => ({ ...p, address: e.target.value.slice(0,200) }))}
              rows={2}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit' }} />
          </div>
          <div>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.taxIdLabel')}</div>
            <input type="text" placeholder={t('merchant.taxIdPlaceholder')}
              value={profile.taxId}
              onChange={e => setProfile(p => ({ ...p, taxId: e.target.value.slice(0,50) }))}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box', fontFamily:'monospace' }} />
          </div>
        </div>
      </div>

      {/* Invoice Settings */}
      <div style={card}>
        <div style={sectionLabel}>{t('merchant.invoiceNumbering')}</div>
        <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'flex-end' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.prefix')}</div>
            <input type="text" placeholder="INV-"
              value={profile.invoicePrefix ?? 'INV-'}
              onChange={e => setProfile(p => ({ ...p, invoicePrefix: e.target.value.slice(0,10) }))}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box', fontFamily:'monospace' }} />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:3, letterSpacing:'0.08em' }}>{t('merchant.startingNo')}</div>
            <input type="number" min="1" placeholder="1"
              value={profile.invoiceStart ?? 1}
              onChange={e => setProfile(p => ({ ...p, invoiceStart: parseInt(e.target.value)||1 }))}
              style={{ ...inputSt, width:'100%', boxSizing:'border-box' }} />
          </div>
        </div>
        <div style={{ marginTop:8, padding:'6px 10px', borderRadius:6, background:'var(--bg)',
                      fontSize:11, color:'var(--muted)' }}>
          {t('merchant.startingFrom', { sample: `${profile.invoicePrefix??'INV-'}${String(profile.invoiceStart??1).padStart(4,'0')}` })}
        </div>
      </div>

      {/* Save */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', gap:8 }}>
        <button onClick={save} disabled={!profile.name}
          style={{ ...btnFill, flex:1, opacity: profile.name ? 1 : 0.4 }}>
          {saved ? t('merchant.saved') : t('merchant.save')}
        </button>
        <button onClick={clear}
          style={{ ...btnGhost, padding:'10px 14px', color:'#ef4444',
                   borderColor:'rgba(239,68,68,0.3)' }}>
          {t('merchant.clear')}
        </button>
      </div>

      <div style={{ width:'100%', maxWidth:480, fontSize:10, color:'var(--muted)',
                    textAlign:'center', lineHeight:1.5 }}>
        {t('merchant.storedLocally1')}<br/>
        {t('merchant.storedLocally2')}
      </div>
    </div>
  )
}

const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
const card: React.CSSProperties = {
  width:'100%', maxWidth:480, background:'var(--surface)',
  borderRadius:14, border:'1px solid var(--border)', padding:'14px',
}
const sectionLabel: React.CSSProperties = {
  fontSize:9, fontWeight:700, letterSpacing:'0.12em',
  color:'var(--muted)', textTransform:'uppercase',
}
const inputSt: React.CSSProperties = {
  background:'var(--bg)', border:'1px solid var(--border)',
  borderRadius:8, padding:'8px 12px', fontSize:13,
  color:'var(--text)', outline:'none',
}
const btnFill: React.CSSProperties = {
  padding:'12px 16px', borderRadius:10, border:'none',
  background:'var(--text)', color:'var(--surface)',
  fontSize:13, fontWeight:700, cursor:'pointer',
}
const btnGhost: React.CSSProperties = {
  padding:'12px 16px', borderRadius:10,
  border:'1px solid var(--border)',
  background:'transparent', color:'var(--text)',
  fontSize:12, fontWeight:600, cursor:'pointer',
}
