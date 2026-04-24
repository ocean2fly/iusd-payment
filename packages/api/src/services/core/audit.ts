/**
 * Audit & Compliance Disclosure Service
 *
 * Generates cryptographically signed audit packages that allow third-party
 * auditors (regulators, tax authorities, counterparties) to verify payment
 * history without compromising the user's spending_key.
 *
 * Privacy model:
 *  - User holds viewing_key (read-only)
 *  - User generates an audit package by signing with their wallet
 *  - Package contains: time-bounded transactions + amounts + viewing_key hash
 *  - Auditor receives the package + optionally the viewing_key to decrypt notes
 *  - Platform NEVER shares data without explicit user authorization signature
 *
 * Audit package is self-contained and verifiable offline.
 */

import crypto from 'crypto'

// ── Types ────────────────────────────────────────────────────────────────────

export type AuditScope =
  | 'all'             // All transactions in period
  | 'received'        // Only received payments
  | 'sent'            // Only sent payments
  | 'invoices'        // Invoice payments only
  | 'subscriptions'   // Subscription payments only
  | 'specific'        // Specific payment_ids only

export type AuditGrantLevel =
  | 'summary'         // Counts and totals only — no amounts per tx
  | 'standard'        // Amounts + timestamps + order IDs, no counterparties
  | 'full'            // All details including counterparty stealth addresses

export interface AuditRequest {
  /** Wallet address of the user/merchant authorizing the audit */
  subject_address:   string
  /** Wallet signature proving ownership of subject_address */
  authorization_sig: string
  /** Audit period start (unix timestamp) */
  period_from:       number
  /** Audit period end (unix timestamp) */
  period_to:         number
  /** What transactions to include */
  scope:             AuditScope
  /** Specific order IDs if scope = 'specific' */
  payment_ids?:        string[]
  /** Level of detail to grant the auditor */
  grant_level:       AuditGrantLevel
  /** Whether to include the viewing_key hash (for auditor to decrypt notes) */
  include_vk_hash:   boolean
  /** Optional: auditor's name/org for the package header */
  auditor_name?:     string
  /** Optional: regulatory reference (e.g. "FATF Rec.12", "IRS Form 1099") */
  regulatory_ref?:   string
  /** Package expiry in hours (0 = no expiry) */
  expires_in_hours:  number
}

export interface AuditTransaction {
  payment_id:        string
  instrument_type: number
  instrument_name: string
  direction:       'sent' | 'received'
  timestamp:       number
  chain:           string
  // Present only in 'full' grant level:
  amount_iusd?:    string
  memo_encrypted?: boolean
  counterparty?:   string   // stealth address, not real identity
}

export interface AuditPackage {
  /** Unique audit package ID */
  audit_id:         string
  /** iPay version that generated this */
  generator:        'iPay Compliance v1.0'
  /** Subject of the audit */
  subject: {
    address:          string
    address_hash:     string  // sha256, for display without revealing full address
  }
  /** Audit authorization */
  authorization: {
    signature:        string
    signed_at:        number
    signing_message:  string
  }
  /** Period covered */
  period: {
    from:     number
    to:       number
    from_iso: string
    to_iso:   string
  }
  /** Scope and level */
  scope:       AuditScope
  grant_level: AuditGrantLevel
  /** Optional: auditor context */
  auditor_name?:    string
  regulatory_ref?:  string
  /** Transaction summary (always included) */
  summary: {
    total_transactions: number
    total_sent_count:   number
    total_received_count: number
    total_sent_iusd?:   string   // present if grant_level != 'summary'
    total_received_iusd?: string
    total_fees_iusd?:   string
    instruments_used:   string[]
    chains_used:        string[]
  }
  /** Individual transactions (empty for grant_level = 'summary') */
  transactions: AuditTransaction[]
  /** Viewing key hint — auditor uses this to verify they have the right key */
  viewing_key_hash?: string
  /** Package integrity */
  integrity: {
    package_hash:   string   // sha256 of the entire package (self-referential)
    generated_at:   number
    expires_at?:    number
  }
  /** Permanent compliance records from on-chain (always public, always included) */
  on_chain_compliance: OnChainComplianceRecord[]
}

export interface OnChainComplianceRecord {
  nullifier:       string  // truncated for readability
  payment_id:        string
  timestamp:       number
  instrument_type: number
  recipient_chain: string
  // These are ALWAYS public on-chain, regardless of ZK privacy
}

import { getDb } from '../../db/index'

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Generate a signed audit package.
 *
 * In production this would:
 *  1. Verify the wallet signature on-chain
 *  2. Query the shielded pool for compliance records
 *  3. Attempt to decrypt notes using the viewing_key (if provided)
 *  4. Aggregate amounts and generate the package
 *
 * Here we generate a realistic mock package.
 */
