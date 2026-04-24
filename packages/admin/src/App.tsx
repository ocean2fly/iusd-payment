import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Payments } from './pages/Payments'
import { Finance } from './pages/Finance'
import { GiftArtworks } from './pages/GiftArtworks'
import Sponsors from './pages/Sponsors'
import { Audit } from './pages/Audit'
import Status from './pages/Status'
import { Accounts } from './pages/Accounts'
import { Login } from './pages/Login'
import { verifyAdminToken, clearAdminToken } from './lib/adminAuth'

export default function App() {
  const [authed, setAuthed]   = useState<boolean | null>(null) // null = checking
  const [address, setAddress] = useState('')

  useEffect(() => {
    verifyAdminToken().then(ok => setAuthed(ok))
  }, [])

  function handleLogin(addr: string) {
    setAddress(addr)
    setAuthed(true)
  }

  function handleLogout() {
    clearAdminToken()
    setAuthed(false)
    setAddress('')
  }

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Checking auth…</div>
      </div>
    )
  }

  if (!authed) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <Routes>
      <Route path="/" element={<Layout address={address} onLogout={handleLogout} />}>
        <Route index element={<Dashboard />} />
        <Route path="payments" element={<Payments />} />
        {/* <Route path="finance" element={<Finance />} /> */}
        <Route path="audit" element={<Audit />} />
        <Route path="status" element={<Status />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="gift-artworks" element={<GiftArtworks />} />
        <Route path="sponsors" element={<Sponsors />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
