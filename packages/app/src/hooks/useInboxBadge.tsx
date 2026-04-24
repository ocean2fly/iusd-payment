/**
 * useInboxBadge — inbox red-dot count provider.
 *
 * Counts unread items by hitting /v1/activity?types=gift_pending,payment_pending,gift_reply&limit=1
 * once per revision bump from useUnreadSync. Never polls on every render.
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { API_BASE } from '../config'
import { useAuth } from './useAuth'
import { useUnreadSync } from './useUnreadSync'

interface InboxBadgeState {
  count: number
  refresh: () => void
}

const InboxBadgeContext = createContext<InboxBadgeState>({ count: 0, refresh: () => {} })

export function InboxBadgeProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const { revision } = useUnreadSync()
  const [count, setCount] = useState(0)

  const refresh = useCallback(() => {
    if (!token) { setCount(0); return }
    fetch(`${API_BASE}/activity?types=gift_pending,payment_pending,gift_reply&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setCount(0); return }
        // Count from response metadata. If hasMore is true we know there are
        // more than 1 unread item — otherwise use items.length.
        const items = Array.isArray(d.items) ? d.items : []
        setCount(d.hasMore ? Math.max(items.length + 1, 1) : items.length)
      })
      .catch(() => setCount(0))
  }, [token])

  // Re-fetch once per revision change (and once on token change)
  useEffect(() => { refresh() }, [refresh, revision])

  return (
    <InboxBadgeContext.Provider value={{ count, refresh }}>
      {children}
    </InboxBadgeContext.Provider>
  )
}

export function useInboxBadge() {
  return useContext(InboxBadgeContext)
}
