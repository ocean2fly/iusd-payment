/**
 * useActivity — unified activity timeline hook
 *
 * Replaces scattered fetchers for inbox / history / gift history with a single
 * cursor-paginated endpoint `/v1/activity` plus `/v1/activity/stats`.
 *
 * Server-side behaviour (see packages/api/src/routes/user/activity.ts):
 *   - Multi-source parallel fetch (gifts, payments, invoices, replies)
 *   - Cursor = ISO timestamp, descending
 *   - Gift items already aggregate replies (replyCount / latestReply in data)
 *   - `gift_reply` is a separate type for the Inbox Reply tab
 *
 * Usage:
 *   const { items, loadingMore, hasMore, loadMore, refresh } =
 *     useActivity({ types: ['gift_sent','gift_received'], limit: 20 })
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { useAuth } from './useAuth'

export type ActivityType =
  | 'payment_sent'
  | 'payment_received'
  | 'payment_pending'
  | 'gift_sent'
  | 'gift_received'
  | 'gift_pending'
  | 'gift_reply'
  | 'invoice_sent'
  | 'invoice_received'
  | 'invoice_paid'

export interface ActivityItem {
  id: string
  type: ActivityType
  at: string
  amountMicro?: string
  status?: string
  // Privacy: counterparty never carries the init1 `address` — only the
  // public handles (shortId + nickname). The API strips address from all
  // activity responses.
  counterparty?: {
    shortId?: string
    nickname?: string
  }
  data: Record<string, any>
}

export interface ActivityStats {
  thisMonth: {
    giftsSent: number
    giftsReceived: number
    paymentsSent: number
    paymentsReceived: number
  }
  total: {
    giftsSent: number
    giftsReceived: number
    paymentsSent: number
    paymentsReceived: number
    incomeIusd?: string
    expenseIusd?: string
  }
  unread: {
    pendingGifts: number
    pendingPayments?: number
    unseenReplies: number
  }
}

interface UseActivityOpts {
  types?: ActivityType[]
  limit?: number
  /** If false, don't auto-load on mount. Default true. */
  auto?: boolean
  /** Time ordering. 'desc' = newest first (default), 'asc' = oldest first. */
  sort?: 'asc' | 'desc'
}

interface UseActivityReturn {
  items: ActivityItem[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
}

export function useActivity(opts: UseActivityOpts = {}): UseActivityReturn {
  const { token } = useAuth()
  const limit = opts.limit ?? 20
  const typesKey = (opts.types ?? []).join(',')
  const auto = opts.auto !== false
  const sort = opts.sort ?? 'desc'

  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Guard stale responses when filters change mid-flight.
  const reqIdRef = useRef(0)

  const fetchPage = useCallback(async (cursor: string | null) => {
    if (!token) return null
    const params = new URLSearchParams()
    params.set('limit', String(limit))
    if (typesKey) params.set('types', typesKey)
    if (cursor) params.set('cursor', cursor)
    if (sort === 'asc') params.set('sort', 'asc')
    const r = await fetch(`${API_BASE}/activity?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`activity ${r.status}`)
    return await r.json() as {
      items: ActivityItem[]
      nextCursor: string | null
      hasMore: boolean
    }
  }, [token, limit, typesKey, sort])

  const refresh = useCallback(async () => {
    if (!token) { setItems([]); setHasMore(false); return }
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const d = await fetchPage(null)
      if (!d || myReq !== reqIdRef.current) return
      setItems(d.items ?? [])
      setNextCursor(d.nextCursor ?? null)
      setHasMore(!!d.hasMore)
    } catch (e: any) {
      if (myReq === reqIdRef.current) setError(e?.message ?? 'load failed')
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [token, fetchPage])

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return
    const myReq = reqIdRef.current
    setLoadingMore(true)
    try {
      const d = await fetchPage(nextCursor)
      if (!d || myReq !== reqIdRef.current) return
      setItems(prev => [...prev, ...(d.items ?? [])])
      setNextCursor(d.nextCursor ?? null)
      setHasMore(!!d.hasMore)
    } catch (e: any) {
      if (myReq === reqIdRef.current) setError(e?.message ?? 'load failed')
    } finally {
      if (myReq === reqIdRef.current) setLoadingMore(false)
    }
  }, [hasMore, nextCursor, loadingMore, fetchPage])

  useEffect(() => {
    if (auto) { refresh() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, typesKey, limit, auto, sort])

  return { items, loading, loadingMore, hasMore, error, refresh, loadMore }
}

/** Lightweight hook for the stats card (server-computed, not derived from items). */
export function useActivityStats(): {
  stats: ActivityStats | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const { token } = useAuth()
  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!token) { setStats(null); return }
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/activity/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (r.ok) setStats(await r.json())
    } catch {} finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  return { stats, loading, refresh }
}
