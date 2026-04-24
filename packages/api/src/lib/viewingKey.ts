/**
 * Viewing key helper — single source of truth is the accounts table.
 *
 * - accounts.pubkey              : uncompressed secp256k1 viewing pubkey (hex)
 * - accounts.viewing_privkey_enc : server-encrypted viewing privkey
 *
 * Both columns are populated by routes/user/register.ts at account
 * creation. This helper exists for three reasons:
 *
 *   1. Make "look up a recipient's viewing pubkey" a one-line call that
 *      is consistent across /gift/send, /account/viewing-pubkey, and
 *      the public /account/viewing-pubkey/:shortId endpoint.
 *
 *   2. Auto-backfill the (very rare) legacy accounts that predate the
 *      viewing-key-at-registration convention and have an empty
 *      `pubkey` / `viewing_privkey_enc`. The backfill is idempotent:
 *      we only write into columns that are still NULL/empty.
 *
 *   3. Hide the SQL so every call site uses the same lowercase address
 *      comparison + COALESCE update pattern.
 *
 * Not involved in this helper (on purpose):
 *   - the parallel legacy `viewing_keys` TABLE used by
 *     routes/user/viewingKeys.ts. That system is orphaned and is
 *     scheduled for removal in a separate cleanup (see task #65).
 */

import { generateViewingKeyPair, encryptViewingPrivKey } from '../services/security/encryption'

export interface ResolvedViewingKey {
  /** 65-byte uncompressed secp256k1 pubkey as hex (no 0x prefix). */
  pubkeyHex: string
  /** Server-encrypted private key, base64-packed (see encryption.encryptViewingPrivKey). */
  privkeyEnc: string
  /** True if this call just generated and persisted a new keypair. */
  backfilled: boolean
}

/**
 * Ensure the `accounts` row for `address` has a usable viewing keypair.
 *
 * Returns the (possibly newly generated) pubkey + encrypted privkey.
 * Throws if no account row exists for the address.
 *
 * This is called on behalf of the recipient, often from a path where
 * the sender is the authenticated user. That is fine: viewing keys
 * are server-custodial, so generating one for another user exposes
 * no new data (it only becomes usable for encryption/decryption, and
 * the privkey stays wrapped with the server key).
 */
export function ensureViewingKey(
  db: any /* BetterSqlite-style Postgres compat */,
  address: string,
): ResolvedViewingKey {
  const row = db.prepare(
    'SELECT pubkey, viewing_privkey_enc FROM accounts WHERE lower(address) = lower(?)'
  ).get(address) as { pubkey?: string | null; viewing_privkey_enc?: string | null } | undefined

  if (!row) {
    throw new Error(`[ensureViewingKey] no accounts row for address=${address}`)
  }

  const hasPub = !!row.pubkey && row.pubkey.length > 0
  const hasPriv = !!row.viewing_privkey_enc && row.viewing_privkey_enc.length > 0

  if (hasPub && hasPriv) {
    return {
      pubkeyHex: row.pubkey!,
      privkeyEnc: row.viewing_privkey_enc!,
      backfilled: false,
    }
  }

  // Backfill: generate a fresh pair, write it only into columns that are
  // still empty (COALESCE+NULLIF). This keeps the operation safely
  // idempotent even if two requests race.
  const { privKey, pubKey } = generateViewingKeyPair()
  const newPubkeyHex = pubKey.toString('hex')
  const newPrivkeyEnc = encryptViewingPrivKey(privKey)

  db.prepare(
    `UPDATE accounts
        SET pubkey = COALESCE(NULLIF(pubkey, ''), ?),
            viewing_privkey_enc = COALESCE(NULLIF(viewing_privkey_enc, ''), ?)
      WHERE lower(address) = lower(?)`
  ).run(newPubkeyHex, newPrivkeyEnc, address)

  // Re-read to capture whatever was actually persisted (handles races).
  const after = db.prepare(
    'SELECT pubkey, viewing_privkey_enc FROM accounts WHERE lower(address) = lower(?)'
  ).get(address) as { pubkey: string; viewing_privkey_enc: string }

  console.log(`[ensureViewingKey] backfilled viewing key for ${address.slice(0, 12)}...`)

  return {
    pubkeyHex: after.pubkey,
    privkeyEnc: after.viewing_privkey_enc,
    backfilled: true,
  }
}

/**
 * Same as `ensureViewingKey` but looks up by `short_id`. Returns null if
 * the shortId doesn't resolve to any account.
 */
export function ensureViewingKeyByShortId(
  db: any,
  shortId: string,
): ResolvedViewingKey | null {
  const row = db.prepare(
    'SELECT address FROM accounts WHERE short_id = ?'
  ).get(shortId.toUpperCase()) as { address?: string } | undefined

  if (!row?.address) return null
  return ensureViewingKey(db, row.address)
}
