/**
 * DemoWallet — 1:1 copy of InterwovenKit official vite example.
 * https://github.com/initia-labs/interwovenkit/tree/main/examples/vite
 *
 * No modifications. If this page works, our IK integration is correct.
 */
import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useInterwovenKit, MAINNET } from '@initia/interwovenkit-react'
import { IUSD_DENOM } from '../networks'

// ── data (from example/src/data.ts) ─────────────────────────────────────
const chainId = MAINNET.defaultChainId

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    return () => document.documentElement.removeAttribute('data-theme')
  }, [theme])
  return { theme, toggle: () => setTheme(t => t === 'dark' ? 'light' : 'dark') }
}

function truncAddr(s: string, len = 8) {
  if (s.length <= len * 2 + 3) return s
  return `${s.slice(0, len)}...${s.slice(-len)}`
}

// ── Connection ──────────────────────────────────────────────────────────
function Connection() {
  const { address, username, openWallet, openConnect } = useInterwovenKit()
  if (!address) return <button style={connBtn} onClick={openConnect}>Connect</button>
  return <button style={connBtn} onClick={openWallet}>{truncAddr(username ?? address)}</button>
}

// ── Deposit buttons (iUSD / INIT / USDC) ────────────────────────────────
function DepositIusd() {
  const { address, openDeposit } = useInterwovenKit()
  if (!address) return null
  return (
    <button style={outBtn} onClick={() => openDeposit({
      denoms: [IUSD_DENOM],
      chainId: 'interwoven-1',
    })}>Deposit iUSD</button>
  )
}

function DepositInit() {
  const { address, openDeposit } = useInterwovenKit()
  if (!address) return null
  return (
    <button style={outBtn} onClick={() => openDeposit({
      denoms: ['uinit'],
      chainId: 'interwoven-1',
    })}>Deposit INIT</button>
  )
}

function DepositUsdc() {
  const { address, openDeposit } = useInterwovenKit()
  if (!address) return null
  return (
    <button style={outBtn} onClick={() => openDeposit({
      denoms: ['ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4'],
      chainId: 'interwoven-1',
    })}>Deposit USDC</button>
  )
}

// ── Withdraw ────────────────────────────────────────────────────────────
function Withdraw() {
  const { address, openWithdraw } = useInterwovenKit()
  if (!address) return null
  return (
    <button style={outBtn} onClick={() => openWithdraw({
      denoms: [
        'uinit',
        'ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4',
        'move/edfcddacac79ab86737a1e9e65805066d8be286a37cb94f4884b892b0e39f954',
        IUSD_DENOM,
      ],
      chainId: 'interwoven-1',
    })}>Withdraw</button>
  )
}

// ── Bridge ──────────────────────────────────────────────────────────────
function Bridge() {
  const { address, openBridge } = useInterwovenKit()
  if (!address) return null
  return <button style={outBtn} onClick={() => openBridge()}>Bridge</button>
}

// ── ToggleAutoSign ──────────────────────────────────────────────────────
function ToggleAutoSign() {
  const { autoSign, address } = useInterwovenKit()
  const enable = useMutation({ mutationFn: () => autoSign.enable(chainId), onError: (e) => window.alert(e) })
  const disable = useMutation({ mutationFn: () => autoSign.disable(chainId), onError: (e) => window.alert(e) })
  if (!address) return null

  if (autoSign.isEnabledByChain[chainId]) {
    return <button style={outBtn} onClick={() => disable.mutate()} disabled={autoSign.isLoading || disable.isPending}>Disable auto sign</button>
  }
  return <button style={outBtn} onClick={() => enable.mutate()} disabled={autoSign.isLoading || enable.isPending}>Enable auto sign</button>
}

// ── Send form (simplified — no react-hook-form) ────────────────────────
function Send() {
  const { initiaAddress, requestTxBlock } = useInterwovenKit()
  const [denom, setDenom] = useState('uinit')
  const [amount, setAmount] = useState('1000000')
  const [recipient, setRecipient] = useState('')
  const [memo, setMemo] = useState('')

  useEffect(() => { setRecipient(initiaAddress) }, [initiaAddress])

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async () => {
      const messages = [{
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: initiaAddress,
          toAddress: recipient,
          amount: [{ amount, denom }],
        },
      }]
      const { transactionHash } = await requestTxBlock({ messages, memo })
      return transactionHash
    },
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutate() }} style={formStyle}>
      <h2 style={{ fontSize: '1.5rem', margin: 0, textAlign: 'center' }}>Send</h2>
      <div style={{ display: 'grid' }}>
        <label style={labelStyle}>Denom</label>
        <input style={inputStyle} value={denom} onChange={e => setDenom(e.target.value)} />
      </div>
      <div style={{ display: 'grid' }}>
        <label style={labelStyle}>Amount</label>
        <input style={inputStyle} value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div style={{ display: 'grid' }}>
        <label style={labelStyle}>Recipient</label>
        <input style={inputStyle} value={recipient} onChange={e => setRecipient(e.target.value)} />
      </div>
      <div style={{ display: 'grid' }}>
        <label style={labelStyle}>Memo</label>
        <input style={inputStyle} value={memo} onChange={e => setMemo(e.target.value)} />
      </div>
      <button type="submit" style={submitBtn} disabled={isPending}>Submit</button>
      {error && <p style={{ color: '#fca5a5', textAlign: 'center', wordBreak: 'break-all' }}>{(error as Error).message}</p>}
      {data && <pre style={resultStyle}>{data}</pre>}
    </form>
  )
}

// ── Main page ───────────────────────────────────────────────────────────
export default function DemoWallet() {
  const { theme, toggle } = useTheme()

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        margin: '24px 32px',
      }}>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>Initia</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0.5rem' }}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          <DepositIusd />
          <DepositInit />
          <DepositUsdc />
          <Withdraw />
          <Bridge />
          <ToggleAutoSign />
          <Connection />
        </div>
      </header>
      <main style={{ maxWidth: 540, margin: '32px auto', padding: '0 16px' }}>
        <Send />
      </main>
    </div>
  )
}

// ── Styles (inline version of CSS modules from example) ─────────────────

const outBtn: React.CSSProperties = {
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  padding: '0.5rem 1rem', borderRadius: 4, cursor: 'pointer',
  fontSize: '1rem', background: 'transparent',
  border: '1px solid #374151', color: 'inherit',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

const connBtn: React.CSSProperties = {
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  width: 140, padding: '0.5rem 1rem', border: 'none', borderRadius: 4,
  cursor: 'pointer', fontSize: '1rem', overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  background: '#374151', color: '#f3f4f6',
}

const formStyle: React.CSSProperties = {
  display: 'grid', gap: 16, borderRadius: 8, padding: 24, background: '#374151',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem', marginBottom: 4, color: '#9ca3af',
}

const inputStyle: React.CSSProperties = {
  borderRadius: 4, fontSize: '1rem', padding: 8,
  background: '#1f2937', border: '1px solid #4b5563', color: 'inherit',
}

const submitBtn: React.CSSProperties = {
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '1rem',
  padding: '0.75rem', background: '#6366f1', color: '#fff',
}

const resultStyle: React.CSSProperties = {
  borderRadius: 4, fontFamily: 'monospace', marginTop: 12,
  overflowWrap: 'anywhere', padding: 8, whiteSpace: 'pre-wrap',
  wordBreak: 'break-all', background: '#111827',
}
