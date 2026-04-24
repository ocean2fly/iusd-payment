import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Smart "close" / "back" navigation.
 *
 * Returns a function that:
 *  - Calls `navigate(-1)` if the current location has any browser history
 *    to go back to (i.e. the user navigated TO this page from somewhere
 *    else in the SPA session).
 *  - Otherwise navigates to `fallback` (default: '/app' for the authed
 *    shell, but callers can override, e.g. '/' for unauthenticated share
 *    pages).
 *
 * React Router v6 assigns `location.key === 'default'` on the FIRST route
 * a user lands on when opening the app (no prior in-app history). Any
 * subsequent navigation inside the SPA gets a unique key. We use that to
 * decide whether `navigate(-1)` has a valid target; if not, we fall back.
 */
export function useSmartClose(fallback: string = '/app') {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    // `location.key === 'default'` means this is the first page of the
    // SPA session — no history to go back to.
    if (location.key && location.key !== 'default') {
      navigate(-1)
      return
    }

    // Clear the saved return path before falling back to home. Otherwise
    // landing pages (Landing.tsx, RequireAuth in App.tsx) read
    // `ipay2_return_path` from sessionStorage and immediately bounce the
    // user right back to the page they were trying to leave — most
    // visible on /gift/claim links opened via the camera, where ✕ did
    // nothing because Landing kept redirecting back to the gift page.
    try { sessionStorage.removeItem('ipay2_return_path') } catch {}

    navigate(fallback, { replace: true })
  }
}
