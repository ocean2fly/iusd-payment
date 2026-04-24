/**
 * invoiceStore.ts — Server-side invoice storage (DB-backed)
 *
 * Source of truth is server DB only.
 * Local cache keys are deprecated and can be hard-cleared.
 */
import { API_BASE } from '../config'

export interface Invoice {
  id:            string
  invoiceToken:  string
  invoiceNo:     string
  amount:        number
  dueDate:       string
  note:          string
  taxNum?:       string
  payerShortId?: string | null
  payerName?:    string | null
  status:        'draft' | 'sent' | 'paying' | 'paid' | 'overdue' | 'refunded' | 'cancelled'
  payLink:       string
  createdAt:     string
  sentAt?:       string | null
  paidAt?:       string | null
  txHash?:       string | null
  myShortId:     string
  revokedAt?:    string | null
  invoiceMode?:  string
  feeMode?:      string
  merchant?:     string | null
  paymentId?:    string | null
}

const LS_CACHE_KEY = 'ipay2_invoices_cache'
const LS_MIGRATED_KEY = 'ipay2_invoices_migrated'
const OLD_KEY = 'ipay2_invoices'

// ── Fetch all invoices from API ──────────────────────────────────────────
export async function fetchInvoices(token: string): Promise<Invoice[]> {
  const res = await fetch(`${API_BASE}/account/invoices`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return (data.invoices ?? []) as Invoice[]
}

// ── Save/register a new invoice to the API ───────────────────────────────
export async function saveInvoice(inv: Invoice, token: string): Promise<void> {
  await fetch(`${API_BASE}/invoice/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      token:             inv.invoiceToken,
      invoiceNo:         inv.invoiceNo,
      amount:            inv.amount,
      feeMode:           inv.feeMode ?? 'recipient',
      note:              inv.note,
      merchant:          inv.merchant ?? null,
      dueDate:           inv.dueDate,
      recipientShortId:  inv.payerShortId ?? null,
      taxNum:            inv.taxNum ?? null,
      payerShortId:      inv.payerShortId ?? null,
      payerName:         inv.payerName ?? null,
      status:            inv.status,
      payLink:           inv.payLink,
      createdAt:         inv.createdAt,
      sentAt:            inv.sentAt ?? null,
      paidAt:            inv.paidAt ?? null,
      txHash:            inv.txHash ?? null,
      revokedAt:         inv.revokedAt ?? null,
      invoiceMode:       inv.invoiceMode ?? 'personal',
    }),
  })

}

// ── Update invoice status (lightweight PATCH) ────────────────────────────
export async function updateInvoiceStatus(
  invoiceToken: string,
  updates: Partial<Pick<Invoice, 'status' | 'paidAt' | 'txHash' | 'sentAt' | 'payerShortId' | 'payerName'>>,
  token: string
): Promise<void> {
  const body: Record<string, any> = {}
  if (updates.status      !== undefined) body.status      = updates.status
  if (updates.paidAt      !== undefined) body.paidAt      = updates.paidAt
  if (updates.txHash      !== undefined) body.txHash      = updates.txHash
  if (updates.sentAt      !== undefined) body.sentAt      = updates.sentAt
  if (updates.payerShortId !== undefined) body.payerShortId = updates.payerShortId
  if (updates.payerName   !== undefined) body.payerName   = updates.payerName

  await fetch(`${API_BASE}/invoice/${invoiceToken}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

}

// Deprecated migration (disabled by product decision: fresh start)
export async function migrateFromLocalStorage(_token: string): Promise<void> {
  return
}

// Hard clear all local invoice-related cache keys
export function clearInvoiceLocalCache(): void {
  try {
    localStorage.removeItem(LS_CACHE_KEY)
    localStorage.removeItem(LS_MIGRATED_KEY)
    localStorage.removeItem(OLD_KEY)
  } catch {}
}

// Deprecated cache getter (kept for compatibility)
export function getCachedInvoices(): Invoice[] {
  return []
}
