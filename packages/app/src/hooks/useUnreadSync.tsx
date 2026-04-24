/**
 * useUnreadSync — shared red-dot propagation.
 *
 * When a user opens a gift with unread activity anywhere in the app, the
 * UI optimistically clears that row's badge AND calls `markSeen(packetId)`
 * here. `markSeen` POSTs to /v1/gift/:packetId/seen and bumps a shared
 * revision counter. Other mounted gift lists subscribe to the revision
 * and re-fetch their data so every surface stays in sync.
 *
 * This is a BACK-channel sync only — individual callers still clear their
 * own local state for instant feedback.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { API_BASE } from '../config'
import { useAuth } from './useAuth'

interface UnreadSyncState {
  revision: number
  markSeen: (packetId: string) => Promise<void>
  bumpRevision: () => void
}

const UnreadSyncContext = createContext<UnreadSyncState>({
  revision: 0,
  markSeen: async () => {},
  bumpRevision: () => {},
})

export function UnreadSyncProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [revision, setRevision] = useState(0)

  const bumpRevision = useCallback(() => {
    setRevision(r => r + 1)
  }, [])

  const markSeen = useCallback(async (packetId: string) => {
    if (!token || !packetId) return
    try {
      await fetch(`${API_BASE}/gift/${packetId}/seen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch { /* best-effort */ }
    setRevision(r => r + 1)
  }, [token])

  return (
    <UnreadSyncContext.Provider value={{ revision, markSeen, bumpRevision }}>
      {children}
    </UnreadSyncContext.Provider>
  )
}

export function useUnreadSync(): UnreadSyncState {
  return useContext(UnreadSyncContext)
}
