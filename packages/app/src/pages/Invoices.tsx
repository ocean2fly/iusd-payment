/**
 * Accounting — /app/invoices (repurposed as personal ledger)
 * Shows personal income/expense summary and transaction ledger.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import { useAuthContext } from '../hooks/AuthContext'
import { API_BASE } from '../config'
import { parseTimestamp } from '../lib/dateUtils'

const IUSD = (micro: string | number) => (parseInt(String(micro)) / 1_000_000).toFixed(2)

type Period = 'week' | 'month' | 'all'

interface TxRow {
  paymentId: string
  direction: 'sent' | 'received'
  amountMicro: string
  feeMicro: string
  status: number
  counterpartyShortId: string | null
  dbCreatedAt: string | null
  createdAt: number
  merchantInfo?: { name?: string } | null
}

const STATUS_SENT: Record<number,string>     = { 2:'Pending Confirm', 3:'Confirmed', 5:'Revoked', 6:'Refunded', 7:'Expired' }
const STATUS_RECEIVED: Record<number,string> = { 2:'Claimable', 3:'Received', 5:'Cancelled', 6:'Refunded', 7:'Expired' }
const STATUS_COL: Record<number,string>      = { 2:'#f59e0b', 3:'#22c55e', 5:'#6b7280', 6:'#8b5cf6', 7:'#6b7280' }

function periodStart(p: Period): Date | null {
  const now = new Date()
  if (p === 'week')  { const d = new Date(now); d.setDate(d.getDate() - 7);  return d }
  if (p === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d }
  return null
}

function formatDate(iso: string | null, block: number): string {
  if (!iso) return `block ${block}`
  const d = parseTimestamp(iso)
  return d.toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric',
                                       hour:'2-digit', minute:'2-digit' })
}

function groupByDate(rows: TxRow[]): Record<string, TxRow[]> {
  const groups: Record<string, TxRow[]> = {}
  for (const r of rows) {
    const key = r.dbCreatedAt
      ? parseTimestamp(r.dbCreatedAt).toLocaleDateString(
          undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' })
      : `Block ${r.createdAt}`
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  }
  return groups
}

export function Invoices() {
  const { t } = useTranslation()
  const smartClose = useSmartClose('/app')
  const { token }  = useAuthContext()

  const [rows,    setRows]    = useState<TxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState<Period>('month')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const types = 'payment_sent,payment_received,payment_pending'
      const res = await fetch(`${API_BASE}/activity?types=${types}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = res.ok ? await res.json() : { items: [] }
      const items: any[] = Array.isArray(data?.items) ? data.items : []

      const sent: TxRow[] = []
      const rcvdMap = new Map<string, TxRow>()
      for (const it of items) {
        const d = it.data ?? {}
        const cp = it.counterparty ?? {}
        const ts = it.at ? Math.floor(new Date(it.at).getTime() / 1000) : 0
        if (it.type === 'payment_sent') {
          sent.push({
            paymentId:           d.paymentId,
            direction:           'sent',
            amountMicro:         it.amountMicro ?? '0',
            feeMicro:            d.feeMicro ?? '0',
            status:              d.chainStatus ?? 0,
            counterpartyShortId: cp.shortId ?? null,
            dbCreatedAt:         it.at,
            createdAt:           ts,
            merchantInfo:        d.merchantSnapshot ?? null,
          })
        } else if (it.type === 'payment_received') {
          rcvdMap.set(d.paymentId, {
            paymentId:           d.paymentId,
            direction:           'received',
            amountMicro:         it.amountMicro ?? '0',
            feeMicro:            d.feeMicro ?? '0',
            status:              d.chainStatus ?? 3,
            counterpartyShortId: cp.shortId ?? null,
            dbCreatedAt:         it.at,
            createdAt:           ts,
          })
        } else if (it.type === 'payment_pending') {
          if (!rcvdMap.has(d.paymentId)) {
            rcvdMap.set(d.paymentId, {
              paymentId:           d.paymentId,
              direction:           'received',
              amountMicro:         it.amountMicro ?? '0',
              feeMicro:            d.feeMicro ?? '0',
              status:              2,
              counterpartyShortId: cp.shortId ?? null,
              dbCreatedAt:         it.at,
              createdAt:           ts,
            })
          }
        }
      }

      const all = [...sent, ...Array.from(rcvdMap.values())]
        .sort((a, b) => b.createdAt - a.createdAt)
      setRows(all)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  // Filter by period
  const cutoff = periodStart(period)
  const filtered = cutoff
    ? rows.filter(r => {
        if (!r.dbCreatedAt) return false
        return parseTimestamp(r.dbCreatedAt) >= cutoff
      })
    : rows

  // Summary stats
  const totalIn  = filtered.filter(r => r.direction === 'received' && r.status === 3)
    .reduce((s, r) => s + parseInt(r.amountMicro), 0)
  const totalOut = filtered.filter(r => r.direction === 'sent' && (r.status === 2 || r.status === 3))
    .reduce((s, r) => s + parseInt(r.amountMicro), 0)
  const pendingIn = filtered.filter(r => r.direction === 'received' && r.status === 2)
    .reduce((s, r) => s + parseInt(r.amountMicro), 0)
  const feesTotal = filtered
    .reduce((s, r) => s + parseInt(r.feeMicro ?? '0'), 0)
  const net = totalIn - totalOut

  const grouped = groupByDate(filtered)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  padding:'20px 16px 100px', gap:14, boxSizing:'border-box' }}>

      {/* Header */}
      <div style={{ width:'100%', maxWidth:520, display:'flex', alignItems:'center', gap:10,
                    paddingBottom:12, borderBottom:'1px solid var(--border)' }}>
        <button onClick={smartClose} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700, flex:1 }}>{t('invoices.title')}</span>
        <button onClick={load} style={{ background:'none', border:'none',
          cursor:'pointer', color:'var(--muted)', fontSize:13 }}>↻</button>
      </div>

      {/* Period selector */}
      <div style={{ display:'flex', background:'var(--surface)',
                    border:'1px solid var(--border)', borderRadius:20, padding:2, gap:1 }}>
        {(['week','month','all'] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding:'5px 14px', borderRadius:16, border:'none', cursor:'pointer',
            fontSize:10, fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase',
            background: period === p ? 'var(--text)' : 'transparent',
            color:       period === p ? 'var(--surface)' : 'var(--muted)',
            transition:  'all 0.15s',
          }}>
            {p === 'week' ? '7 Days' : p === 'month' ? '30 Days' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div style={{ width:'100%', maxWidth:520, display:'grid',
                    gridTemplateColumns:'1fr 1fr', gap:8 }}>
        <StatCard label="Money In" value={IUSD(totalIn)} color="#22c55e" prefix="+" />
        <StatCard label="Money Out" value={IUSD(totalOut)} color="#ef4444" prefix="-" />
        <StatCard label="Net Balance" value={IUSD(Math.abs(net))}
          color={net >= 0 ? '#22c55e' : '#ef4444'} prefix={net >= 0 ? '+' : '-'} />
        <StatCard label="Pending In" value={IUSD(pendingIn)} color="#f59e0b" prefix="~" />
      </div>

      {/* Fees summary */}
      {feesTotal > 0 && (
        <div style={{ width:'100%', maxWidth:520, display:'flex',
                      justifyContent:'space-between', fontSize:11, color:'var(--muted)',
                      padding:'6px 12px', background:'var(--surface)',
                      border:'1px solid var(--border)', borderRadius:10 }}>
          <span>{t('invoices.protocolFees')}</span>
          <span style={{ fontFamily:'monospace' }}>{IUSD(feesTotal)} iUSD</span>
        </div>
      )}

      {loading && (
        <div style={{ color:'var(--muted)', fontSize:13, marginTop:24 }}>{t('common.loading')}</div>
      )}

      {/* Ledger — grouped by date */}
      {!loading && filtered.length === 0 && (
        <div style={{ color:'var(--muted)', fontSize:13, marginTop:40, textAlign:'center' }}>
          No transactions in this period
        </div>
      )}
      {!loading && Object.entries(grouped).map(([date, dayRows]) => (
        <div key={date} style={{ width:'100%', maxWidth:520 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--muted)',
                        letterSpacing:'0.08em', marginBottom:6, paddingLeft:4 }}>{date}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {dayRows.map(r => {
              const isSent = r.direction === 'sent'
              const col    = STATUS_COL[r.status] ?? 'var(--muted)'
              const label  = isSent ? STATUS_SENT[r.status] : STATUS_RECEIVED[r.status]
              return (
                <div key={r.paymentId} style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'9px 12px', borderRadius:10,
                  background:'var(--surface)', border:'1px solid var(--border)',
                }}>
                  {/* Direction dot */}
                  <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                                background: isSent ? '#6366f1' : '#22c55e' }}/>
                  {/* Counterparty */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:600,
                                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {r.merchantInfo?.name
                        ? `🏪 ${r.merchantInfo.name}`
                        : r.counterpartyShortId
                          ? `${isSent ? '→' : '←'} ${r.counterpartyShortId.slice(0,4)}◆${r.counterpartyShortId.slice(-4)}`
                          : '—'}
                    </div>
                    <div style={{ fontSize:9, color:'var(--muted)' }}>
                      {formatDate(r.dbCreatedAt, r.createdAt)}
                    </div>
                  </div>
                  {/* Amount + status */}
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:700,
                                  color: isSent ? 'var(--text)' : '#22c55e' }}>
                      {isSent ? '-' : '+'}{IUSD(r.amountMicro)}
                      <span style={{ fontSize:9, fontWeight:400, marginLeft:2, color:'var(--muted)' }}>iUSD</span>
                    </div>
                    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:10,
                                   background:col+'20', color:col }}>{label ?? '—'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, color, prefix }: {
  label: string; value: string; color: string; prefix: string
}) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:12, padding:'12px 14px' }}>
      <div style={{ fontSize:9, color:'var(--muted)', fontWeight:700,
                    letterSpacing:'0.1em', marginBottom:4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize:20, fontWeight:800, color }}>
        {prefix}{value}
        <span style={{ fontSize:10, fontWeight:400, marginLeft:3, color:'var(--muted)' }}>iUSD</span>
      </div>
    </div>
  )
}

const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
