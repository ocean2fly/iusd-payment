/**
 * useTheme — reactive theme detection hook.
 * Returns 'light' or 'dark' based on user setting + system preference.
 */
import { useState, useEffect } from 'react'

type ThemeMode = 'auto' | 'light' | 'dark'

export function getEffectiveTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('ipay_theme') as ThemeMode | null
  if (stored === 'dark') return 'dark'
  if (stored === 'light') return 'light'
  // auto: follow system
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(getEffectiveTheme)

  useEffect(() => {
    // Listen for system preference changes
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme(getEffectiveTheme())
    mq.addEventListener('change', onChange)

    // Listen for localStorage changes (from Settings page)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ipay_theme') setTheme(getEffectiveTheme())
    }
    window.addEventListener('storage', onStorage)

    // Also poll for same-tab localStorage changes (storage event doesn't fire in same tab)
    const interval = setInterval(() => setTheme(getEffectiveTheme()), 1000)

    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('storage', onStorage)
      clearInterval(interval)
    }
  }, [])

  return theme
}
