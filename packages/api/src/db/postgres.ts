/**
 * PostgreSQL database layer — V3 schema.
 */
import { Pool } from 'pg'
import { Worker } from 'worker_threads'
import path from 'path'
import fs from 'fs'
import os from 'os'

const DATABASE_URL = process.env.DATABASE_URL || ''
const PG_SSL_MODE = process.env.PG_SSL_MODE || ''

let _pool: Pool | null = null
let _compatDb: any = null
let _worker: Worker | null = null

export function getPgPool(): Pool {
  if (_pool) return _pool
  _pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: PG_SSL_MODE === 'no-verify' ? { rejectUnauthorized: false } : undefined,
    max: 10,
  })
  return _pool
}

/**
 * Get a synchronous-style wrapper around PostgreSQL.
 * Uses a worker thread with SharedArrayBuffer for synchronous queries.
 */
export function getPgCompatDb(): any {
  if (_compatDb) return _compatDb

  const workerPath = path.join(__dirname, 'pg-worker.js')
  _worker = new Worker(workerPath, {
    workerData: { connectionString: DATABASE_URL, sslMode: PG_SSL_MODE },
    env: { ...process.env },
  })

  _compatDb = {
    prepare: (sql: string) => ({
      run: (...params: any[]) => {
        const result = syncQuery(sql, params)
        return { changes: result?.rowCount ?? 0 }
      },
      get: (...params: any[]) => {
        const result = syncQuery(sql, params)
        return result?.rows?.[0] ?? null
      },
      all: (...params: any[]) => {
        const result = syncQuery(sql, params)
        return result?.rows ?? []
      },
    }),
    exec: (sql: string) => {
      syncQuery(sql, [])
    },
  }

  bootstrapPostgresSchema(_compatDb)
  return _compatDb
}

