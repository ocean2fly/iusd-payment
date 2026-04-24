/**
 * Status.tsx — System Health Monitor
 */
import { useState, useEffect, useCallback } from 'react'
import { adminHeaders } from '../lib/adminAuth'

import { API_ORIGIN } from '../lib/config'

interface ServiceStatus {
  name: string
  status: 'online' | 'offline' | 'error'
  url?: string
  version?: string
  uptime?: string
  lastDeploy?: string
  details?: Record<string, any>
}

interface SystemStatus {
  timestamp: string
  commit?: string
  services: {
    contract: ServiceStatus
    database: ServiceStatus
    backend: ServiceStatus
    admin: ServiceStatus
    relayer: ServiceStatus
    frontend: ServiceStatus
  }
  balances: {
    deployer: string
    relayer: string
    treasury: string
    treasuryIusd: string
  }
  stats: {
    totalPayments: number
    totalVolume: string
    totalFees: string
    pendingPayments: number
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-500',
    offline: 'bg-red-500',
    error: 'bg-yellow-500',
    unknown: 'bg-gray-500'
  }
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${colors[status] || colors.unknown}`}>
      {status}
    </span>
  )
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-white">{service.name}</h3>
        <StatusBadge status={service.status} />
      </div>
      
      <div className="space-y-1 text-sm">
        {service.url && (
          <p className="text-gray-400">
            URL: <a href={service.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{service.url}</a>
          </p>
        )}
        {service.version && (
          <p className="text-gray-400">Version: <span className="text-white">{service.version}</span></p>
        )}
        {service.uptime && (
          <p className="text-gray-400">Uptime: <span className="text-green-400">{service.uptime}</span></p>
        )}
        {service.lastDeploy && (
          <p className="text-gray-400">Last Deploy: <span className="text-white">{new Date(service.lastDeploy).toLocaleString()}</span></p>
        )}
        {service.details && Object.entries(service.details).map(([key, value]) => (
          <p key={key} className="text-gray-400">
            {key}: <span className="text-white font-mono text-xs">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
          </p>
        ))}
      </div>
    </div>
  )
}

function BalanceCard({ label, amount, denom }: { label: string; amount: string; denom: string }) {
  // API returns already-formatted values (e.g. "9.9072"), not micro units
  const num = parseFloat(amount) || 0
  const unit = denom === 'uinit' ? 'INIT' : 'iUSD'

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-xl font-bold text-white">{num.toFixed(2)} {unit}</p>
    </div>
  )
}

export default function Status() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_ORIGIN}/v1/admin/system-status`, { headers: adminHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setStatus(data)
      setError(null)
      setLastRefresh(new Date())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    
    // Auto-refresh every 30 seconds
    if (autoRefresh) {
      const interval = setInterval(fetchStatus, 30000)
      return () => clearInterval(interval)
    }
  }, [fetchStatus, autoRefresh])

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">System Status</h1>
          <p className="text-gray-400 text-sm">
            Last updated: {lastRefresh?.toLocaleString() || 'Never'}
            {status?.commit && <span className="ml-2 font-mono">({status.commit})</span>}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
          Error: {error}
        </div>
      )}

      {status && (
        <>
          {/* Quick Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
              <p className="text-3xl font-bold text-white">{status.stats.totalPayments}</p>
              <p className="text-gray-400 text-sm">Total Payments</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
              <p className="text-3xl font-bold text-green-400">
                {(parseInt(status.stats.totalVolume) / 1_000_000).toFixed(2)}
              </p>
              <p className="text-gray-400 text-sm">Volume (iUSD)</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
              <p className="text-3xl font-bold text-yellow-400">
                {(parseInt(status.stats.totalFees) / 1_000_000).toFixed(2)}
              </p>
              <p className="text-gray-400 text-sm">Fees (iUSD)</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
              <p className="text-3xl font-bold text-blue-400">{status.stats.pendingPayments}</p>
              <p className="text-gray-400 text-sm">Pending</p>
            </div>
          </div>

          {/* Services Grid */}
          <h2 className="text-xl font-semibold text-white mb-4">Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <ServiceCard service={status.services.contract} />
            <ServiceCard service={status.services.database} />
            <ServiceCard service={status.services.backend} />
            <ServiceCard service={status.services.relayer} />
            <ServiceCard service={status.services.admin} />
            <ServiceCard service={status.services.frontend} />
          </div>

          {/* Balances */}
          <h2 className="text-xl font-semibold text-white mb-4">Balances</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <BalanceCard label="Deployer (ipay-v6)" amount={status.balances.deployer} denom="uinit" />
            <BalanceCard label="Relayer" amount={status.balances.relayer} denom="uinit" />
            <BalanceCard label="Treasury (INIT)" amount={status.balances.treasury} denom="uinit" />
            <BalanceCard label="Treasury (iUSD)" amount={status.balances.treasuryIusd} denom="iusd" />
          </div>

          {/* Raw JSON (collapsible) */}
          <details className="mt-6">
            <summary className="text-gray-400 cursor-pointer hover:text-white">Raw JSON</summary>
            <pre className="mt-2 p-4 bg-gray-800 rounded-lg text-xs text-gray-300 overflow-auto max-h-96">
              {JSON.stringify(status, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  )
}
