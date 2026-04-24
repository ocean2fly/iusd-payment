import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { lazy, Suspense, useState, useEffect } from 'react'
import i18n from 'i18next'
import { AuthProvider, useAuthContext } from './hooks/AuthContext'
import { InboxBadgeProvider } from './hooks/useInboxBadge'
import { UnreadSyncProvider } from './hooks/useUnreadSync'
import NotFound     from './pages/NotFound'
import Verify       from './pages/Verify'
import ReceiptView  from './pages/ReceiptView'
import InvoiceView  from './pages/InvoiceView'
import ProfileCard  from './pages/ProfileCard'
import PayRequest   from './pages/PayRequest'
import Landing from './pages/Landing'
const DemoSeal = lazy(() => import('./pages/DemoSeal'))
const InstallGuide = lazy(() => import('./pages/InstallGuide'))
const DemoWallet = lazy(() => import('./pages/DemoWallet'))
const Welcome = lazy(() => import('./pages/Welcome'))
const Register = lazy(() => import('./pages/Register'))
const Registered = lazy(() => import('./pages/Registered'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const Contacts = lazy(() => import('./pages/Contacts').then(m => ({ default: m.Contacts })))
const Transfer = lazy(() => import('./pages/Transfer').then(m => ({ default: m.Transfer })))
const InBox = lazy(() => import('./pages/InBox').then(m => ({ default: m.InBox })))
const Request = lazy(() => import('./pages/Request').then(m => ({ default: m.Request })))
const Merchant = lazy(() => import('./pages/Merchant').then(m => ({ default: m.Merchant })))
// const Invoices = lazy(() => import('./pages/Invoices').then(m => ({ default: m.Invoices })))
const Scan = lazy(() => import('./pages/Scan').then(m => ({ default: m.Scan })))
const ScanRelayPage = lazy(() => import('./pages/Scan').then(m => ({ default: m.ScanRelayPage })))
const History = lazy(() => import('./pages/History').then(m => ({ default: m.History })))
const Gift = lazy(() => import('./pages/Gift').then(m => ({ default: m.Gift })))
const GiftClaim = lazy(() => import('./pages/GiftClaim'))
const GiftClaimShort = lazy(() => import('./pages/GiftClaimShort'))
import { PayLink }   from './pages/PayLink'
import { AppLayout } from './components/AppLayout'
import { Toast } from './components/Toast'
import { UpdateBanner } from './components/UpdateBanner'

/**
 * RequireAuth — reads from AuthContext (single instance, no remounting).
 * Registered → render children
 * Anything else → back to landing
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, ikLoading } = useAuthContext()
  const location = useLocation()

  // Give IK time to restore session before deciding user is unauthenticated.
  // Without this, a page refresh briefly shows status='idle' + ikLoading=false
  // before IK's debounce kicks in, causing a flash redirect to landing.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1500)
    return () => clearTimeout(t)
  }, [])

  if (status === 'registered') {
    // Restore intended path after refresh-triggered re-auth
    const returnPath = sessionStorage.getItem('ipay2_return_path')
    if (returnPath && returnPath !== '/app/welcome'
        && returnPath !== location.pathname
        && (returnPath.startsWith('/app/') || returnPath.startsWith('/gift/'))) {
      sessionStorage.removeItem('ipay2_return_path')
      return <Navigate to={returnPath} replace />
    }
    sessionStorage.removeItem('ipay2_return_path')
    return <>{children}</>
  }

  // Still initializing — show loading screen
  if (!ready || ikLoading || status === 'checking' || status === 'signing') {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', gap: 16,
      }}>
        <img src="/images/iusd.png?v=20260414" width={48} height={48}
          style={{ borderRadius: '50%', opacity: 0.85 }} alt="" />
        <div style={{ fontSize: 13, color: 'var(--muted)', letterSpacing: '0.05em' }}>
          {i18n.t('common.loading')}
        </div>
      </div>
    )
  }

  // No wallet connected and IK finished loading → redirect
  if (status === 'idle') {
    if (location.pathname.startsWith('/app')) {
      sessionStorage.setItem('ipay2_return_path', location.pathname + location.search)
    }
    return <Navigate to="/" replace />
  }

  if (status === 'unregistered') return <Navigate to="/app/welcome" replace />

  // Definitively unauthenticated — save path and redirect to landing
  if (location.pathname.startsWith('/app')) {
    sessionStorage.setItem('ipay2_return_path', location.pathname + location.search)
  }
  return <Navigate to="/" replace />
}

const PageFallback = () => (
  <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center',
                background:'var(--bg)', color:'var(--muted)', fontSize:13 }}>
    Loading…
  </div>
)

/** Shared layout: single AppLayout instance for all /app/* routes */
function AuthLayout() {
  return (
    <RequireAuth>
      <AppLayout>
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </AppLayout>
    </RequireAuth>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}><Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo-seal"        element={<DemoSeal />} />
      <Route path="/install"          element={<Suspense><InstallGuide /></Suspense>} />
      <Route path="/demo-wallet"     element={<DemoWallet />} />
      <Route path="/app/welcome"     element={<Welcome />} />
      <Route path="/app/register"    element={<Register />} />
      <Route path="/app/registered"  element={<Registered />} />

      {/* All /app/* routes share a single RequireAuth + AppLayout */}
      <Route path="/app" element={<AuthLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="settings"   element={<Settings />} />
        <Route path="contacts"   element={<Contacts />} />
        <Route path="transfer"   element={<Transfer />} />
        <Route path="inbox"      element={<InBox />} />
        <Route path="scan"       element={<Scan />} />
        <Route path="history"    element={<History />} />
        <Route path="accounting" element={<Navigate to="/app/history" replace />} />
        <Route path="merchant"   element={<Merchant />} />
        <Route path="request"    element={<Request />} />
        <Route path="gift"       element={<Gift />} />
      </Route>

      <Route path="/scan-relay/:sessionId" element={<ScanRelayPage />} />
      {/* Public pay link — no auth required */}
      <Route path="/pay/:shortId" element={<PayLink />} />
      {/* Public payment verification — linked from Receipt PDF QR */}
      <Route path="/verify" element={<Verify />} />
      {/* Print-friendly receipt view — iOS-safe alternative to popup PDF */}
      <Route path="/receipt/:paymentId" element={<ReceiptView />} />
      <Route path="/invoice/:token"     element={<InvoiceView />} />
      <Route path="/profile/:shortId"   element={<ProfileCard />} />
      <Route path="/pay-request/:token" element={<PayRequest />} />
      <Route path="/pr/:token"          element={<PayRequest />} />
      <Route path="/g/:code"              element={<GiftClaimShort />} />
      <Route path="/gift/claim"         element={<GiftClaim />} />
      <Route path="/gift/show"          element={<GiftClaim />} />
      <Route path="/app/gift/claim"     element={<GiftClaim />} />
      {/* Legacy route aliases — redirect instead of 404 */}
      <Route path="/app/invoices"  element={<Navigate to="/app/history" replace />} />
      <Route path="/app/receipts"  element={<Navigate to="/app/history" replace />} />
      <Route path="/app/dashboard" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UnreadSyncProvider>
          <InboxBadgeProvider>
            <AppRoutes />
            {/* Global toast outlet — showToast() calls become no-ops
                unless this is mounted somewhere in the tree. */}
            <Toast />
            {/* PWA / cached shell update checker — shows a small banner
                when a newer build is deployed so users on stale PWA
                installs can self-update without reinstalling. */}
            <UpdateBanner />
          </InboxBadgeProvider>
        </UnreadSyncProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
