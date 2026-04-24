/**
 * NicknameEditorModal
 *
 * Flow:
 *  1. Input new nickname (any Unicode, 1–12 chars)
 *  2. 🎲 random nickname button  |  live SVG preview (debounced via API)
 *  3. Show fee: first change 0.1 iUSD, subsequent 10 iUSD
 *  4. User signs iUSD transfer to treasury → txHash
 *  5. PUT /account/nickname with txHash → refresh account → close
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiAccount } from '@ipay/shared'
import { IdentityCard } from './IdentityCard'
import { API_BASE } from '../config'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { IUSD_FA } from '../networks'

import { ADJECTIVES, NOUNS } from '../lib/nicknames'

function hexToBech32(hex: string): string {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  // bech32 encoding — 5-bit groups
  const words: number[] = []
  let bits = 0, value = 0
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { bits -= 5; words.push((value >> bits) & 31) }
  }
  if (bits > 0) words.push((value << (5 - bits)) & 31)
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
  function polymod(values: number[]) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    let chk = 1
    for (const v of values) { const b = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i] }
    return chk
  }
  const hrp = 'init'
  const hrpExpand = [...Array.from(hrp).map(c => c.charCodeAt(0) >> 5), 0, ...Array.from(hrp).map(c => c.charCodeAt(0) & 31)]
  const values = [...hrpExpand, ...words, 0, 0, 0, 0, 0, 0]
  const pm = polymod(values) ^ 1
  const checksum = Array.from({ length: 6 }, (_, i) => (pm >> (5 * (5 - i))) & 31)
  return hrp + '1' + [...words, ...checksum].map(w => CHARSET[w]).join('')
}

function randomNickname() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${a}${n}`
}

interface Props {
  account:  ApiAccount
  token:    string | null
  onSaved:  (updated: ApiAccount) => void
  onClose:  () => void
}

export function NicknameEditorModal({ account, token, onSaved, onClose }: Props) {
  const { t } = useTranslation()
  const [nick,     setNick]     = useState(account.nickname ?? '')
  const [preview,  setPreview]  = useState<string | null>(account.avatarSvg ?? null)
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [feeInfo,  setFeeInfo]  = useState<{ feeMicro: number; feeIusd: string; isFirst: boolean; changeCount: number; treasury: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { requestTxBlock } = useInterwovenKit()

  // Fetch fee info on mount
  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/account/nickname-fee`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setFeeInfo(d) })
      .catch(() => {})
  }, [token])

  // Debounced preview fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = nick.trim()
    if (!trimmed) { setPreview(account.avatarSvg ?? null); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`${API_BASE}/account/preview-seal?nickname=${encodeURIComponent(trimmed)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) setPreview(await res.text())
      } catch {}
      finally { setLoading(false) }
    }, 350)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [nick, token, account.avatarSvg])

  async function handleSave() {
    const trimmed = nick.trim().slice(0, 12)
    if (!trimmed) { setError(t('components.nicknameEditor.errEmpty')); return }
    if (!feeInfo) { setError(t('components.nicknameEditor.errFee')); return }
    setSaving(true); setError(null)

    try {
      // 1. Sign iUSD transfer to treasury
      const amountMicro = feeInfo.feeMicro
      const iusdDenom = `move/${IUSD_FA.replace(/^0x/, '')}`
      const treasuryBech32 = feeInfo.treasury.startsWith('init1')
        ? feeInfo.treasury
        : hexToBech32(feeInfo.treasury)

      const msgs = [{
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: {
          fromAddress: account.address,
          toAddress: treasuryBech32,
          amount: [{ denom: iusdDenom, amount: String(amountMicro) }],
        },
      }]

      const txRes = await requestTxBlock({ messages: msgs })
      if (txRes?.code !== 0 && txRes?.code !== undefined) {
        throw new Error(t('components.nicknameEditor.errTxFailed'))
      }
      const txHash = (txRes as any)?.transactionHash ?? (txRes as any)?.txHash ?? ''
      if (!txHash) throw new Error(t('components.nicknameEditor.errNoHash'))

      // 2. Update nickname with txHash proof
      const res = await fetch(`${API_BASE}/account/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nickname: trimmed, txHash }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message ?? data.error ?? t('components.nicknameEditor.errGeneric')); setSaving(false); return }
      onSaved(data.account)
    } catch (e: any) {
      if (e.message?.includes('rejected') || e.message?.includes('cancel')) {
        setError(t('components.nicknameEditor.errCancelled'))
      } else {
        setError(e.message ?? t('components.nicknameEditor.errGeneric'))
      }
      setSaving(false)
    }
  }

  const previewAccount = { ...(account ?? {}), avatarSvg: preview ?? account?.avatarSvg ?? null }
  const stopProp = (e: React.MouseEvent) => e.stopPropagation()
  const [ackNotUnique, setAckNotUnique] = useState(false)
  const canSave = nick.trim().length > 0 && !saving && feeInfo != null && ackNotUnique

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'nickBackdropIn 0.22s ease',
    }}>
      <style>{`
        @keyframes nickBackdropIn { from { opacity:0 } to { opacity:1 } }
        @keyframes nickModalIn { from { opacity:0; transform:translateY(18px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
      `}</style>
      <div onClick={stopProp} style={{
        width: '90%', maxWidth: 480,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '24px 24px 28px',
        display: 'flex', flexDirection: 'column', gap: 16,
        animation: 'nickModalIn 0.25s cubic-bezier(0.34,1.2,0.64,1)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
            {t('components.nicknameEditor.title')}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
                                             color: 'var(--muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Full card preview (scaled) */}
        <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center',
                      opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
          <div style={{ transform: 'scale(0.85)', transformOrigin: 'top center',
                        width: 360, height: 227, flexShrink: 0, marginBottom: -34 }}>
            <IdentityCard account={previewAccount as any} status="active" />
          </div>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 9, color: 'var(--muted)',
                          letterSpacing: '0.15em', pointerEvents: 'none' }}>
              {t('components.nicknameEditor.generating')}
            </div>
          )}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={nick}
              onChange={e => setNick(e.target.value.slice(0, 12))}
              placeholder={t('components.nicknameEditor.placeholder')}
              maxLength={12}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 44px 10px 14px',
                color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', outline: 'none',
              }}
            />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                           fontSize: 9, color: 'var(--muted)' }}>
              {nick.trim().length}/12
            </span>
          </div>
          <button onClick={() => setNick(randomNickname())}
            title={t('components.nicknameEditor.randomNickname')}
            style={{
              padding: '10px 14px', borderRadius: 10, fontSize: 16, cursor: 'pointer',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              color: 'var(--text)', flexShrink: 0,
            }}>
            🎲
          </button>
        </div>

        {/* Fee info */}
        {feeInfo && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {feeInfo.isFirst ? t('components.nicknameEditor.firstChangeFee') : t('components.nicknameEditor.changeFeeN', { n: feeInfo.changeCount + 1 })}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                {feeInfo.feeIusd} iUSD
              </span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.5 }}>
              {feeInfo.isFirst
                ? t('components.nicknameEditor.firstFeeNote')
                : t('components.nicknameEditor.feeNote')}
            </div>
          </div>
        )}

        {/* ID stays the same hint */}
        <div style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', marginTop: -8 }}>
          {t('components.nicknameEditor.idStays')}
        </div>

        {error && <div style={{ fontSize: 10, color: '#ef4444', textAlign: 'center' }}>{error}</div>}

        {/* Uniqueness acknowledgment */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginTop: -4 }}>
          <input type="checkbox" checked={ackNotUnique}
            onChange={e => setAckNotUnique(e.target.checked)}
            style={{ width: 16, height: 16, marginTop: 1, accentColor: 'var(--text)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
            {t('components.nicknameEditor.notUniqueAck')}
          </span>
        </label>

        {/* Save button */}
        <button onClick={handleSave} disabled={!canSave}
          style={{
            padding: '14px', borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed',
            background: canSave ? 'var(--text)' : 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: canSave ? 'var(--surface)' : 'var(--muted)',
            letterSpacing: '0.06em',
          }}>
          {saving ? t('components.nicknameEditor.signing') : t('components.nicknameEditor.payAndSave', { fee: feeInfo?.feeIusd ?? '...' })}
        </button>
      </div>
    </div>
  )
}
