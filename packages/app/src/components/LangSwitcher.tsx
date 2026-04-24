import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES, setLocale, type LocaleCode } from '../i18n'

export function LangSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Resolve current — i18next may report 'zh' when 'zh-CN' is loaded; match prefix.
  const current =
    SUPPORTED_LOCALES.find(l => l.code === i18n.language) ??
    SUPPORTED_LOCALES.find(l => i18n.language?.startsWith(l.code)) ??
    SUPPORTED_LOCALES[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] tracking-wider transition-opacity hover:opacity-80"
        style={{ color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--border)' }}
        aria-label="Change language"
      >
        <span style={{ color: 'var(--text)' }}>{current.native}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 end-0 max-h-72 overflow-y-auto rounded-lg z-50"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            minWidth: 180,
            boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          }}
        >
          {SUPPORTED_LOCALES.map(l => (
            <button
              key={l.code}
              onClick={() => { setLocale(l.code as LocaleCode); setOpen(false) }}
              className="w-full text-start px-3 py-2 text-xs transition-colors hover:bg-[var(--bg-elevated)]"
              style={{
                color: l.code === current.code ? 'var(--text)' : 'var(--muted)',
                fontWeight: l.code === current.code ? 600 : 400,
              }}
            >
              <span>{l.native}</span>
              {l.code !== 'en' && (
                <span className="ms-2 text-[10px]" style={{ color: 'var(--muted)' }}>
                  {l.name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
