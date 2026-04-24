import { useState, useEffect } from 'react'
import { adminHeaders, adminJsonHeaders } from '../lib/adminAuth'
import { Search, RefreshCw, Eye, AlertTriangle, ArrowDownToLine, RotateCcw, Ban, Clock, CheckCircle, XCircle, Copy } from 'lucide-react'

import { API_ORIGIN } from '../lib/config'

// Status codes from contract
const STATUS_MAP: Record<number, string> = {
  0: 'created',
  1: 'processing',
  2: 'pending_claim',
  3: 'confirmed',
  4: 'rejected',
  5: 'revoked',
  6: 'refunded',
  7: 'expired',
  99: 'intervened',
}

const STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-500/20 text-gray-300',
  processing: 'bg-blue-500/20 text-blue-300',
  pending_claim: 'bg-yellow-500/20 text-yellow-300',
  confirmed: 'bg-green-500/20 text-green-300',
  rejected: 'bg-red-500/20 text-red-300',
  revoked: 'bg-orange-500/20 text-orange-300',
  refunded: 'bg-blue-500/20 text-blue-300',
  expired: 'bg-gray-600/20 text-gray-400',
  intervened: 'bg-purple-500/20 text-purple-300',
}

interface Payment {
  payment_id: string
  status: number | string
  amount: string
  fee?: string
  sender?: string
  recipient?: string
  sender_nickname?: string
  recipient_nickname?: string
  sender_short_id?: string
  recipient_short_id?: string
  sender_cooked?: string
  recipient_cooked?: string
  claim_key_hash?: string
  refund_key_hash?: string
  created_at: string
  expires_at: string
  claimed_by?: string
  claimed_at?: string
  source?: string
  tx_hash?: string
  version?: string  // v1 or v2
}

