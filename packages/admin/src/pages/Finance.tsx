import { useEffect, useState } from 'react'
import { adminHeaders, adminJsonHeaders } from '../lib/adminAuth'
import { RefreshCw, Send, AlertTriangle, AlertCircle } from 'lucide-react'

import { API_ORIGIN } from '../lib/config'

interface Revenue {
  total: { feesFormatted: string; volumeFormatted: string }
  today: { fees: number }
  week: { fees: number }
  month: { fees: number }
  treasury: string
  treasuryBalance: { formatted: string }
}

interface Deployer {
  address: string
  balance: { init: string }
  lowGasWarning: boolean
}

interface Balances {
  treasury: { address: string; iusd: { micro: number; formatted: string }; init: { micro: number; formatted: string } }
  relayer:  { address: string; init: { micro: number; formatted: string }; threshold: { formatted: string }; low: boolean; critical: boolean }
  checkedAt: string
}

export function Finance() {
  const [revenue, setRevenue]   = useState<Revenue | null>(null)
  const [deployer, setDeployer] = useState<Deployer | null>(null)
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loading, setLoading]   = useState(true)
  const [fundAmount, setFundAmount] = useState('')
  const [funding, setFunding]   = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [revRes, depRes, balRes] = await Promise.all([
        fetch(`${API_ORIGIN}/v1/admin/finance/revenue`, { headers: adminHeaders() }),
        fetch(`${API_ORIGIN}/v1/admin/finance/deployer/balance`, { headers: adminHeaders() }),
        fetch(`${API_ORIGIN}/v1/admin/finance/balances`, { headers: adminHeaders() }), // → /v1/admin/finance/balances
      ])
      setRevenue(await revRes.json())
      setDeployer(await depRes.json())
      setBalances(await balRes.json())
    } catch (err) {
      console.error('Failed to load finance data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function fundDeployer(amount: number) {
    setFunding(true)
    try {
      const res = await fetch(`${API_ORIGIN}/v1/admin/finance/deployer/fund`, {
        method: 'POST',
        headers: adminJsonHeaders(),
        body: JSON.stringify({ amount: Math.floor(amount * 1_000_000).toString() }),
      })
      const data = await res.json()
      if (data.success) {
        alert(`Funded! TX: ${data.txHash}`)
        loadData()
      } else {
        alert(`Failed: ${data.error}`)
      }
    } catch (err) {
      alert(`Error: ${err}`)
    } finally {
      setFunding(false)
      setFundAmount('')
    }
  }

  function formatFees(amount: number) {
    return (amount / 1_000_000).toFixed(2)
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finance</h1>
        <button
          onClick={loadData}
          className="text-primary hover:text-primary/80 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Revenue */}
      <div className="glass rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">💰 Revenue</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-dark/50 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Total Fees</div>
            <div className="text-2xl font-bold text-green-400">
              {revenue?.total.feesFormatted || '0 iUSD'}
            </div>
          </div>
          <div className="bg-dark/50 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Today</div>
            <div className="text-xl font-bold">
              {formatFees(revenue?.today.fees || 0)} iUSD
            </div>
          </div>
          <div className="bg-dark/50 rounded-lg p-4">
            <div className="text-gray-400 text-sm">This Week</div>
            <div className="text-xl font-bold">
              {formatFees(revenue?.week.fees || 0)} iUSD
            </div>
          </div>
          <div className="bg-dark/50 rounded-lg p-4">
            <div className="text-gray-400 text-sm">This Month</div>
            <div className="text-xl font-bold">
              {formatFees(revenue?.month.fees || 0)} iUSD
            </div>
          </div>
        </div>
        
        <div className="mt-4 bg-dark/50 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Treasury</div>
          <div className="font-mono text-xs text-gray-400 mb-1">{revenue?.treasury}</div>
          <div className="text-lg font-bold">{revenue?.treasuryBalance?.formatted || '-'}</div>
        </div>
      </div>

      {/* Live Wallet Balances */}
      <div className={`glass rounded-xl border p-6 ${balances?.relayer.critical ? 'border-red-500' : balances?.relayer.low ? 'border-yellow-500' : 'border-border'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">⚡ Live Wallet Balances</h2>
          {balances?.relayer.critical && (
            <span className="flex items-center gap-1 text-red-400 text-sm font-semibold animate-pulse">
              <AlertCircle size={16}/> CRITICAL: Top up relayer now!
            </span>
          )}
          {!balances?.relayer.critical && balances?.relayer.low && (
            <span className="flex items-center gap-1 text-yellow-400 text-sm font-semibold">
              <AlertTriangle size={16}/> WARNING: Relayer INIT below 500
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Treasury */}
          <div className="bg-dark/50 rounded-lg p-4 space-y-2">
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Treasury (fee collector)</div>
            <div className="font-mono text-xs text-muted-foreground break-all">{balances?.treasury.address}</div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">iUSD (fees collected)</span>
              <span className="font-bold text-green-400">{balances?.treasury.iusd.formatted ?? '—'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">INIT (gas reserve)</span>
              <span className="font-bold">{balances?.treasury.init.formatted ?? '—'}</span>
            </div>
          </div>
          {/* Relayer */}
          <div className={`rounded-lg p-4 space-y-2 ${balances?.relayer.critical ? 'bg-red-500/10' : balances?.relayer.low ? 'bg-yellow-500/10' : 'bg-dark/50'}`}>
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Relayer (gas sponsor)</div>
            <div className="font-mono text-xs text-muted-foreground break-all">{balances?.relayer.address}</div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">INIT balance</span>
              <span className={`font-bold text-lg ${balances?.relayer.critical ? 'text-red-400' : balances?.relayer.low ? 'text-yellow-400' : 'text-green-400'}`}>
                {balances?.relayer.init.formatted ?? '—'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>Alert threshold</span>
              <span>{balances?.relayer.threshold.formatted}</span>
            </div>
            {balances && (
              <div className={`text-xs px-2 py-1 rounded text-center font-medium ${
                balances.relayer.critical ? 'bg-red-500/20 text-red-400' :
                balances.relayer.low      ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-green-500/20 text-green-400'
              }`}>
                {balances.relayer.critical ? '🚨 CRITICAL — sponsor TX will fail' :
                 balances.relayer.low      ? '⚠️ LOW — top up soon' :
                                            '✅ Healthy'}
              </div>
            )}
          </div>
        </div>
        {balances?.checkedAt && (
          <div className="text-xs text-muted-foreground mt-3 text-right">
            Checked: {new Date(balances.checkedAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* Top Up Relayer — manual action */}
      <div className="glass rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-1">⛽ Top Up Relayer</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Send INIT from treasury (contract-owner keyring) → relayer wallet. Keep relayer ≥ 500 INIT.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-dark/50 rounded-lg p-4 space-y-1">
            <div className="text-xs text-muted-foreground font-medium uppercase">From (Treasury)</div>
            <div className="font-mono text-xs break-all">init19qh7s28mj64t393qeh264t46hacu4d6hccqghp</div>
            <div className="text-sm font-bold">{balances?.treasury.init.formatted ?? '—'}</div>
          </div>
          <div className="bg-dark/50 rounded-lg p-4 space-y-1">
            <div className="text-xs text-muted-foreground font-medium uppercase">To (Relayer)</div>
            <div className="font-mono text-xs break-all">init1pccznezkgywfelyylctz5tn28h6x9aw33qhnla</div>
            <div className={`text-sm font-bold ${balances?.relayer.low ? 'text-yellow-400' : 'text-green-400'}`}>
              {balances?.relayer.init.formatted ?? '—'}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <input
            type="number"
            value={fundAmount}
            onChange={(e) => setFundAmount(e.target.value)}
            placeholder="Amount INIT to send"
            className="flex-1 bg-dark border border-border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={() => fundAmount && fundDeployer(parseFloat(fundAmount))}
            disabled={funding || !fundAmount}
            className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {funding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          {[100, 300, 500].map((amount) => (
            <button key={amount} onClick={() => fundDeployer(amount)} disabled={funding}
              className="bg-muted hover:bg-muted/80 px-3 py-1 rounded text-xs disabled:opacity-50">
              +{amount} INIT
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
