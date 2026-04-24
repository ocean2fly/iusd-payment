/**
 * useConfig Hook
 * 
 * Fetches contract configuration from API on app load.
 * All contract addresses and settings come from here.
 */

import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { API_BASE } from '../config'
import { IUSD_FA, IUSD_DENOM, IUSD_DECIMALS, RPC_URL, REST_URL, CHAIN_ID } from '../networks'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AppConfig {
  // Chain
  chainId: string
  rpcUrl: string
  restUrl: string
  
  // Contract
  contract: {
    address: string         // 0x...
    addressBech32: string   // init1...
  }
  
  // iUSD
  iusd: {
    fa: string
    denom: string
    decimals: number
  }
  
  // Fees
  fee: {
    bps: number
    cap: number
    min: number
  }
  
  // Admin public key (for encryption)
  adminPubKey: string

  // Relayer bech32 address (feegrant granter — pays gas for sponsored txs)
  relayer?: string
}

interface ConfigState {
  config: AppConfig | null
  loading: boolean
  error: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Config (fallback only)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: AppConfig = {
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  restUrl: REST_URL,
  contract: {
    address: '0xDA674F786F6997C00C3530F7D59FA9F2F1CE6CD5',
    addressBech32: '',
  },
  iusd: {
    fa: IUSD_FA,
    denom: IUSD_DENOM,
    decimals: IUSD_DECIMALS,
  },
  fee: {
    bps: 5,
    cap: 5000000,
    min: 1000,
  },
  adminPubKey: '',
}

// ═══════════════════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════════════════

const ConfigContext = createContext<ConfigState>({
  config: null,
  loading: true,
  error: null,
})

// ═══════════════════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════════════════

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigState>({
    config: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function fetchConfig() {
      try {
        const res = await fetch(`${API_BASE}/config`)
        
        if (!res.ok) {
          throw new Error(`Failed to fetch config: ${res.status}`)
        }
        
        const data = await res.json()
        
        if (!cancelled) {
          setState({
            config: data,
            loading: false,
            error: null,
          })
        }
      } catch (err: any) {
        console.warn('[useConfig] Failed to fetch, using defaults:', err.message)
        
        if (!cancelled) {
          // Use default config as fallback
          setState({
            config: DEFAULT_CONFIG,
            loading: false,
            error: err.message,
          })
        }
      }
    }

    fetchConfig()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ConfigContext.Provider value={state}>
      {children}
    </ConfigContext.Provider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════

export function useConfig(): ConfigState {
  return useContext(ConfigContext)
}

/**
 * Get config with guaranteed non-null (throws if not loaded)
 */
export function useRequiredConfig(): AppConfig {
  const { config, loading, error } = useConfig()
  
  if (loading) {
    throw new Error('Config not loaded yet')
  }
  
  if (!config) {
    throw new Error(`Config failed to load: ${error}`)
  }
  
  return config
}

/**
 * Get contract address (most common use case)
 */
export function useContractAddress(): { address: string; bech32: string } | null {
  const { config } = useConfig()
  if (!config?.contract) return null
  return {
    address: config.contract.address,
    bech32: config.contract.addressBech32,
  }
}

export default useConfig