export function Payments() {
  // Read URL params for deep-link from Accounts page
  const urlParams = new URLSearchParams(window.location.search)
  const initQuery = urlParams.get('q') ?? ''
  const initType  = urlParams.get('type') ?? 'id'

  const [query, setQuery] = useState(initQuery)
  const [searchType, setSearchType] = useState(initType)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Auto-search when navigated from Accounts with ?q= param
  useEffect(() => {
    if (initQuery.trim()) searchWith(initQuery, initType)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function searchWith(q: string, type: string) {
    if (!q.trim()) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_ORIGIN}/v1/admin/payments/search?q=${encodeURIComponent(q)}&type=${type}`,
        { headers: adminHeaders() }
      )
      const data = await res.json()
      setPayments(data.orders || data.payments || [])
    } catch (err) { console.error('Search failed:', err) }
    finally { setLoading(false) }
  }

  async function search() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_ORIGIN}/v1/admin/payments/search?q=${encodeURIComponent(query)}&type=${searchType}`,
        { headers: adminHeaders() }
      )
      const data = await res.json()
      // API returns 'orders' field
      setPayments(data.orders || data.payments || [])
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setLoading(false)
    }
  }

  async function intervene(paymentId: string, action: string, reason: string) {
    setActionLoading(true)
    try {
      const res = await fetch(`${API_ORIGIN}/v1/admin/payments/${paymentId}/intervene`, {
        method: 'POST',
        headers: adminJsonHeaders(),
        body: JSON.stringify({ action, reason }),
      })
      const data = await res.json()
      if (data.success) {
        alert(`✅ ${action} successful!\n\nTx: ${data.txHash || 'pending'}`)
        search() // Refresh
        setSelectedPayment(null)
      } else {
        alert(`❌ Failed: ${data.error}`)
      }
    } catch (err) {
      alert(`Error: ${err}`)
    } finally {
      setActionLoading(false)
    }
  }

  function getStatusName(status: number | string): string {
    if (typeof status === 'number') {
      return STATUS_MAP[status] || `unknown(${status})`
    }
    return status
  }

  function formatAmount(amount: string) {
    return (parseInt(amount || '0') / 1_000_000).toFixed(2)
  }

  function formatDate(dateStr: string) {
    if (!dateStr || dateStr === '1970-01-01T00:00:00.000Z') return '-'
    return new Date(dateStr).toLocaleString()
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    // Could add toast notification here
  }

  function isExpired(expiresAt: string): boolean {
    return new Date(expiresAt) < new Date()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Payments</h1>
        <span className="text-sm text-gray-400">
          Admin Panel — Payment Management
        </span>
      </div>

      {/* Search */}
      <div className="glass rounded-xl border border-border p-6">
        <div className="flex gap-2">
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="bg-dark border border-border rounded-lg px-3 py-2 text-white"
          >
            <option value="id">Payment ID</option>
            <option value="address">All by Address (sender+recipient)</option>
            <option value="sender">Sender Address only</option>
            <option value="recipient">Recipient Address only</option>
          </select>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Enter full payment ID (64 hex chars) or address..."
            className="flex-1 bg-dark border border-border rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono text-sm"
          />
          <button
            onClick={search}
            disabled={loading}
            className="bg-primary hover:bg-primary/80 px-6 py-2 rounded-lg font-medium transition flex items-center gap-2"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Tip: For Payment ID, enter the full 64-character hex string for exact match
        </p>
      </div>

      {/* Results */}
      {payments.length > 0 && (
        <div className="glass rounded-xl border border-border overflow-hidden">
          <div className="bg-dark/80 px-4 py-3 border-b border-border">
            <span className="text-sm text-gray-400">Found {payments.length} payment(s)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-dark/50">
              <tr>
                <th className="text-left p-4 text-gray-400 font-medium">Payment ID</th>
                <th className="text-left p-4 text-gray-400 font-medium">Status</th>
                <th className="text-left p-4 text-gray-400 font-medium">Amount</th>
                <th className="text-left p-4 text-gray-400 font-medium">Created</th>
                <th className="text-left p-4 text-gray-400 font-medium">Expires</th>
                <th className="text-left p-4 text-gray-400 font-medium">Source</th>
                <th className="text-left p-4 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const statusName = getStatusName(payment.status)
                const expired = isExpired(payment.expires_at)
                return (
                  <tr key={payment.payment_id} className="border-t border-border hover:bg-white/5 transition">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">
                          {payment.payment_id?.slice(0, 8)}...{payment.payment_id?.slice(-8)}
                        </span>
                        <button
                          onClick={() => copyToClipboard(payment.payment_id)}
                          className="text-gray-500 hover:text-white"
                          title="Copy full ID"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[statusName] || 'bg-gray-500/20'}`}>
                        {statusName}
                      </span>
                    </td>
                    <td className="p-4 font-medium">{formatAmount(payment.amount)} iUSD</td>
                    <td className="p-4 text-gray-400 text-xs">{formatDate(payment.created_at)}</td>
                    <td className={`p-4 text-xs ${expired ? 'text-red-400' : 'text-gray-400'}`}>
                      {formatDate(payment.expires_at)}
                      {expired && <span className="ml-1">⚠️</span>}
                    </td>
                    <td className="p-4">
                      <span className={`text-xs ${payment.source === 'chain' ? 'text-green-400' : 'text-gray-400'}`}>
                        {payment.source || 'db'}
                      </span>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => setSelectedPayment(payment)}
                        className="flex items-center gap-1 text-primary hover:text-primary/80 text-sm font-medium"
                      >
                        <Eye className="w-4 h-4" />
                        Details
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* No Results */}
      {payments.length === 0 && query && !loading && (
        <div className="glass rounded-xl border border-border p-8 text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-yellow-400" />
          <p className="text-gray-400">No payments found for this query</p>
          <p className="text-sm text-gray-500 mt-2">
            Make sure you're using the correct search type and full ID
          </p>
        </div>
      )}

      {/* Payment Detail Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="glass rounded-xl border border-border p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Payment Details</h3>
              <button
                onClick={() => setSelectedPayment(null)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
            </div>
            
            {/* Status Badge */}
            <div className="mb-6">
              <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${STATUS_COLORS[getStatusName(selectedPayment.status)]}`}>
                {getStatusName(selectedPayment.status).toUpperCase()}
              </span>
              {selectedPayment.source === 'chain' && (
                <span className="ml-2 px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs">
                  On-Chain
                </span>
              )}
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm mb-6">
              <div className="space-y-4">
                <div>
                  <span className="text-gray-400 text-xs uppercase">Payment ID</span>
                  <div className="font-mono text-xs break-all mt-1 flex items-center gap-2">
                    {selectedPayment.payment_id}
                    <button onClick={() => copyToClipboard(selectedPayment.payment_id)} className="text-gray-500 hover:text-white">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 text-xs uppercase">Amount</span>
                  <div className="text-2xl font-bold mt-1">
                    {formatAmount(selectedPayment.amount)} iUSD
                    {selectedPayment.fee && parseFloat(selectedPayment.fee) > 0 && (
                      <span className="text-sm text-gray-500 ml-2">
                        (fee: {formatAmount(selectedPayment.fee)})
                      </span>
                    )}
                  </div>
                </div>
                {selectedPayment.version && (
                  <div>
                    <span className="text-gray-400 text-xs uppercase">Version</span>
                    <div className={`mt-1 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      selectedPayment.version === 'v2' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {selectedPayment.version.toUpperCase()}
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-gray-400 text-xs uppercase">Created</span>
                  <div className="mt-1">{formatDate(selectedPayment.created_at)}</div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <span className="text-gray-400 text-xs uppercase">Sender</span>
                  {(selectedPayment.sender_nickname || selectedPayment.sender_short_id) && (
                    <div className="text-xs mt-1 text-gray-300">
                      {selectedPayment.sender_nickname ?? '—'}
                      {selectedPayment.sender_short_id && (
                        <span className="text-gray-500 ml-2 font-mono">@{selectedPayment.sender_short_id}</span>
                      )}
                    </div>
                  )}
                  <div className="font-mono text-xs mt-1 break-all text-green-400">
                    {selectedPayment.sender ?? <span className="text-gray-500">— (no DB record)</span>}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 text-xs uppercase">Recipient</span>
                  {(selectedPayment.recipient_nickname || selectedPayment.recipient_short_id) && (
                    <div className="text-xs mt-1 text-gray-300">
                      {selectedPayment.recipient_nickname ?? '—'}
                      {selectedPayment.recipient_short_id && (
                        <span className="text-gray-500 ml-2 font-mono">@{selectedPayment.recipient_short_id}</span>
                      )}
                    </div>
                  )}
                  <div className="font-mono text-xs mt-1 break-all text-green-400">
                    {selectedPayment.recipient ?? <span className="text-gray-500">— (no DB record)</span>}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400 text-xs uppercase">Expires</span>
                  <div className={`mt-1 ${isExpired(selectedPayment.expires_at) ? 'text-red-400' : ''}`}>
                    {formatDate(selectedPayment.expires_at)}
                    {isExpired(selectedPayment.expires_at) && ' (EXPIRED)'}
                  </div>
                </div>
                {selectedPayment.claimed_by && selectedPayment.claimed_by !== '0x0' && (
                  <div>
                    <span className="text-gray-400 text-xs uppercase">Claimed By</span>
                    <div className="font-mono text-xs mt-1 break-all">
                      {selectedPayment.claimed_by}
                      {selectedPayment.recipient && 
                       selectedPayment.claimed_by.toLowerCase() !== selectedPayment.recipient.toLowerCase() && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 text-[10px]">
                          DIFFERENT ADDRESS
                        </span>
                      )}
                    </div>
                    {selectedPayment.claimed_at && (
                      <div className="text-xs text-gray-500 mt-1">{formatDate(selectedPayment.claimed_at)}</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Admin Actions */}
            <div className="border-t border-border pt-6">
              <h4 className="text-sm text-gray-400 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Admin Actions
              </h4>
              
              <div className="grid grid-cols-2 gap-3">
                {/* Refund to Sender */}
                <button
                  onClick={() => {
                    if (confirm('Refund this payment to sender?\n\nThis will return funds to the original sender.')) {
                      const reason = prompt('Reason for refund:') || 'Admin initiated refund'
                      intervene(selectedPayment.payment_id, 'refund', reason)
                    }
                  }}
                  disabled={actionLoading || getStatusName(selectedPayment.status) === 'refunded'}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-medium transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  Refund to Sender
                </button>

                {/* Withdraw to Treasury */}
                <button
                  onClick={() => {
                    if (confirm('Withdraw this payment to treasury?\n\nThis will move funds to the protocol treasury.')) {
                      const reason = prompt('Reason for withdrawal:') || 'Admin initiated withdrawal'
                      intervene(selectedPayment.payment_id, 'withdraw', reason)
                    }
                  }}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-medium transition"
                >
                  <ArrowDownToLine className="w-4 h-4" />
                  Withdraw to Treasury
                </button>

                {/* Force Confirm */}
                <button
                  onClick={() => {
                    if (confirm('Force confirm this payment?\n\nThis will mark the payment as confirmed.')) {
                      const reason = prompt('Reason for confirmation:') || 'Admin force confirm'
                      intervene(selectedPayment.payment_id, 'confirm', reason)
                    }
                  }}
                  disabled={actionLoading || getStatusName(selectedPayment.status) === 'confirmed'}
                  className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-medium transition"
                >
                  <CheckCircle className="w-4 h-4" />
                  Force Confirm
                </button>

                {/* Reject */}
                <button
                  onClick={() => {
                    if (confirm('Reject this payment?\n\nThis will reject the payment.')) {
                      const reason = prompt('Reason for rejection:') || 'Admin rejected'
                      intervene(selectedPayment.payment_id, 'reject', reason)
                    }
                  }}
                  disabled={actionLoading || getStatusName(selectedPayment.status) === 'rejected'}
                  className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-medium transition"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>

                {/* Force Expire */}
                <button
                  onClick={() => {
                    if (confirm('Force expire this payment?\n\nThis will mark the payment as expired.')) {
                      const reason = prompt('Reason for expiry:') || 'Admin force expire'
                      intervene(selectedPayment.payment_id, 'expire', reason)
                    }
                  }}
                  disabled={actionLoading || getStatusName(selectedPayment.status) === 'expired'}
                  className="flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-medium transition"
                >
                  <Clock className="w-4 h-4" />
                  Force Expire
                </button>

                {/* Ban/Freeze */}
                <button
                  onClick={() => {
                    if (confirm('Freeze this payment?\n\nThis will intervene and freeze the payment for investigation.')) {
                      const reason = prompt('Reason for freeze:') || 'Admin freeze - investigation'
                      intervene(selectedPayment.payment_id, 'freeze', reason)
                    }
                  }}
                  disabled={actionLoading || getStatusName(selectedPayment.status) === 'intervened'}
                  className="flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 rounded-lg font-medium transition"
                >
                  <Ban className="w-4 h-4" />
                  Freeze (Intervene)
                </button>
              </div>

              {actionLoading && (
                <div className="mt-4 text-center text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin inline mr-2" />
                  Processing action...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
