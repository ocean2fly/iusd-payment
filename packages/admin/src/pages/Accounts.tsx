import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Search, Trash2, ChevronLeft, ChevronRight, AlertCircle, Link } from 'lucide-react'
import { adminHeaders, adminJsonHeaders } from '../lib/adminAuth'

import { API_ORIGIN, EXPLORER_BASE } from '../lib/config'

interface AdminAccount {
  id: number
  short_id: string
  nickname: string
  checksum?: string
  created_at: string
  updated_at?: string
  deleted: number
  deleted_at?: string
  frozen_at?: string
  realAddress?: string
  dbPaymentCount?: number
  chainPaymentIds?: string[]
  chainPaymentCount?: number
  incomingIntents?: { payment_id: string; sender_short_id: string; amount_micro: string; created_at: string }[]
  avatar_svg?: string
}

export function Accounts() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<AdminAccount[]>([])
  const [total, setTotal]       = useState(0)
  const [offset, setOffset]     = useState(0)
  const [loading, setLoading]   = useState(false)
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<AdminAccount | null>(null)
  const [error, setError]       = useState('')
  const [deleting, setDeleting]       = useState('')
  const [freezeLoading, setFreezeLoading] = useState('')
  const [freezeError, setFreezeError]     = useState('')
  const LIMIT = 20

  async function fetchList(off = 0) {
    setLoading(true); setError('')
    try {
      const url = query.trim().length >= 2
        ? `${API_ORIGIN}/v1/admin/accounts/search?q=${encodeURIComponent(query)}`
        : `${API_ORIGIN}/v1/admin/accounts?limit=${LIMIT}&offset=${off}`
      const data = await fetch(url, { headers: adminHeaders() }).then(r => r.json())
      setAccounts(data.accounts ?? [])
      setTotal(data.total ?? data.accounts?.length ?? 0)
      setOffset(off)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function fetchDetail(shortId: string) {
    try {
      const data = await fetch(`${API_ORIGIN}/v1/admin/accounts/${shortId}`, { headers: adminHeaders() }).then(r => r.json())
      setSelected(data.account)
    } catch {}
  }


  async function restore(shortId: string) {
    if (!confirm(`Restore account ${shortId}?`)) return
    try {
      await fetch(`${API_ORIGIN}/v1/admin/accounts/${shortId}/restore`, { method: 'POST', headers: adminHeaders() })
      fetchList(offset)
      if (selected?.short_id === shortId) fetchDetail(shortId)
    } catch {}
  }


  async function freeze(shortId: string) {
    setFreezeLoading(shortId)
    setFreezeError('')
    try {
      const res = await fetch(`${API_ORIGIN}/v1/admin/accounts/${shortId}/freeze`, {
        method: 'POST',
        headers: adminJsonHeaders(),
        body: JSON.stringify({ reason: 'admin action' }),
      })
      const data = await res.json()
      if (!res.ok) { setFreezeError(data.error + (data.detail ? ': ' + data.detail : '')); return }
      fetchList(offset)
      if (selected?.short_id === shortId) fetchDetail(shortId)
    } catch (e: any) { setFreezeError(e.message) }
    finally { setFreezeLoading('') }
  }

  async function unfreeze(shortId: string) {
    setFreezeLoading(shortId)
    setFreezeError('')
    try {
      const res = await fetch(`${API_ORIGIN}/v1/admin/accounts/${shortId}/unfreeze`, {
        method: 'POST',
        headers: adminHeaders(),
      })
      const data = await res.json()
      if (!res.ok) { setFreezeError(data.error + (data.detail ? ': ' + data.detail : '')); return }
      fetchList(offset)
      if (selected?.short_id === shortId) fetchDetail(shortId)
    } catch (e: any) { setFreezeError(e.message) }
    finally { setFreezeLoading('') }
  }

  async function softDelete(shortId: string) {
    if (!confirm(`Soft-delete account ${shortId}?`)) return
    setDeleting(shortId)
    try {
      await fetch(`${API_ORIGIN}/v1/admin/accounts/${shortId}`, { method: 'DELETE', headers: adminHeaders() })
      fetchList(offset)
      if (selected?.short_id === shortId) setSelected(null)
    } finally { setDeleting('') }
  }

  useEffect(() => { fetchList(0) }, [])

  const pages = Math.ceil(total / LIMIT)
  const page  = Math.floor(offset / LIMIT)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="text-primary" size={22} />
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-sm text-muted-foreground">{total} registered users</p>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search by nickname or Short ID…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchList(0)}
          />
        </div>
        <button onClick={() => fetchList(0)}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
          Search
        </button>
      </div>

      {error && <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle size={14}/>{error}</div>}

      <div className="flex gap-6">
        {/* Click backdrop to close detail */}
        {selected && (
          <div className="fixed inset-0 z-10" onClick={() => setSelected(null)} />
        )}
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Nickname</th>
                <th className="pb-2 pr-4 font-medium">Short ID</th>
                <th className="pb-2 pr-4 font-medium">Registered</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No accounts found</td></tr>
              ) : accounts.map(acc => (
                <tr key={acc.short_id}
                  onClick={() => fetchDetail(acc.short_id)}
                  className={`border-b border-border/40 cursor-pointer hover:bg-muted/30 transition-colors
                    ${selected?.short_id === acc.short_id ? 'bg-muted/50' : ''}
                    ${acc.deleted ? 'opacity-40' : ''}`}>
                  <td className="py-2 pr-4 font-medium">{acc.nickname}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {acc.short_id?.slice(0,4)} ◆◆◆ [{acc.short_id?.slice(-4)}]
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {acc.created_at ? new Date(acc.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {acc.deleted
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">deleted</span>
                      : acc.frozen_at
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-500">frozen</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-600">active</span>
                    }
                  </td>
                  <td className="py-2">
                    {acc.deleted ? (
                      <button onClick={e => { e.stopPropagation(); restore(acc.short_id) }}
                        className="p-1 rounded hover:bg-green-500/10 text-green-600/60 hover:text-green-600 transition-colors text-xs"
                        title="Restore">
                        ↩
                      </button>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); softDelete(acc.short_id) }}
                        disabled={deleting === acc.short_id}
                        className="p-1 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors"
                        title="Soft delete">
                        <Trash2 size={13}/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!query && pages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>Page {page + 1} of {pages}</span>
              <div className="flex gap-2">
                <button onClick={() => fetchList(Math.max(0, offset - LIMIT))} disabled={offset === 0}
                  className="p-1 rounded hover:bg-muted disabled:opacity-30"><ChevronLeft size={16}/></button>
                <button onClick={() => fetchList(offset + LIMIT)} disabled={page >= pages - 1}
                  className="p-1 rounded hover:bg-muted disabled:opacity-30"><ChevronRight size={16}/></button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="relative z-20 w-80 flex-shrink-0 glass border border-border rounded-xl p-4 space-y-4 h-fit max-h-screen overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Account Detail</h3>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
            </div>

            {selected.avatar_svg && (
              <div className="rounded-lg overflow-hidden border border-border"
                dangerouslySetInnerHTML={{ __html: selected.avatar_svg }}/>
            )}

            <div className="space-y-2 text-xs">
              <Row label="Nickname"   value={selected.nickname} />
              <Row label="Short ID"   value={`${selected.short_id?.slice(0,4)} ◆◆◆ [${selected.short_id?.slice(-4)}]`} mono />
              <Row label="Checksum"   value={selected.checksum || '—'} mono />
              <Row label="Status"     value={selected.deleted ? '🔴 deleted' : selected.frozen_at ? '🟠 frozen' : '🟢 active'} />
              {selected.frozen_at && <Row label="Frozen at" value={new Date(selected.frozen_at).toLocaleString()} />}
              <Row label="Registered" value={selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'} />
              {selected.deleted_at && <Row label="Deleted at" value={new Date(selected.deleted_at).toLocaleString()} />}
            </div>

            {/* Real Address (audit) */}
            <div className="pt-2 border-t border-border space-y-1">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Audit Info</div>
              {selected.realAddress ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Real address</div>
                  <div className="font-mono text-xs break-all bg-muted/30 rounded p-2 select-all">
                    {selected.realAddress}
                  </div>
                  <a href={`${EXPLORER_BASE}/address/${selected.realAddress}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Link size={10}/> View on Explorer
                  </a>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">Address encrypted (ENC_KEY not set)</div>
              )}
            </div>

            {/* Payments summary */}
            <div className="pt-2 border-t border-border space-y-2">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Payments</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="font-semibold text-base">{selected.chainPaymentCount ?? 0}</div>
                  <div className="text-muted-foreground">Sent (chain)</div>
                </div>
                <div className="bg-muted/30 rounded p-2 text-center">
                  <div className="font-semibold text-base">{selected.incomingIntents?.length ?? 0}</div>
                  <div className="text-muted-foreground">Received (intent)</div>
                </div>
              </div>

              {/* Chain payment IDs */}
              {selected.chainPaymentIds && selected.chainPaymentIds.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Sent payment IDs:</div>
                  {selected.chainPaymentIds.slice(0, 5).map(pid => (
                    <a key={pid} href={`/payments?type=id&q=${pid}`}
                      className="block font-mono text-xs text-primary hover:underline truncate"
                      onClick={e => { e.preventDefault(); window.location.href = `/payments?type=id&q=${pid}` }}>
                      {pid.slice(0,16)}…
                    </a>
                  ))}
                  {selected.chainPaymentIds.length > 5 && (
                    <div className="text-xs text-muted-foreground">+{selected.chainPaymentIds.length - 5} more</div>
                  )}
                </div>
              )}

              {/* Incoming intents */}
              {selected.incomingIntents && selected.incomingIntents.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Received payments:</div>
                  {selected.incomingIntents.slice(0, 5).map(p => (
                    <div key={p.payment_id} className="text-xs bg-muted/20 rounded p-1.5">
                      <div className="font-mono text-muted-foreground">{p.payment_id.slice(0,12)}…</div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">from {p.sender_short_id?.slice(0,8)}</span>
                        <span className="font-medium">{p.amount_micro ? (parseInt(p.amount_micro)/1e6).toFixed(3) : '?'} iUSD</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              <button
                onClick={() => navigate(`/payments?type=address&q=${encodeURIComponent(selected.realAddress ?? selected.short_id)}`)}
                className="w-full text-xs py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                Search Payments →
              </button>
              {!selected.deleted ? (
                <button onClick={() => softDelete(selected.short_id)} disabled={!!deleting}
                  className="w-full text-xs py-1.5 rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors">
                  Soft Delete Account
                </button>
              ) : (
                <button onClick={() => restore(selected.short_id)}
                  className="w-full text-xs py-1.5 rounded-lg border border-green-500/40 text-green-600 hover:bg-green-500/10 transition-colors">
                  ↩ Restore Account
                </button>
              )}
              {/* Chain ops: signed server-side using the @ipay admin key */}
              <div className="text-xs text-muted-foreground px-1 pb-1 flex items-center gap-1">
                <span>🔑</span>
                <span>Chain tx signed by <span className="font-mono text-foreground/70">admin</span> key (server-hosted)</span>
              </div>
              {freezeError && (
                <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{freezeError}</div>
              )}
              {!selected.frozen_at ? (
                <button
                  onClick={() => freeze(selected.short_id)}
                  disabled={freezeLoading === selected.short_id}
                  className="w-full text-xs py-1.5 rounded-lg border border-orange-500/40 text-orange-500 hover:bg-orange-500/10 transition-colors disabled:opacity-50">
                  {freezeLoading === selected.short_id ? 'Freezing on-chain…' : '🧊 Freeze (admin signs on-chain)'}
                </button>
              ) : (
                <button
                  onClick={() => unfreeze(selected.short_id)}
                  disabled={freezeLoading === selected.short_id}
                  className="w-full text-xs py-1.5 rounded-lg border border-blue-400/40 text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50">
                  {freezeLoading === selected.short_id ? 'Unfreezing on-chain…' : '🔓 Unfreeze (admin signs on-chain)'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
