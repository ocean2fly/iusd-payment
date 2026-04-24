/**
 * AuthContext — persists auth state across route changes.
 *
 * Single instance, lives in Providers above the router.
 * Landing and RequireAuth both read from this context.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { useAuth, type AuthState } from './useAuth'

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

const FALLBACK_AUTH_STATE: AuthState = {
  status: 'idle',
  address: null,
  token: null,
  account: null,
  error: null,
  errorKind: null,
  ikLoading: true,
  retry: () => {},
  refreshAccount: async () => {},
  triggerSign: () => {},
}

export function useAuthContext(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    // Context not yet available (e.g. during concurrent render before AuthProvider mounts).
    // Return a "still loading" state so RequireAuth shows a loading screen
    // instead of redirecting or rendering page content with missing data.
    return FALLBACK_AUTH_STATE
  }
  return ctx
}
