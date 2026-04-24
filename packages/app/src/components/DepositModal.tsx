/**
 * DepositModal — Custom deposit/withdraw UI using router API.
 *
 * Flow (mirrors IK TransferFlow):
 *   1. Load source options with balances, sorted by balance desc, hide zero
 *   2. Select source → enter amount with MAX button
 *   3. Get route quote → show details (amount out, fees, duration)
 *   4. Confirm → build addressList + msgs → requestTxBlock (IK signing modal)
 *
 * Centered modal, iUSD Pay dark style, icons from router API.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import {
  fetchRoute, fetchMessages, buildTxForSigning, buildAddressList,
  fetchSourceOptions, fetchBalances, fetchAssets, fetchChains, fromBaseUnit, formatAmount, getAsset,
  type DepositQuote, type SourceOption,
} from '../services/deposit'

type Mode = 'deposit' | 'withdraw'
type Step = 'select' | 'amount' | 'done'

interface Props {
  open: boolean
  onClose: () => void
  mode: Mode
  denom: string
  chainId: string
  label: string
}

export default function DepositModal({ open, onClose, mode, denom, chainId, label }: Props) {
  const { t } = useTranslation()
  const { initiaAddress, hexAddress, requestTxBlock, estimateGas } = useInterwovenKit()

  const [step, setStep] = useState<Step>('select')
  const [sources, setSources] = useState<SourceOption[]>([])
  const [selected, setSelected] = useState<SourceOption | null>(null)
  const [quantity, setQuantity] = useState('')
  const [quote, setQuote] = useState<DepositQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [gasEstimate, setGasEstimate] = useState<string | null>(null)
  const [txType, setTxType] = useState<'cosmos' | 'evm' | null>(null)
  const [localBalance, setLocalBalance] = useState<string | null>(null) // balance on local chain (for withdraw MAX)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep('select')
      setSelected(null)
      setQuantity('')
      setQuote(null)
      setError(null)
      setTxHash(null)
      setConfirming(false)
      setGasEstimate(null)
      setTxType(null)
      setLocalBalance(null)
      loadSources()
    }
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current) }
  }, [open, denom, chainId, mode]) // eslint-disable-line

  // Load source options with balances
  const loadSources = useCallback(async () => {
    if (!initiaAddress || !hexAddress) return
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchAssets(), fetchChains()])
      const opts = await fetchSourceOptions(chainId, denom, initiaAddress, hexAddress, mode)
      setSources(opts)

      // For withdraw: fetch balance of local asset (source = local chain)
      if (mode === 'withdraw') {
        try {
          const localBal = await fetchBalances([chainId], initiaAddress, hexAddress)
          const bal = localBal[chainId]?.[denom]
          const asset = getAsset(chainId, denom)
          const decimals = asset?.decimals ?? 6
          setLocalBalance(bal?.amount ? fromBaseUnit(bal.amount, decimals) : '0')
        } catch { setLocalBalance(null) }
      }

      if (opts.length === 1) {
        setSelected(opts[0])
        setStep('amount')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [chainId, denom, initiaAddress, hexAddress, mode])

  // Fetch quote when quantity changes (debounced 500ms)
  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    if (step !== 'amount' || !selected || !quantity || parseFloat(quantity) <= 0) {
      setQuote(null)
      return
    }
    setQuoteLoading(true)
    setError(null)

    quoteTimer.current = setTimeout(async () => {
      try {
        const [src, dst] = mode === 'deposit'
          ? [{ chainId: selected.chain.chain_id, denom: selected.asset.denom },
             { chainId, denom }]
          : [{ chainId, denom },
             { chainId: selected.chain.chain_id, denom: selected.asset.denom }]

        const q = await fetchRoute({
          srcChainId: src.chainId, srcDenom: src.denom,
          dstChainId: dst.chainId, dstDenom: dst.denom,
          quantity,
        })
        setQuote(q)
        setError(null)

        // Pre-estimate gas (from IK FooterWithTxFee)
        try {
          const addrList = buildAddressList(q.route, initiaAddress, hexAddress)
          const msgsResp = await fetchMessages({ addressList: addrList, route: q.route, slippagePercent: '1' })
          const txData = buildTxForSigning(msgsResp)
          setTxType(txData.type)
          if (txData.type === 'cosmos' && txData.messages) {
            const gas = await estimateGas({ messages: txData.messages as any })
            const fee = Math.ceil(gas * 1.4) * 0.015 / 1e6  // uinit → INIT
            setGasEstimate(fee < 0.001 ? '< 0.001 INIT' : `~${fee.toFixed(4)} INIT`)
          } else {
            setGasEstimate(null) // EVM gas shown by wallet
          }
        } catch {
          setGasEstimate(null)
        }
      } catch (e: any) {
        setError(e.message)
        setQuote(null)
        setGasEstimate(null)
        setTxType(null)
      } finally {
        setQuoteLoading(false)
      }
    }, 500)

    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current) }
  }, [quantity, selected, step, mode, chainId, denom])

  // MAX button — withdraw uses local balance, deposit uses source balance
  function handleMax() {
    if (mode === 'withdraw') {
      if (localBalance && parseFloat(localBalance) > 0) setQuantity(localBalance)
    } else {
      if (selected?.balanceDisplay && parseFloat(selected.balanceDisplay) > 0) setQuantity(selected.balanceDisplay)
    }
  }

  // Confirm: addressList → msgs → requestTxBlock
  async function handleConfirm() {
    if (!quote || !initiaAddress || !hexAddress) return
    setConfirming(true)
    setError(null)
    try {
      const addressList = buildAddressList(quote.route, initiaAddress, hexAddress)
      const msgsResponse = await fetchMessages({
        addressList,
        route: quote.route,
        slippagePercent: '1',
      })
      const txData = buildTxForSigning(msgsResponse)

      if (txData.type === 'cosmos' && txData.messages) {
        // Sign via IK modal — chainId tells IK which chain to broadcast to
        const result = await requestTxBlock({
          messages: txData.messages as any,
          ...(txData.chainId ? { chainId: txData.chainId } : {}),
        })
        setTxHash(result.transactionHash)
        setStep('done')
      } else if (txData.type === 'evm' && txData.evmTx) {
        // EVM tx: need wallet provider (e.g., MetaMask)
        const provider = (window as any).ethereum
        if (!provider) throw new Error(t('deposit.noEvmWallet'))

        // Handle ERC20 approvals first
        if (txData.erc20Approvals?.length) {
          for (const approval of txData.erc20Approvals) {
            const approveTx = {
              to: approval.token_contract,
              data: '0x095ea7b3' +
                approval.spender.slice(2).padStart(64, '0') +
                BigInt(approval.amount).toString(16).padStart(64, '0'),
            }
            const approveTxHash = await provider.request({ method: 'eth_sendTransaction', params: [{ ...approveTx, from: hexAddress }] })
            // Wait for approval to confirm
            await new Promise<void>((resolve) => {
              const check = async () => {
                const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [approveTxHash] })
                if (receipt) resolve()
                else setTimeout(check, 2000)
              }
              check()
            })
          }
        }

        // Send main tx
        const txParams = {
          from: hexAddress,
          to: txData.evmTx.to,
          value: '0x' + BigInt(txData.evmTx.value).toString(16),
          data: txData.evmTx.data.startsWith('0x') ? txData.evmTx.data : '0x' + txData.evmTx.data,
          chainId: '0x' + parseInt(txData.evmTx.chainId).toString(16),
        }
        const hash = await provider.request({ method: 'eth_sendTransaction', params: [txParams] })
        setTxHash(hash)
        setStep('done')
      } else {
        throw new Error(t('deposit.unsupportedTx'))
      }
    } catch (e: any) {
      if (/reject|cancel|denied|User rejected|exited/i.test(e.message)) {
        setError(t('deposit.txCancelled'))
      } else {
        setError(e.message)
      }
    } finally {
      setConfirming(false)
    }
  }

  if (!open) return null

  const title = mode === 'deposit' ? t('deposit.depositTitle', { label }) : t('deposit.withdrawTitle', { label })
  const srcLabel = mode === 'deposit' ? t('deposit.from') : t('deposit.to')
  const displayedBalance = mode === 'withdraw' ? (localBalance ?? '0') : (selected?.balanceDisplay ?? '0')
  const hasBalance = parseFloat(displayedBalance) > 0

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {step === 'amount' && sources.length > 1 && (
              <button onClick={() => { setStep('select'); setQuantity(''); setQuote(null); setError(null) }}
                style={iconBtnStyle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
                </svg>
              </button>
            )}
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h2>
          </div>
          <button onClick={onClose} style={iconBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Select source ──────────────────────────────────────── */}
        {step === 'select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={labelStyle}>{mode === 'deposit' ? t('deposit.selectFrom') : t('deposit.selectTo')}</p>
            {loading ? (
              <div style={emptyStyle}>
                <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.5)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                {t('deposit.loadingAssets')}
              </div>
            ) : sources.length === 0 ? (
              <div style={emptyStyle}>
                {mode === 'deposit' ? t('deposit.noAssets') : t('deposit.noDestinations')}
              </div>
            ) : (
              sources.map(src => (
                <button
                  key={`${src.chain.chain_id}:${src.asset.denom}`}
                  onClick={() => { setSelected(src); setStep('amount'); setQuantity(''); setQuote(null); setError(null) }}
                  style={assetRowStyle}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <div style={{ position: 'relative' }}>
                      {src.asset.logo_uri ? (
                        <img src={src.asset.logo_uri} alt="" style={assetIconStyle}
                          onError={(e: any) => { e.target.style.display = 'none' }} />
                      ) : (
                        <div style={{ ...assetIconStyle, background: 'var(--bg-elevated)' }} />
                      )}
                      {src.chain.logo_uri && (
                        <img src={src.chain.logo_uri} alt="" style={chainBadgeStyle}
                          onError={(e: any) => { e.target.style.display = 'none' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{src.asset.symbol}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {t('deposit.onChain', { chain: src.chain.pretty_name || src.chain.chain_name })}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: 13, fontFamily: 'monospace',
                      color: parseFloat(src.balanceDisplay ?? '0') > 0 ? 'var(--text)' : 'var(--muted)',
                    }}>
                      {formatAmount(src.balanceDisplay ?? '0')}
                    </div>
                    {src.balance?.value_usd && parseFloat(src.balance.value_usd) > 0 ? (
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        ${parseFloat(src.balance.value_usd).toFixed(2)}
                      </div>
                    ) : (
                      mode === 'withdraw' && (
                        <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.05em' }}>{t('deposit.current')}</div>
                      )
                    )}
                  </div>
                </button>
              ))
            )}
            {error && <p style={errorStyle}>{error}</p>}
          </div>
        )}

        {/* ── Enter amount ───────────────────────────────────────── */}
        {step === 'amount' && selected && !confirming && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Selected source */}
            <div style={selectedBarStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <div style={{ position: 'relative' }}>
                  {selected.asset.logo_uri && (
                    <img src={selected.asset.logo_uri} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }}
                      onError={(e: any) => { e.target.style.display = 'none' }} />
                  )}
                  {selected.chain.logo_uri && (
                    <img src={selected.chain.logo_uri} alt="" style={{ ...chainBadgeStyle, width: 12, height: 12, bottom: -2, right: -2 }}
                      onError={(e: any) => { e.target.style.display = 'none' }} />
                  )}
                </div>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{srcLabel}:</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {selected.asset.symbol}
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {selected.chain.pretty_name || selected.chain.chain_name}
                </span>
              </div>
            </div>

            {/* Amount input */}
            <div>
              <label style={labelStyle}>{t('transfer.amountLabel')}</label>
              <input
                type="number" step="any" min="0" placeholder="0.00"
                value={quantity} onChange={e => setQuantity(e.target.value)}
                autoFocus style={inputStyle}
              />
            </div>

            <div style={balanceRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={balanceCaptionStyle}>{t('deposit.balance')}</span>
                <span style={balanceValueStyle}>
                  {formatAmount(displayedBalance)} {mode === 'withdraw' ? label : selected.asset.symbol}
                </span>
              </div>
              <button
                onClick={handleMax}
                disabled={!hasBalance}
                style={{
                  ...maxBtnStyle,
                  opacity: hasBalance ? 1 : 0.4,
                  cursor: hasBalance ? 'pointer' : 'not-allowed',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 100 4 2 2 0 000-4z"/>
                </svg>
                {t('deposit.max')}
              </button>
            </div>

            {/* Quote details */}
            {quote && (
              <div style={detailBoxStyle}>
                {/* Amount out */}
                <div style={detailRow}>
                  <span>{t('deposit.youReceive')}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                    ≈ {formatAmount(quote.amountOutDisplay)} {label}
                  </span>
                </div>
                {/* Rate */}
                {quote.amountInDisplay && quote.amountOutDisplay && (
                  <div style={detailRow}>
                    <span>{t('deposit.rate')}</span>
                    <span>1 {selected.asset.symbol} ≈ {formatAmount(
                      (parseFloat(quote.amountOutDisplay) / parseFloat(quote.amountInDisplay)).toFixed(6)
                    )} {label}</span>
                  </div>
                )}
                {/* Fees */}
                {quote.route.estimated_fees?.map((fee, i) => (
                  <div key={i} style={detailRow}>
                    <span>{fee.fee_type === 'SMART_RELAY' ? t('deposit.relayFee') : fee.fee_type}</span>
                    <span>
                      {fee.origin_asset ? `${fromBaseUnit(fee.amount, fee.origin_asset.decimals ?? 6)} ${fee.origin_asset.symbol ?? ''}` : fee.amount}
                      {fee.usd_amount && ` ($${parseFloat(fee.usd_amount).toFixed(2)})`}
                    </span>
                  </div>
                ))}
                {/* Duration */}
                {quote.durationSeconds != null && quote.durationSeconds > 0 && (
                  <div style={detailRow}>
                    <span>{t('deposit.estTime')}</span>
                    <span>{quote.durationSeconds < 60 ? `~${quote.durationSeconds}s` : `~${Math.ceil(quote.durationSeconds / 60)} min`}</span>
                  </div>
                )}
                {/* Gas fee */}
                {gasEstimate && (
                  <div style={detailRow}>
                    <span>{t('deposit.gasFee')}</span>
                    <span>{gasEstimate}</span>
                  </div>
                )}
                {txType === 'evm' && (
                  <div style={detailRow}>
                    <span>{t('deposit.gasFee')}</span>
                    <span style={{ fontSize: 11 }}>{t('deposit.estimatedByWallet')}</span>
                  </div>
                )}
                {/* Route */}
                <div style={detailRow}>
                  <span>{t('deposit.route')}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {quote.route.required_chain_addresses?.join(' → ')}
                  </span>
                </div>
              </div>
            )}

            {quoteLoading && <p style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>{t('deposit.fetchingRoute')}</p>}
            {error && <p style={errorStyle}>{error}</p>}

            {(() => {
              // Withdraw must validate the user's source (local chain) balance
              // before letting them submit. Deposit already validates via
              // selected.balanceDisplay in handleMax/fetchRoute.
              const qty = parseFloat(quantity || '0')
              const srcBal =
                mode === 'withdraw'
                  ? parseFloat(localBalance ?? '0')
                  : parseFloat(selected?.balanceDisplay ?? '0')
              const insufficient = qty > 0 && qty > srcBal
              const canSubmit = !!quote && !quoteLoading && !insufficient
              return (
                <>
                  {insufficient && (
                    <p style={errorStyle}>
                      {t('deposit.insufficient', { balance: formatAmount(String(srcBal)), symbol: mode === 'withdraw' ? label : (selected?.asset.symbol ?? '') })}
                    </p>
                  )}
                  <button
                    onClick={handleConfirm}
                    disabled={!canSubmit}
                    style={{
                      ...btnPrimaryStyle,
                      opacity: canSubmit ? 1 : 0.3,
                      cursor: canSubmit ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {mode === 'deposit' ? t('deposit.depositTitle', { label }) : t('deposit.withdrawTitle', { label })}
                  </button>
                </>
              )
            })()}
          </div>
        )}

        {/* ── Confirming ─────────────────────────────────────────── */}
        {confirming && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ width: 24, height: 24, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.6)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('deposit.preparingTx')}</p>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>{t('deposit.confirmInWallet')}</p>
            {error && (
              <>
                <p style={{ ...errorStyle, marginTop: 12 }}>{error}</p>
                <button onClick={() => { setConfirming(false); setError(null) }} style={{ ...btnSecondaryStyle, marginTop: 8 }}>
                  {t('deposit.tryAgain')}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Done ───────────────────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 8, color: '#4ade80' }}>✓</div>
            <p style={{ color: 'var(--text)', fontSize: 15, fontWeight: 600 }}>{t('deposit.submitted')}</p>
            {txHash && (
              <p style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'monospace', marginTop: 8, wordBreak: 'break-all', padding: '0 16px' }}>
                {txHash}
              </p>
            )}
            <button onClick={onClose} style={{ ...btnPrimaryStyle, marginTop: 16 }}>
              {t('deposit.done')}
            </button>
          </div>
        )}

        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
}

