import { Link, Outlet, useLocation } from 'react-router-dom'
import { Home, FileText, DollarSign, Shield, Menu, X, Activity, Users, Gift } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/payments', label: 'Payments', icon: FileText },
  // { path: '/finance', label: 'Finance', icon: DollarSign },
  // { path: '/audit', label: 'Audit', icon: Shield },  // hidden — backend not implemented yet
  { path: '/accounts', label: 'Accounts', icon: Users },
  { path: '/status', label: 'Status', icon: Activity },
  { path: '/gift-artworks', label: 'Gift 🏺', icon: Gift },
  { path: '/sponsors', label: 'Sponsors 🏪', icon: Gift },
]

interface LayoutProps { address?: string; onLogout?: () => void }

export function Layout({ address, onLogout }: LayoutProps) {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-dark text-white">
      {/* Header */}
      <header className="glass border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-primary">iPay Admin</span>
            {address && (
              <span className="hidden sm:block text-xs text-muted-foreground font-mono">
                {address.slice(0,6)}…{address.slice(-4)}
              </span>
            )}
          </div>
          
          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition ${
                  location.pathname === path
                    ? 'bg-primary/20 text-primary'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {onLogout && (
              <button onClick={onLogout}
                className="hidden md:block text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                Sign out
              </button>
            )}
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <nav className="md:hidden glass border-b border-border p-4 space-y-2">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                location.pathname === path
                  ? 'bg-primary/20 text-primary'
                  : 'text-gray-400'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
