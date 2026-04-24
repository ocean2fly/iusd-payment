import { useEffect, useState } from 'react'
import { RefreshCw, Download } from 'lucide-react'

import { API_ORIGIN, EXPLORER_BASE } from '../lib/config'
import { adminHeaders } from '../lib/adminAuth'

interface AuditEntry {
  timestamp: string
  action: string
  actor: string
  target: string
  details: Record<string, unknown>
  txHash?: string
  result: 'success' | 'failure'
  error?: string
}

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ action: '', actor: '' })

  async function loadAuditLog() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (filter.action) params.set('action', filter.action)
      if (filter.actor) params.set('actor', filter.actor)
      
      const res = await fetch(`${API_ORIGIN}/v1/admin/audit-log?${params}`, { headers: adminHeaders() })
      const data = await res.json()
      setEntries(data.entries || [])
    } catch (err) {
      console.error('Failed to load audit log:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAuditLog()
  }, [])

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString()
  }

  function exportCSV() {
    const headers = ['Timestamp', 'Action', 'Target', 'Actor', 'Result', 'TX Hash', 'Error']
    const rows = entries.map(e => [
      e.timestamp,
      e.action,
      e.target,
      e.actor,
      e.result,
      e.txHash || '',
      e.error || '',
    ])
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <div className="flex gap-2">
          <button
            onClick={loadAuditLog}
            className="text-primary hover:text-primary/80 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={exportCSV}
            className="bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded flex items-center gap-2 text-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass rounded-xl border border-border p-4">
        <div className="flex gap-4">
          <div>
            <label className="text-gray-400 text-sm block mb-1">Action</label>
            <select
              value={filter.action}
              onChange={(e) => setFilter({ ...filter, action: e.target.value })}
              className="bg-dark border border-border rounded-lg px-3 py-2 text-white"
            >
              <option value="">All Actions</option>
              <option value="INTERVENE">Intervene</option>
              <option value="EXPIRE_BATCH">Expire Batch</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={loadAuditLog}
              className="bg-primary hover:bg-primary/80 px-4 py-2 rounded-lg font-medium transition"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      {/* Log Table */}
      <div className="glass rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No audit entries</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-dark/80">
              <tr>
                <th className="text-left p-4 text-gray-400">Time</th>
                <th className="text-left p-4 text-gray-400">Action</th>
                <th className="text-left p-4 text-gray-400">Target</th>
                <th className="text-left p-4 text-gray-400">Actor</th>
                <th className="text-left p-4 text-gray-400">Result</th>
                <th className="text-left p-4 text-gray-400">TX</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i} className="border-t border-border hover:bg-white/5">
                  <td className="p-4 text-gray-400 text-xs">
                    {formatDate(entry.timestamp)}
                  </td>
                  <td className="p-4 font-medium">{entry.action}</td>
                  <td className="p-4 font-mono text-xs">
                    {entry.target?.slice(0, 12)}...
                  </td>
                  <td className="p-4 text-gray-400">{entry.actor}</td>
                  <td className={`p-4 ${entry.result === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.result}
                    {entry.error && (
                      <span className="text-xs text-red-400 block">{entry.error}</span>
                    )}
                  </td>
                  <td className="p-4 font-mono text-xs">
                    {entry.txHash ? (
                      <a
                        href={`${EXPLORER_BASE}/tx/${entry.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {entry.txHash.slice(0, 8)}...
                      </a>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
