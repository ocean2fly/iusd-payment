import { useState, useEffect, useCallback } from 'react'
import { adminHeaders, adminJsonHeaders } from '../lib/adminAuth'
import { API_V1 } from '../lib/config'

interface Sponsor {
  id: string; name: string; logoUrl: string | null; color: string
  link: string | null; description: string | null; active: boolean; createdAt: string
}

const EMPTY: Partial<Sponsor> & { logoUrl: string; color: string; link: string; description: string } = {
  name: '', logoUrl: '', color: '#6d28d9', link: '', description: '',
}

const inputStyle: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', padding: '7px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
}

export default function Sponsors() {
  const [list, setList]           = useState<Sponsor[]>([])
  const [selected, setSelected]   = useState<Sponsor | null>(null)
  const [form, setForm]           = useState({ ...EMPTY })
  const [isNew, setIsNew]         = useState(false)
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState<string | null>(null)
  const [preview, setPreview]     = useState<string>('')
  const [assigning, setAssigning] = useState(false)
  const [assignDone, setAssignDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`${API_V1}/admin/sponsors`, { headers: adminHeaders() })
    const d = await res.json()
    setList(d.sponsors ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Build live preview URL from form fields
  useEffect(() => {
    if (!isNew && !selected) return
    const params = new URLSearchParams()
    if (form.name)    params.set('name', form.name)
    if (form.logoUrl) params.set('logoUrl', form.logoUrl)
    if (form.color)   params.set('color', form.color)
    setPreview(`${API}/admin/sponsors/preview-svg?${params}`)
  }, [form.name, form.logoUrl, form.color, isNew, selected])

  function startNew() {
    setSelected(null); setIsNew(true)
    setForm({ ...EMPTY }); setErr(null); setAssignDone(null)
  }

  function startEdit(s: Sponsor) {
    setSelected(s); setIsNew(false); setAssignDone(null)
    setForm({ name: s.name, logoUrl: s.logoUrl ?? '', color: s.color,
              link: s.link ?? '', description: s.description ?? '' })
    setErr(null)
  }

  async function handleSave() {
    setSaving(true); setErr(null)
    try {
      const body = {
        name: form.name, logoUrl: form.logoUrl || null, color: form.color || '#6d28d9',
        link: form.link || null, description: form.description || null,
      }
      const url = isNew ? `${API}/admin/sponsors` : `${API}/admin/sponsors/${selected!.id}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await fetch(url, { method, headers: adminJsonHeaders(), body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Save failed')
      await load()
      if (isNew) { setIsNew(false); setSelected(d.sponsor) }
    } catch (e: any) { setErr(e.message) }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this sponsor? Any linked gift boxes will lose branding.')) return
    await fetch(`${API_V1}/admin/sponsors/${id}`, { method: 'DELETE', headers: adminHeaders() })
    setSelected(null); setIsNew(false); setForm({ ...EMPTY })
    await load()
  }

  async function handleAssignBox() {
    if (!selected) return
    setAssigning(true); setAssignDone(null)
    const res = await fetch(`${API_V1}/admin/sponsors/${selected.id}/assign-box`, {
      method: 'POST', headers: adminJsonHeaders(), body: JSON.stringify({}),
    })
    const d = await res.json()
    if (res.ok) setAssignDone(d.artworkId)
    setAssigning(false)
  }

  async function toggleActive(s: Sponsor) {
    await fetch(`${API_V1}/admin/sponsors/${s.id}`, {
      method: 'PATCH', headers: adminJsonHeaders(),
      body: JSON.stringify({ active: s.active ? 0 : 1 }),
    })
    await load()
  }

  const col = (hex: string) => hex || '#6d28d9'

  return (
    <div style={{ display:'flex', gap:20, height:'100%' }}>

      {/* ── Left: sponsor list ── */}
      <div style={{ width:280, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#94a3b8', letterSpacing:'0.08em' }}>
            🏪 SPONSORS ({list.length})
          </span>
          <button onClick={startNew} style={{
            background:'#22c55e', color:'#000', border:'none', borderRadius:6,
            padding:'5px 12px', fontSize:12, fontWeight:700, cursor:'pointer',
          }}>+ NEW</button>
        </div>

        {list.length === 0 && (
          <div style={{ color:'#475569', fontSize:12, padding:'20px 0', textAlign:'center' }}>
            No sponsors yet.<br/>Click + NEW to add one.
          </div>
        )}

        {list.map(s => (
          <div key={s.id} onClick={() => startEdit(s)} style={{
            background: selected?.id === s.id ? '#1e293b' : '#0f172a',
            border: `1px solid ${selected?.id === s.id ? col(s.color) : '#1e293b'}`,
            borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* Color swatch / logo */}
            <div style={{
              width: 40, height: 40, borderRadius: 8, flexShrink: 0,
              background: col(s.color), overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {s.logoUrl
                ? <img src={s.logoUrl} style={{ width:'100%', height:'100%', objectFit:'contain' }} />
                : <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>
                    {s.name.slice(0, 1).toUpperCase()}
                  </span>
              }
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {s.name}
              </div>
              <div style={{ fontSize:10, color: s.active ? '#22c55e' : '#64748b', marginTop:2 }}>
                {s.active ? '● Active' : '○ Inactive'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Right: edit panel ── */}
      {(isNew || selected) ? (
        <div style={{ flex:1, display:'flex', gap:20 }}>

          {/* Form */}
          <div style={{ flex:1, background:'#0f172a', borderRadius:12,
                        border:'1px solid #1e293b', padding:20, display:'flex',
                        flexDirection:'column', gap:14, overflowY:'auto' }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#94a3b8', letterSpacing:'0.1em' }}>
              {isNew ? '✦ NEW SPONSOR' : `✦ EDIT — ${selected!.name}`}
            </div>

            <Field label="Brand Name *" value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))} />
            <Field label="Brand Color (hex)" value={form.color}
              onChange={v => setForm(f => ({ ...f, color: v }))}>
              <div style={{ width:24, height:24, borderRadius:4, background: col(form.color),
                            border:'1px solid #334155', flexShrink:0 }} />
            </Field>
            <Field label="Logo URL (PNG/SVG, transparent bg recommended)" value={form.logoUrl ?? ''}
              onChange={v => setForm(f => ({ ...f, logoUrl: v }))} mono />
            <Field label="Landing Link URL (optional)" value={form.link ?? ''}
              onChange={v => setForm(f => ({ ...f, link: v }))} mono />
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Description (optional)</div>
              <textarea value={form.description ?? ''} rows={2}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                style={{ ...inputStyle, resize:'vertical' }} />
            </div>

            {err && <div style={{ color:'#f87171', fontSize:12 }}>⚠ {err}</div>}

            <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
              <button onClick={handleSave} disabled={saving || !form.name} style={{
                flex:1, background:'#6d28d9', color:'white', border:'none', borderRadius:8,
                padding:'10px 0', fontWeight:700, fontSize:13, cursor:'pointer', opacity: saving ? 0.6 : 1,
              }}>{saving ? 'Saving…' : isNew ? 'Create Sponsor' : 'Save Changes'}</button>

              {!isNew && (
                <button onClick={() => handleDelete(selected!.id)} style={{
                  background:'#450a0a', color:'#f87171', border:'1px solid #7f1d1d',
                  borderRadius:8, padding:'10px 14px', fontWeight:700, fontSize:12, cursor:'pointer',
                }}>Delete</button>
              )}
            </div>

            {/* Assign to gift box */}
            {!isNew && (
              <div style={{ borderTop:'1px solid #1e293b', paddingTop:14 }}>
                <div style={{ fontSize:11, color:'#64748b', marginBottom:8 }}>
                  CREATE A BRANDED GIFT BOX FOR THIS SPONSOR
                </div>
                <button onClick={handleAssignBox} disabled={assigning} style={{
                  width:'100%', background:'rgba(34,197,94,0.1)', color:'#22c55e',
                  border:'1px solid #14532d', borderRadius:8, padding:'9px 0',
                  fontWeight:700, fontSize:12, cursor:'pointer',
                }}>
                  {assigning ? 'Creating…' : '🎁 Create Sponsored Gift Box'}
                </button>
                {assignDone && (
                  <div style={{ marginTop:8, fontSize:11, color:'#22c55e' }}>
                    ✅ Box created! ID: <code style={{ fontSize:10 }}>{assignDone}</code>
                    <br/><span style={{ color:'#64748b' }}>Visible in Gift Artworks page → tier: free</span>
                  </div>
                )}
              </div>
            )}

            {/* Toggle active */}
            {!isNew && (
              <button onClick={() => toggleActive(selected!)} style={{
                background:'transparent', color: selected!.active ? '#f59e0b' : '#22c55e',
                border:`1px solid ${selected!.active ? '#78350f' : '#14532d'}`,
                borderRadius:8, padding:'7px 0', fontSize:12, fontWeight:600, cursor:'pointer',
              }}>
                {selected!.active ? '⏸ Deactivate Sponsor' : '▶ Activate Sponsor'}
              </button>
            )}
          </div>

          {/* Live SVG preview */}
          <div style={{ width:220, flexShrink:0 }}>
            <div style={{ fontSize:11, color:'#64748b', marginBottom:8, letterSpacing:'0.08em' }}>
              LIVE PREVIEW
            </div>
            <div style={{ background:'#0f172a', borderRadius:12, border:'1px solid #1e293b',
                          padding:12, display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
              {preview ? (
                <img src={preview} key={preview} alt="preview"
                  style={{ width:196, height:196, borderRadius:8 }} />
              ) : (
                <div style={{ width:196, height:196, borderRadius:8, background:'#1e293b',
                              display:'flex', alignItems:'center', justifyContent:'center',
                              color:'#475569', fontSize:12 }}>
                  fill fields →
                </div>
              )}
              <div style={{ fontSize:10, color:'#475569', textAlign:'center' }}>
                This is how the gift box<br/>will appear to users
              </div>
            </div>

            {/* Color preview */}
            <div style={{ marginTop:12, background:'#0f172a', borderRadius:10,
                          border:'1px solid #1e293b', padding:12 }}>
              <div style={{ fontSize:10, color:'#64748b', marginBottom:8 }}>BRAND PALETTE</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {[form.color, lighten(form.color, 20), darken(form.color, 20)].map((c, i) => (
                  <div key={i} style={{ flex:1, height:28, borderRadius:6, background: c || '#6d28d9',
                                        minWidth:40 }} title={c} />
                ))}
              </div>
              <div style={{ display:'flex', gap:6, marginTop:4 }}>
                {['#fcd34d', '#d97706', '#0f0a1e'].map((c, i) => (
                  <div key={i} style={{ flex:1, height:18, borderRadius:4, background: c }} />
                ))}
              </div>
              <div style={{ fontSize:9, color:'#334155', marginTop:4 }}>
                Box body · Ribbon (always gold) · Background
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                      color:'#334155', fontSize:14, flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:32 }}>🏪</div>
          <div>Select a sponsor or create a new one</div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, value, onChange, mono = false, children }: {
  label: string; value: string; onChange: (v: string) => void
  mono?: boolean; children?: React.ReactNode
}) {
  return (
    <div>
      <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>{label}</div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <input value={value} onChange={e => onChange(e.target.value)}
          style={{ flex:1, background:'#0f172a', border:'1px solid #334155', borderRadius:6,
                   color:'#e2e8f0', padding:'7px 10px', fontSize: mono ? 11 : 13,
                   fontFamily: mono ? 'monospace' : undefined, outline:'none' }} />
        {children}
      </div>
    </div>
  )
}

function lighten(hex: string, amount: number): string {
  try {
    const h = hex.replace('#', '')
    const n = parseInt(h.length === 3 ? h.split('').map(c => c+c).join('') : h, 16)
    const r = Math.min(255, ((n >> 16) & 255) + amount)
    const g = Math.min(255, ((n >> 8) & 255) + amount)
    const b = Math.min(255, (n & 255) + amount)
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')
  } catch { return hex }
}

function darken(hex: string, amount: number): string {
  return lighten(hex, -amount)
}