/** Convert ? placeholders to PostgreSQL $1, $2, ... */
function convertPlaceholders(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

function syncQuery(sql: string, params: any[]): any {
  if (!_worker) throw new Error('PG worker not initialized')
  sql = convertPlaceholders(sql)

  const tmpDir = os.tmpdir()
  const resultPath = path.join(tmpDir, `pg-result-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  const signal = new SharedArrayBuffer(4)
  const flag = new Int32Array(signal)
  Atomics.store(flag, 0, 0)

  _worker.postMessage({ sql, params, resultPath, signal })

  // Wait for worker to signal completion (up to 30s)
  const waitResult = Atomics.wait(flag, 0, 0, 30000)
  if (waitResult === 'timed-out') {
    try { fs.unlinkSync(resultPath) } catch {}
    throw new Error(`PG query timed out: ${sql.slice(0, 80)}`)
  }

  try {
    const raw = fs.readFileSync(resultPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed.error) throw new Error(parsed.error)
    return parsed.result
  } finally {
    try { fs.unlinkSync(resultPath) } catch {}
  }
}

export function closePgCompatDb(): void {
  if (_worker) { _worker.terminate(); _worker = null }
  if (_pool) { _pool.end(); _pool = null }
  _compatDb = null
}

/**
 * Bootstrap V3 PostgreSQL schema.
 */
export function bootstrapPostgresSchema(db: { exec: (sql: string) => void } = getPgCompatDb()): void {
  db.exec(`
    CREATE OR REPLACE FUNCTION ipay_now_text() RETURNS TEXT AS $$
      SELECT to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION ipay_epoch_seconds() RETURNS BIGINT AS $$
      SELECT floor(extract(epoch FROM timezone('UTC', now())))::bigint;
    $$ LANGUAGE sql STABLE;

    -- Accounts
    CREATE TABLE IF NOT EXISTS accounts (
      id BIGSERIAL PRIMARY KEY,
      short_id TEXT UNIQUE NOT NULL,
      nickname TEXT,
      checksum TEXT,
      address TEXT UNIQUE NOT NULL,
      pubkey TEXT,
      viewing_privkey_enc TEXT,
      default_claim_address TEXT,
      avatar_seed INTEGER,
      avatar_svg TEXT,
      short_seal_svg TEXT,
      bio TEXT DEFAULT '',
      auto_claim_enabled INTEGER DEFAULT 1,
      merchant_name TEXT,
      merchant_data TEXT,
      frozen_at TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT ipay_now_text(),
      updated_at TEXT DEFAULT ipay_now_text()
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_address ON accounts(address);

    -- Nickname change tracking
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nickname_change_count INTEGER DEFAULT 0;

    -- Default auto_claim_enabled to ON for new accounts (was historically OFF).
    -- We only flip the column default — existing rows are left as-is so that
    -- anyone who explicitly disabled auto-claim keeps their choice.
    ALTER TABLE accounts ALTER COLUMN auto_claim_enabled SET DEFAULT 1;

    -- Auth
    CREATE TABLE IF NOT EXISTS auth_challenges (
      address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ipay_now_text(),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      issued_at TEXT NOT NULL DEFAULT ipay_now_text(),
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_address ON auth_sessions(address);

    -- Contacts
    CREATE TABLE IF NOT EXISTS contacts (
      id BIGSERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      contact TEXT NOT NULL,
      nickname TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT ipay_now_text(),
      updated_at TEXT NOT NULL DEFAULT ipay_now_text(),
      UNIQUE(owner, contact)
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner);

    -- Payment Intents
    CREATE TABLE IF NOT EXISTS payment_intents (
      payment_id TEXT PRIMARY KEY,
      sender_short_id TEXT,
      recipient_short_id TEXT,
      amount_micro TEXT,
      recipient_address TEXT,
      auto_claim_at TEXT,
      auto_claim_status TEXT DEFAULT 'pending',
      auto_claim_tx TEXT,
      auto_claimed_at TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      invoice_type TEXT DEFAULT 'personal',
      merchant_snapshot TEXT,
      created_at TEXT DEFAULT ipay_now_text()
    );
    CREATE INDEX IF NOT EXISTS idx_pi_recipient ON payment_intents(recipient_short_id);
    CREATE INDEX IF NOT EXISTS idx_pi_status ON payment_intents(auto_claim_status);

    -- Claim Job Traces
    CREATE TABLE IF NOT EXISTS claim_job_traces (
      id BIGSERIAL PRIMARY KEY,
      payment_id TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      outcome TEXT NOT NULL,
      error TEXT,
      tx_hash TEXT,
      created_at TEXT DEFAULT ipay_now_text()
    );
    CREATE INDEX IF NOT EXISTS idx_cjt_pid ON claim_job_traces(payment_id);

    -- Gift V3
    CREATE TABLE IF NOT EXISTS gift_v3_packets (
      packet_id TEXT PRIMARY KEY,
      box_id INTEGER NOT NULL,
      sender_address TEXT NOT NULL,
      mode INTEGER NOT NULL DEFAULT 0,
      recipient_address TEXT,
      num_slots INTEGER NOT NULL DEFAULT 1,
      total_amount BIGINT NOT NULL,
      claim_key_hex TEXT,
      allocation_seed_hex TEXT,
      sender_message TEXT DEFAULT '',
      tx_hash TEXT,
      status TEXT DEFAULT 'pending_tx',
      created_at TEXT DEFAULT ipay_now_text(),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gift_v3_packets_sender ON gift_v3_packets(sender_address);
    CREATE INDEX IF NOT EXISTS idx_gift_v3_packets_status ON gift_v3_packets(status);

    -- Track when sender last viewed replies
    ALTER TABLE gift_v3_packets ADD COLUMN IF NOT EXISTS reply_seen_at TEXT;
    -- Artistic font for memo display
    ALTER TABLE gift_v3_packets ADD COLUMN IF NOT EXISTS memo_font TEXT;
    -- Wrapping paper style (0-9, each maps to a distinct visual texture)
    ALTER TABLE gift_v3_packets ADD COLUMN IF NOT EXISTS wrap_style_id INTEGER DEFAULT 0;
    -- Gift box visual params JSON: {texture, ribbonHueShift, rotateX, rotateY, scale}
    ALTER TABLE gift_v3_packets ADD COLUMN IF NOT EXISTS wrap_params TEXT;

    CREATE TABLE IF NOT EXISTS gift_v3_claims (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      claimer_address TEXT NOT NULL,
      amount BIGINT,
      claim_tx_hash TEXT,
      claimed_at TEXT DEFAULT ipay_now_text(),
      thank_emoji TEXT,
      thank_message TEXT,
      UNIQUE(packet_id, slot_index)
    );
    CREATE INDEX IF NOT EXISTS idx_gift_v3_claims_claimer ON gift_v3_claims(claimer_address);

    -- Per-claim "last viewed" timestamp; used by the received-gift badge to
    -- decide whether new claims/replies have appeared since the user's last
    -- visit to the gift detail. Set via POST /v1/gift/:packetId/seen.
    ALTER TABLE gift_v3_claims ADD COLUMN IF NOT EXISTS last_viewed_at TEXT;

    -- Gift Claim Queue (single-URL group gift claims)
    CREATE TABLE IF NOT EXISTS gift_claim_queue (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      claimer_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      tx_hash TEXT,
      amount BIGINT,
      created_at TEXT DEFAULT ipay_now_text(),
      claimed_at TEXT,
      UNIQUE(packet_id, slot_index),
      UNIQUE(packet_id, claimer_address)
    );
    CREATE INDEX IF NOT EXISTS idx_gcq_status ON gift_claim_queue(status);
    CREATE INDEX IF NOT EXISTS idx_gcq_packet ON gift_claim_queue(packet_id);

    -- Gift claim attempts (tracks all requests including rejected ones)
    CREATE TABLE IF NOT EXISTS gift_claim_attempts (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      requester_address TEXT NOT NULL,
      requester_nickname TEXT,
      result TEXT NOT NULL DEFAULT 'rejected',
      created_at TEXT DEFAULT ipay_now_text()
    );
    CREATE INDEX IF NOT EXISTS idx_gca_packet ON gift_claim_attempts(packet_id);

    -- Invoices
    CREATE TABLE IF NOT EXISTS invoice_tokens (
      token TEXT PRIMARY KEY,
      owner_short_id TEXT NOT NULL,
      invoice_no TEXT,
      recipient_short_id TEXT,
      amount TEXT,
      fee_mode TEXT DEFAULT 'sender',
      note TEXT,
      merchant TEXT,
      due_date TEXT,
      tax_num TEXT,
      payer_short_id TEXT,
      payer_name TEXT,
      status TEXT DEFAULT 'draft',
      pay_link TEXT,
      sent_at TEXT,
      paid_at TEXT,
      tx_hash TEXT,
      invoice_mode TEXT DEFAULT 'personal',
      created_at TEXT DEFAULT ipay_now_text(),
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS invoice_transactions (
      invoice_token TEXT PRIMARY KEY,
      invoice_no TEXT,
      owner_short_id TEXT NOT NULL,
      recipient_short_id TEXT,
      amount TEXT,
      fee_mode TEXT DEFAULT 'recipient',
      status TEXT DEFAULT 'draft',
      payment_id TEXT,
      payer_address TEXT,
      amount_micro TEXT,
      chain_status INTEGER,
      note TEXT,
      merchant TEXT,
      due_date TEXT,
      tx_hash TEXT,
      paid_at TEXT,
      revoked_at TEXT,
      created_at TEXT DEFAULT ipay_now_text(),
      updated_at TEXT DEFAULT ipay_now_text()
    );

    CREATE TABLE IF NOT EXISTS invoice_payments (
      invoice_token TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      payer_address TEXT,
      amount_micro TEXT,
      linked_at TEXT DEFAULT ipay_now_text()
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS pending_notifications (
      id BIGSERIAL PRIMARY KEY,
      address TEXT NOT NULL,
      event TEXT NOT NULL,
      data TEXT,
      created_at BIGINT DEFAULT (ipay_epoch_seconds() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_notify_addr ON pending_notifications(address);

    -- User Contacts
    CREATE TABLE IF NOT EXISTS user_contacts (
      id BIGSERIAL PRIMARY KEY,
      user_addr TEXT NOT NULL,
      contact_addr TEXT NOT NULL,
      nickname TEXT,
      avatar TEXT,
      notes TEXT,
      tags TEXT,
      favorite INTEGER DEFAULT 0,
      created_at BIGINT DEFAULT (ipay_epoch_seconds()),
      updated_at BIGINT DEFAULT (ipay_epoch_seconds()),
      UNIQUE(user_addr, contact_addr)
    );
    CREATE INDEX IF NOT EXISTS idx_user_contacts_user ON user_contacts(user_addr);
    CREATE INDEX IF NOT EXISTS idx_user_contacts_favorite ON user_contacts(user_addr, favorite);

    -- Viewing Keys
    CREATE TABLE IF NOT EXISTS viewing_keys (
      address TEXT PRIMARY KEY,
      pubkey TEXT,
      viewing_pubkey TEXT,
      encrypted_privkey TEXT,
      iv TEXT,
      auth_tag TEXT,
      key_version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT ipay_now_text(),
      updated_at TEXT DEFAULT ipay_now_text()
    );

    -- Event Log
    CREATE TABLE IF NOT EXISTS event_log (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      address TEXT,
      details TEXT,
      created_at TEXT DEFAULT ipay_now_text()
    );
    CREATE INDEX IF NOT EXISTS idx_event_log_address ON event_log(address);

    -- Contact Aliases & Deletions
    CREATE TABLE IF NOT EXISTS deleted_contacts (
      owner_short_id TEXT NOT NULL,
      contact_short_id TEXT NOT NULL,
      deleted_at TEXT DEFAULT ipay_now_text(),
      PRIMARY KEY (owner_short_id, contact_short_id)
    );

    CREATE TABLE IF NOT EXISTS contact_aliases (
      owner_short_id TEXT NOT NULL,
      contact_short_id TEXT NOT NULL,
      alias TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT ipay_now_text(),
      updated_at TEXT DEFAULT ipay_now_text(),
      PRIMARY KEY (owner_short_id, contact_short_id)
    );

    -- Pay Sessions (dynamic payment QR)
    CREATE TABLE IF NOT EXISTS pay_sessions (
      token TEXT PRIMARY KEY,
      payer_short_id TEXT NOT NULL,
      payer_address TEXT NOT NULL,
      payee_short_id TEXT,
      payee_nickname TEXT,
      amount TEXT,
      memo TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT ipay_now_text(),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pay_sessions_status ON pay_sessions(status);

    -- Scan/WebRTC
    CREATE TABLE IF NOT EXISTS scan_sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT ipay_now_text(),
      result TEXT,
      resolved INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS webrtc_sessions (
      id TEXT PRIMARY KEY,
      offer TEXT,
      answer TEXT,
      ice_caller TEXT DEFAULT '[]',
      ice_callee TEXT DEFAULT '[]',
      created_at TEXT DEFAULT ipay_now_text()
    );

    -- Gift page views
    CREATE TABLE IF NOT EXISTS gift_views (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      viewer_address TEXT NOT NULL,
      viewer_nickname TEXT,
      viewer_short_id TEXT,
      created_at TEXT DEFAULT ipay_now_text(),
      UNIQUE(packet_id, viewer_address)
    );
    CREATE INDEX IF NOT EXISTS idx_gift_views_packet ON gift_views(packet_id);

    -- Gift reactions (community feedback on shared gift pages)
    CREATE TABLE IF NOT EXISTS gift_reactions (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      reactor_address TEXT NOT NULL,
      reactor_nickname TEXT,
      reactor_short_id TEXT,
      reaction TEXT NOT NULL DEFAULT '',
      comment TEXT,
      created_at TEXT DEFAULT ipay_now_text(),
      UNIQUE(packet_id, reactor_address)
    );
    CREATE INDEX IF NOT EXISTS idx_gift_reactions_packet ON gift_reactions(packet_id);

    CREATE TABLE IF NOT EXISTS gift_box_meta (
      box_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      collection TEXT NOT NULL DEFAULT 'other',
      image_urls TEXT NOT NULL DEFAULT '[]',
      source_url TEXT DEFAULT '',
      updated_at TEXT DEFAULT ipay_now_text()
    );
    ALTER TABLE gift_box_meta ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false;
    ALTER TABLE gift_box_meta ADD COLUMN IF NOT EXISTS featured_sort INTEGER DEFAULT 0;

    -- Gift comments (threaded replies, optional E2E encryption)
    CREATE TABLE IF NOT EXISTS gift_comments (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      parent_id BIGINT REFERENCES gift_comments(id) ON DELETE CASCADE,
      author_address TEXT NOT NULL,
      author_nickname TEXT,
      author_short_id TEXT,
      content TEXT DEFAULT '',
      content_encrypted TEXT,
      encryption_meta TEXT,
      is_private BOOLEAN DEFAULT false,
      created_at TEXT DEFAULT ipay_now_text()
    );
    CREATE INDEX IF NOT EXISTS idx_gift_comments_packet ON gift_comments(packet_id);
    CREATE INDEX IF NOT EXISTS idx_gift_comments_parent ON gift_comments(parent_id);

    -- Gift sponsor likes (patron appreciation)
    CREATE TABLE IF NOT EXISTS gift_sponsor_likes (
      id BIGSERIAL PRIMARY KEY,
      packet_id TEXT NOT NULL,
      sponsor_address TEXT NOT NULL,
      liker_address TEXT NOT NULL,
      like_type TEXT NOT NULL DEFAULT 'like',
      created_at TEXT DEFAULT ipay_now_text(),
      UNIQUE(packet_id, sponsor_address, liker_address)
    );
    CREATE INDEX IF NOT EXISTS idx_gift_sponsor_likes_packet ON gift_sponsor_likes(packet_id);
  `)
}
