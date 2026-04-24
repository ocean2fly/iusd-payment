import { useEffect, useState } from 'react'
import { adminHeaders } from '../lib/adminAuth'
import { RefreshCw, Copy, Check, ExternalLink } from 'lucide-react'

import { API_ORIGIN, CHAIN_ID, EXPLORER_BASE as EXPLORER_URL } from '../lib/config'

interface AddressInfo {
  label: string
  address: string
  balance: {
    init: string
    iusd: string
  }
}

interface ContractInfo {
  contract: AddressInfo
  deployer: AddressInfo
  relayer: AddressInfo
  treasury: AddressInfo
}

export function Dashboard() {
  const [info, setInfo] = useState<ContractInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  async function loadInfo() {
    setLoading(true)
    try {
      const res = await fetch(`${API_ORIGIN}/v1/admin/contract/info`, { headers: adminHeaders() })
      if (res.ok) {
        setInfo(await res.json())
      }
    } catch (err) {
      console.error('Failed to load contract info:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInfo()
  }, [])

  function copyAddress(addr: string, key: string) {
    navigator.clipboard.writeText(addr)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  function shortenAddr(addr: string) {
    if (!addr) return '-'
    if (addr.length <= 20) return addr
    return `${addr.slice(0, 10)}...${addr.slice(-8)}`
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading...</div>
  }

  const addresses = info ? [
    { key: 'contract', ...info.contract },
    { key: 'deployer', ...info.deployer },
    { key: 'relayer', ...info.relayer },
    { key: 'treasury', ...info.treasury },
  ] : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">iPay Contract Info</h1>
        <button
          onClick={loadInfo}
          className="text-primary hover:text-primary/80 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Address Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {addresses.map(({ key, label, address, balance }) => (
          <div key={key} className="glass rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-400 text-sm font-medium">{label}</span>
              <a
                href={`${EXPLORER_URL}/accounts/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            
            {/* Address */}
            <div className="flex items-center gap-2 mb-4">
              <span className="font-mono text-sm text-white break-all">
                {shortenAddr(address)}
              </span>
              <button
                onClick={() => copyAddress(address, key)}
                className="text-gray-400 hover:text-white"
              >
                {copied === key ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Balances */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-dark/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">INIT</div>
                <div className="text-lg font-bold text-blue-400">
                  {balance?.init || '0'}
                </div>
              </div>
              <div className="bg-dark/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">iUSD</div>
                <div className="text-lg font-bold text-green-400">
                  {balance?.iusd || '0'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="glass rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold mb-4">Network</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-400">Chain ID:</span>
            <span className="ml-2 font-mono">{CHAIN_ID}</span>
          </div>
          <div>
            <span className="text-gray-400">Network:</span>
            <span className="ml-2">{CHAIN_ID === 'interwoven-1' ? 'Mainnet' : 'Custom'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
