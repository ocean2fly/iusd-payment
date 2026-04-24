/**
 * Contacts — /app/contacts
 * Minimal phonebook-style UI.
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useAuthContext } from '../hooks/AuthContext'
import { API_BASE } from '../config'
import {
  type Contact,
  loadContactsAsync,
  deleteContactAsync,
  upsertContactAsync,
  fetchCounterpartiesFromActivity,
} from '../lib/contactsStore'
import { showToast } from '../components/Toast'

function privId(id?: string) {
  if (!id || id.length < 8) return id ?? ''
  return `${id.slice(0, 4)}***${id.slice(-4)}`
}

export function Contacts() {
  const { t } = useTranslation()
  const navigate  = useNavigate()
  const smartClose = useSmartClose('/app')
  const { token, account } = useAuthContext()

  const [contacts,   setContacts]   = useState<Contact[]>([])
  const [aliases,    setAliases]    = useState<Record<string, string>>({})
  const [editAlias,  setEditAlias]  = useState<string | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<any[]>([])
  const [searching,  setSearching]  = useState(false)
  const [copied,     setCopied]     = useState<string | null>(null)
  const [importing,  setImporting]  = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load contacts from server — pass shortId directly so the store
  // doesn't rely on the setContactsToken race.
  useEffect(() => {
    if (!account?.shortId || !token) return
    loadContactsAsync(account.shortId, token).then(setContacts).catch(() => {})

    // Load aliases
    fetch(`${API_BASE}/account/contacts/aliases`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.aliases) setAliases(d.aliases) })
      .catch(() => {})
  }, [token, account?.shortId])

  async function saveAlias(shortId: string, alias: string) {
    if (!token) return
    setAliases(prev => ({ ...prev, [shortId]: alias }))
    await fetch(`${API_BASE}/account/contacts/${shortId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ alias }),
    }).catch(() => {})
    setEditAlias(null)
  }

  // Search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || query.trim().length < 2) { setResults([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const q = query.trim().toLowerCase()
      const localMatches = contacts.filter(c => {
        const alias = aliases[c.shortId?.toUpperCase()] ?? ''
        return c.nickname?.toLowerCase().includes(q) || alias.toLowerCase().includes(q) || c.shortId?.toLowerCase().includes(q)
      }).map(c => ({ short_id: c.shortId, nickname: c.nickname, shortSealSvg: c.shortSealSvg ?? null }))

      let serverResults: any[] = []
      try {
        const r = await fetch(`${API_BASE}/account/search?q=${encodeURIComponent(query.trim())}&limit=8`)
        if (r.ok) { const d = await r.json(); serverResults = d?.results ?? [] }
      } catch {}

      const serverIds = new Set(serverResults.map((r: any) => (r.short_id ?? '').toUpperCase()))
      const localOnly = localMatches.filter(m => !serverIds.has((m.short_id ?? '').toUpperCase()))
      setResults([...serverResults, ...localOnly].slice(0, 12))
      setSearching(false)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, contacts, aliases])

  function handleSend(shortId: string) { navigate(`/profile/${shortId}`) }

  function handleRemove(shortId: string) {
    if (!account?.shortId || !token) return
    const uid = shortId.toUpperCase()
    setContacts(prev => prev.filter(c => c.shortId?.toUpperCase() !== uid))
    deleteContactAsync(account.shortId, token, uid).then(fresh => {
      if (fresh.length > 0) setContacts(fresh)
    })
  }

  /**
   * Bulk-import contacts from the user's recent payment + gift activity.
   * For every unique counterparty that isn't already in the contact list,
   * call upsertContactAsync. Then reload once at the end.
   */
  async function handleImportFromHistory() {
    if (!account?.shortId || !token || importing) return
    setImporting(true)
    try {
      const exclude = new Set(contacts.map(c => c.shortId?.toUpperCase() ?? ''))
      const candidates = await fetchCounterpartiesFromActivity(token, { limit: 100, excludeShortIds: exclude })
      if (candidates.length === 0) {
        showToast(t('toast.noNewContactsInHistory'), 'info')
        return
      }
      // Upsert sequentially so the server doesn't get slammed. Errors
      // on a single entry are non-fatal — we continue with the rest.
      let added = 0
      for (const c of candidates) {
        try {
          await upsertContactAsync(account.shortId, token, {
            shortId: c.shortId,
            nickname: c.nickname,
            shortSealSvg: null,
          })
          added++
        } catch { /* skip */ }
      }
      // Refresh full list once after the batch.
      const fresh = await loadContactsAsync(account.shortId, token)
      setContacts(fresh)
      showToast(added > 0 ? t('toast.importedFromHistory', { count: added }) : t('toast.noNewImport'), 'success')
    } catch (e: any) {
      showToast(t('toast.importFailed', { msg: e?.message || 'unknown' }), 'error')
    } finally {
      setImporting(false)
    }
  }

  function handleAddFromSearch(acct: any) {
    if (!account?.shortId || !token) return
    const uid = (acct.shortId ?? acct.short_id ?? '').toUpperCase()
    const nick = acct.nickname ?? uid
    upsertContactAsync(account.shortId, token, { shortId: uid, nickname: nick, shortSealSvg: acct.shortSealSvg ?? null }).then(fresh => {
      if (fresh.length > 0) setContacts(fresh)
    })
    setContacts(prev => prev.some(c => c.shortId?.toUpperCase() === uid) ? prev : [{ shortId: uid, nickname: nick, shortSealSvg: null, addedAt: Date.now() }, ...prev])
    setQuery(''); setResults([])
  }

  const isInContacts = (id: string) => contacts.some(c => c.shortId?.toUpperCase() === id?.toUpperCase())

  function copyId(id: string) {
    navigator.clipboard.writeText(id)
    setCopied(id); setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '24px 16px 100px', gap: 12, boxSizing: 'border-box', maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <button onClick={smartClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted)', fontSize: 18, padding: 0, lineHeight: 1 }}>←</button>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{t('dashboard.actions.contacts')}</span>
        <button
          onClick={handleImportFromHistory}
          disabled={importing}
          title={t('contacts.importFromHistoryTitle')}
          style={{
            fontSize: 10, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
            background: importing ? 'var(--bg-elevated)' : 'var(--surface)',
            border: '1px solid var(--border)',
            color: importing ? 'var(--muted)' : '#22c55e',
            cursor: importing ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          {importing ? '…' : t('contacts.importFromHistory')}
        </button>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{contacts.length}</span>
      </div>

      {/* Search */}
      <div style={{ width: '100%', position: 'relative' }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('contacts.searchPlaceholder')}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10,
                   fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)',
                   color: 'var(--text)', outline: 'none' }} />
        {searching && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                                     fontSize: 11, color: 'var(--muted)' }}>...</span>}
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <div style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 10, overflow: 'hidden' }}>
          {results.map((acct, i) => {
            const sid = acct.shortId ?? acct.short_id ?? ''
            const nick = acct.nickname ?? sid
            const inList = isInContacts(sid)
            return (
              <div key={sid || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                                           borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 10, color: 'var(--muted)', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nick !== sid ? nick : ''}
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400, marginLeft: nick !== sid ? 4 : 0 }}>
                      {nick !== sid ? `@${privId(sid)}` : privId(sid)}
                    </span>
                  </div>
                </div>
                <button onClick={() => handleSend(sid)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                           background: 'var(--text)', color: 'var(--surface)', border: 'none', cursor: 'pointer' }}>
                  Send
                </button>
                {!inList && (
                  <button onClick={() => handleAddFromSearch(acct)}
                    style={{ fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 6,
                             background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                             color: '#22c55e', cursor: 'pointer' }}>
                    +
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {query.length >= 2 && !searching && results.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{t('contacts.noResults')}</div>
      )}

      {/* Contact list */}
      {contacts.length > 0 && (
        <div style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 10, overflow: 'hidden' }}>
          {contacts.map((c, i) => {
            const alias = aliases[c.shortId?.toUpperCase()] ?? ''
            const isEditing = editAlias === c.shortId
            return (
              <div key={c.shortId || i} style={{ borderBottom: i < contacts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px' }}>
                  {/* Index */}
                  <span style={{ fontSize: 10, color: 'var(--muted)', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  {/* Name + ID */}
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => handleSend(c.shortId)}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {alias || (c.nickname && c.nickname !== c.shortId ? c.nickname : '')}
                      {(alias || (c.nickname && c.nickname !== c.shortId)) && (
                        <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400, marginLeft: 4 }}>@{privId(c.shortId)}</span>
                      )}
                      {!alias && (!c.nickname || c.nickname === c.shortId) && (
                        <span style={{ color: 'var(--muted)' }}>{privId(c.shortId)}</span>
                      )}
                    </div>
                    {alias && c.nickname && c.nickname !== c.shortId && alias !== c.nickname && (
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.nickname}</div>
                    )}
                  </div>
                  {/* Copy ID */}
                  <button onClick={() => copyId(c.shortId)} title="Copy ID"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied === c.shortId ? '#22c55e' : 'var(--muted)',
                             padding: 4, flexShrink: 0, display: 'flex' }}>
                    {copied === c.shortId
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>}
                  </button>
                  {/* Edit alias */}
                  <button onClick={() => { setEditAlias(isEditing ? null : c.shortId); setAliasInput(alias) }}
                    title="Edit alias"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)',
                             padding: 4, flexShrink: 0, display: 'flex' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5z"/>
                    </svg>
                  </button>
                  {/* Remove */}
                  <button onClick={() => handleRemove(c.shortId)} title="Remove"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444',
                             padding: 4, flexShrink: 0, display: 'flex' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
                {/* Alias editor */}
                {isEditing && (
                  <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px', alignItems: 'center' }}>
                    <input autoFocus value={aliasInput}
                      onChange={e => setAliasInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveAlias(c.shortId, aliasInput); if (e.key === 'Escape') setEditAlias(null) }}
                      placeholder="Alias (e.g. Dad, Client A)"
                      style={{ flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 12,
                               background: 'var(--bg)', border: '1px solid var(--border)',
                               color: 'var(--text)', outline: 'none' }} />
                    <button onClick={() => saveAlias(c.shortId, aliasInput)}
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                               background: '#22c55e', color: '#fff', border: 'none', cursor: 'pointer' }}>{t('common.save')}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {contacts.length === 0 && query.length < 2 && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 32 }}>
          <div style={{ fontSize: 13 }}>{t('transfer.noContactsYet')}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>{t('contacts.autoSavedHint')}</div>
        </div>
      )}
    </div>
  )
}