const modalStyle: React.CSSProperties = {
  width: '100%', maxWidth: 380,
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 16, padding: '18px 20px 22px',
  maxHeight: '85vh', overflow: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  color: 'var(--text)',
}

const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--muted)',
  cursor: 'pointer', padding: 4, display: 'flex',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--muted)', margin: '0 0 6px', display: 'block',
  letterSpacing: '0.05em', textTransform: 'uppercase' as const,
}

const emptyStyle: React.CSSProperties = {
  color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '28px 0',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
}

const assetRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 10, cursor: 'pointer', width: '100%', textAlign: 'left',
  transition: 'background 0.15s',
}

const assetIconStyle: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%',
}

const chainBadgeStyle: React.CSSProperties = {
  width: 14, height: 14, borderRadius: '50%',
  position: 'absolute' as const, bottom: -3, right: -3,
  border: '1.5px solid var(--surface)',
}

const selectedBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '8px 12px',
  background: 'var(--bg-elevated)', borderRadius: 8,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', fontSize: 22, fontWeight: 600,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 10, color: 'var(--text)', outline: 'none',
}

const balanceRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
}

const balanceCaptionStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--muted)', letterSpacing: '0.05em',
  textTransform: 'uppercase',
}

const balanceValueStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--text)', fontFamily: 'monospace', whiteSpace: 'nowrap',
}

const maxBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 6, cursor: 'pointer', color: 'var(--muted)',
  fontSize: 12, fontFamily: 'monospace',
}

const detailBoxStyle: React.CSSProperties = {
  padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
}

const detailRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 12, color: 'var(--muted)',
}

const btnPrimaryStyle: React.CSSProperties = {
  padding: '13px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700,
  width: '100%', background: 'var(--text)', color: 'var(--surface)', cursor: 'pointer',
}

const btnSecondaryStyle: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  color: 'var(--muted)', cursor: 'pointer',
}

const errorStyle: React.CSSProperties = {
  color: '#f87171', fontSize: 12, margin: 0, textAlign: 'center',
}
