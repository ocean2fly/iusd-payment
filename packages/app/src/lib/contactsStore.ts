/**
 * Contacts store — stateless API-backed helpers.
 *
 * Every request MUST be keyed on the caller's public shortId, never on the
 * init1 address. API routes enforce this (reject init1 with 400).
 *
 * There is no in-memory cache — callers own their own React state and
 * should call `loadContactsAsync` after every mutation to get a fresh list.
 *
 * Fire-and-forget legacy wrappers (`upsertContact`) still exist for back-
 * compat; they use a module-level token + shortId that AuthContext seeds
 * via `setContactsToken(token, shortId)`.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://api.iusd-pay.xyz/v1'

export interface Contact {
  shortId: string
  nickname: string
  shortSealSvg?: string | null
  addedAt: number
  alias?: string
}

// ── Module-level fire-and-forget token (set on login) ────────────

let _globalToken = ''
let _selfShortId = ''

/** AuthContext calls this on login so fire-and-forget upserts work. */
export function setContactsToken(token: string, shortId?: string) {
  _globalToken = token
  if (shortId) _selfShortId = shortId.toUpperCase()
}

// ── Public API ───────────────────────────────────────────────────

/** Resolve the shortId for an HTTP call. Callers pass `account.shortId`
 *  directly; if they only have an init1 address we fall back to the
 *  module-level shortId set by `setContactsToken`. */
function resolveShortId(maybeShortId: string): string {
  if (maybeShortId && !/^init1[a-z0-9]+$/i.test(maybeShortId) && !/^0x[0-9a-f]+$/i.test(maybeShortId)) {
    return maybeShortId.toUpperCase()
  }
  return _selfShortId
}

/**
 * Fetch unique counterparties from the user's recent activity. Used by:
 *   - Transfer / Gift recipient pickers' "From History" dropdown section
 *   - Contacts page "Import from History" button (bulk seed)
 *
 * Walks across ALL activity types that carry a counterparty —
 * payments, gifts (sent/received/pending/reply), so users who have
 * only exchanged gifts still get imported contacts. Deduped against
 * the optional excludeShortIds set (for contact dropdowns that want
 * history as a SECONDARY source).
 *
 * Paginates through up to `maxPages` cursor hops so we don't miss
 * older counterparties just because the first page was dominated by
 * a single chatty contact.
 */
export async function fetchCounterpartiesFromActivity(
  token: string,
  opts: { limit?: number; excludeShortIds?: Set<string>; maxPages?: number } = {},
): Promise<Contact[]> {
  const limit = opts.limit ?? 30
  const exclude = opts.excludeShortIds ?? new Set<string>()
  const maxPages = opts.maxPages ?? 5
  if (!token) return []
  // Pull everything that can have a counterparty: payments (both directions,
  // pending included), gifts (sent/received/pending/reply). Invoices don't
  // have their own activity type — they ride on payment_sent / payment_received
  // events, so the types list below already covers them.
  const types = [
    'payment_sent',
    'payment_received',
    'payment_pending',
    'gift_sent',
    'gift_received',
    'gift_pending',
    'gift_reply',
  ].join(',')

  try {
    const seen = new Set<string>()
    const out: Contact[] = []
    let cursor: string | null = null

    for (let page = 0; page < maxPages; page++) {
      const url =
        `${API_BASE}/activity?types=${types}&limit=${Math.max(limit, 50)}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) break
      const data = await r.json() as { items?: any[]; nextCursor?: string | null; hasMore?: boolean }
      const items: any[] = data.items ?? []

      // Walk newest-first, emit each counterparty's first appearance.
      for (const it of items) {
        const cpShort: string | undefined = it.counterparty?.shortId
        if (!cpShort) continue
        const sid = cpShort.toUpperCase()
        if (seen.has(sid) || exclude.has(sid)) continue
        seen.add(sid)
        out.push({
          shortId: sid,
          nickname: it.counterparty?.nickname ?? sid,
          shortSealSvg: null,
          addedAt: 0,
        })
        if (out.length >= limit) return out
      }

      if (!data.hasMore || !data.nextCursor) break
      cursor = data.nextCursor
    }
    return out
  } catch {
    return []
  }
}

/** Load contacts from server. Always fetches fresh (no cache). */
export async function loadContactsAsync(selfShortId: string, token: string): Promise<Contact[]> {
  const sid = resolveShortId(selfShortId)
  if (!sid || !token) return []
  try {
    const res = await fetch(`${API_BASE}/contacts/${encodeURIComponent(sid)}?limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.contacts ?? []).map((c: any) => ({
      shortId: c.nickname?.toUpperCase() || c.contactAddr,
      nickname: c.avatar || c.nickname || c.contactAddr,
      shortSealSvg: null,
      addedAt: c.createdAt || 0,
      alias: c.notes || '',
    }))
  } catch {
    return []
  }
}

/** Add or update a contact. Returns the fresh server list. */
export async function upsertContactAsync(
  selfShortId: string,
  token: string,
  contact: { shortId: string; nickname?: string; shortSealSvg?: string | null },
): Promise<Contact[]> {
  const sid = resolveShortId(selfShortId)
  const shortId = contact.shortId?.toUpperCase()
  if (!sid || !shortId || !token) return []
  try {
    await fetch(`${API_BASE}/contacts/${encodeURIComponent(sid)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contactAddr: shortId.toLowerCase(),
        nickname: shortId,
        avatar: contact.nickname ?? shortId,
      }),
    })
  } catch {}
  return loadContactsAsync(sid, token)
}

/** Delete a contact. Returns the fresh server list. */
export async function deleteContactAsync(
  selfShortId: string,
  token: string,
  contactShortId: string,
): Promise<Contact[]> {
  const sid = resolveShortId(selfShortId)
  if (!sid || !contactShortId || !token) return []
  try {
    await fetch(`${API_BASE}/contacts/${encodeURIComponent(sid)}/${contactShortId.toLowerCase()}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {}
  return loadContactsAsync(sid, token)
}

/** Fire-and-forget wrapper. Back-compat only — prefer `upsertContactAsync`. */
export function upsertContact(
  _addr: string,
  contact: { shortId: string; nickname?: string; shortSealSvg?: string | null },
  token?: string,
) {
  const t = token || _globalToken
  if (!t) return
  upsertContactAsync(_selfShortId, t, contact).catch(() => {})
}

/** Sync cache read. Stateless store — always returns []. */
export function loadContacts(_addr: string): Contact[] {
  return []
}

/** No-op save. Writes go through upsertContactAsync. */
export function saveContacts(_addr: string, _contacts: Contact[]) {}

/** No-op — cache removed. */
export function clearContactsCache() {}

// ── Backward compat exports (deprecated, kept for compilation) ───

export const CONTACTS_KEY = (_addr: string) => ''
export function loadDeletedContacts(_addr: string): string[] { return [] }
export function saveDeletedContacts(_addr: string, _ids: string[]) {}
export function isDeletedContact(_addr: string, _shortId: string): boolean { return false }

export function resolveDisplayName(
  aliases: Record<string, string>,
  shortId: string,
  nickname?: string,
): string {
  const alias = aliases[shortId?.toUpperCase()]
  if (alias) return alias
  return nickname || shortId
}