export function generateAuditPackage(req: AuditRequest): AuditPackage {
  const now = Date.now()
  const audit_id = `AUDIT-${new Date().getFullYear()}-${randomHex(6).toUpperCase()}`

  // Build signing message (what the user signed to authorize this)
  const signing_message =
    `iPay Audit Authorization\n` +
    `Subject: ${req.subject_address}\n` +
    `Period: ${new Date(req.period_from * 1000).toISOString()} to ${new Date(req.period_to * 1000).toISOString()}\n` +
    `Scope: ${req.scope}\n` +
    `Grant Level: ${req.grant_level}\n` +
    `Generated: ${new Date(now).toISOString()}\n` +
    `Audit ID: ${audit_id}`

  // Mock transactions (in production: query pool + decrypt with viewing_key)
  const transactions = buildMockTransactions(req)

  // Summary aggregation
  const sent = transactions.filter(t => t.direction === 'sent')
  const received = transactions.filter(t => t.direction === 'received')

  const summary = {
    total_transactions:     transactions.length,
    total_sent_count:       sent.length,
    total_received_count:   received.length,
    ...(req.grant_level !== 'summary' ? {
      total_sent_iusd:      sent.reduce((a,_) => a + 100, 0).toFixed(2) + ' iUSD',
      total_received_iusd:  received.reduce((a,_) => a + 150, 0).toFixed(2) + ' iUSD',
      total_fees_iusd:      (transactions.length * 0.15).toFixed(2) + ' iUSD',
    } : {}),
    instruments_used: [...new Set(transactions.map(t => t.instrument_name))],
    chains_used:      [...new Set(transactions.map(t => t.chain))],
  }

  // On-chain compliance records (always public, no viewing_key needed)
  const on_chain_compliance: OnChainComplianceRecord[] = transactions.map(t => ({
    nullifier:       randomHex(16) + '...',
    payment_id:        t.payment_id,
    timestamp:       t.timestamp,
    instrument_type: t.instrument_type,
    recipient_chain: t.chain,
  }))

  const expires_at = req.expires_in_hours > 0
    ? now + req.expires_in_hours * 3600 * 1000
    : undefined

  const pkg: AuditPackage = {
    audit_id,
    generator:        'iPay Compliance v1.0',
    subject: {
      address:      req.subject_address,
      address_hash: sha256(req.subject_address).slice(0, 16) + '...',
    },
    authorization: {
      signature:       req.authorization_sig,
      signed_at:       Math.floor(now / 1000),
      signing_message,
    },
    period: {
      from:     req.period_from,
      to:       req.period_to,
      from_iso: new Date(req.period_from * 1000).toISOString(),
      to_iso:   new Date(req.period_to * 1000).toISOString(),
    },
    scope:       req.scope,
    grant_level: req.grant_level,
    auditor_name:   req.auditor_name,
    regulatory_ref: req.regulatory_ref,
    summary,
    transactions: req.grant_level === 'summary' ? [] : transactions,
    viewing_key_hash: req.include_vk_hash ? randomHex(16) : undefined,
    integrity: {
      package_hash: '',  // filled in below
      generated_at: Math.floor(now / 1000),
      expires_at:   expires_at ? Math.floor(expires_at / 1000) : undefined,
    },
    on_chain_compliance,
  }

  // Self-referential integrity hash
  pkg.integrity.package_hash = sha256(JSON.stringify({ ...pkg, integrity: { ...pkg.integrity, package_hash: '' } }))

  // Persist to database
  getDb().prepare(`
    INSERT INTO audit_packages
      (audit_id, subject_hash, grant_level, scope, period_from, period_to, package_hash, package_json, generated_at, expires_at, auditor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    audit_id,
    sha256(req.subject_address),
    req.grant_level,
    req.scope,
    req.period_from,
    req.period_to,
    pkg.integrity.package_hash,
    JSON.stringify(pkg),
    pkg.integrity.generated_at,
    pkg.integrity.expires_at ?? 0,
    req.auditor_name ?? null,
  )

  return pkg
}

/**
 * Retrieve an audit package by ID.
 */
export function getAuditPackage(audit_id: string): AuditPackage | null {
  const row = getDb().prepare('SELECT package_json FROM audit_packages WHERE audit_id = ?').get(audit_id) as any
  if (!row) return null
  try { return JSON.parse(row.package_json) } catch { return null }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INSTRUMENT_NAMES: Record<number, string> = {
  0: 'Payment', 1: 'Subscription', 2: 'Check',
  3: 'Multisig', 4: 'Conditional', 5: 'Invoice',
  6: 'Chocolate Box',
}

function buildMockTransactions(req: AuditRequest): AuditTransaction[] {
  // Mock: generate realistic-looking transactions in the period
  const count = Math.floor(Math.random() * 8) + 4
  const txs: AuditTransaction[] = []
  const periodMs = (req.period_to - req.period_from) * 1000

  for (let i = 0; i < count; i++) {
    const instrument = [0, 0, 0, 1, 5, 5, 2, 6][i % 8]
    const direction = i % 3 === 0 ? 'received' : 'sent'
    const ts = req.period_from + Math.floor((periodMs * i / count) / 1000)

    const tx: AuditTransaction = {
      payment_id:        `iPay-${randomHex(8)}`,
      instrument_type: instrument,
      instrument_name: INSTRUMENT_NAMES[instrument] ?? 'Unknown',
      direction,
      timestamp:       ts,
      chain:           ['interwoven-1', 'echelon-1', 'inertia'][i % 3],
    }

    if (req.grant_level !== 'summary') {
      tx.amount_iusd  = (50 + Math.random() * 500).toFixed(2)
      tx.memo_encrypted = Math.random() > 0.5
    }
    if (req.grant_level === 'full') {
      tx.counterparty = `stealth1${randomHex(16)}...`
    }

    txs.push(tx)
  }
  return txs
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex')
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}
