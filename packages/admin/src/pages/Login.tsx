import { useState } from 'react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { adminLogin } from '../lib/adminAuth'

interface Props { onLogin: (addr: string) => void }

export function Login({ onLogin }: Props) {
  const { address, offlineSigner, openConnect, disconnect } = useInterwovenKit() as any
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  async function handleSign() {
    if (!address || !offlineSigner) return
    setError('')
    setLoading(true)
    try {
      const signMessage = async (msg: string): Promise<string> => {
        if (!offlineSigner || typeof offlineSigner.signMessage !== 'function') {
          throw new Error('Signer unavailable. Please reconnect.')
        }
        const sig = await offlineSigner.signMessage(msg)
        if (!sig) throw new Error('No signature returned')
        const hex = typeof sig === 'string'
          ? (sig.startsWith('0x') ? sig : `0x${sig}`)
          : '0x' + Array.from(sig as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('')
        return hex
      }

      await adminLogin(address, signMessage)
      onLogin(address)
    } catch (e: any) {
      setError(e.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-2xl border border-border bg-card shadow-xl">
        <div className="text-center space-y-1">
          <div className="text-3xl font-bold tracking-tight">iPay Admin</div>
          <div className="text-sm text-muted-foreground">Sign in with your admin wallet</div>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!address ? (
          <button
            onClick={openConnect}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold
                       hover:bg-primary/90 active:scale-95 transition-all"
          >
            Connect Wallet
          </button>
        ) : (
          <div className="space-y-3">
            <div className="text-center text-sm text-muted-foreground truncate">
              {address}
            </div>
            <button
              onClick={handleSign}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold
                         hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? 'Signing...' : 'Sign in'}
            </button>
            <button
              onClick={disconnect}
              className="w-full py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Admin wallet required. Signature proves identity.
        </p>
      </div>
    </div>
  )
}
