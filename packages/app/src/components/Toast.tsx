/** Minimal Toast — standalone, no store dependency */
import { useState, useEffect } from 'react'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let _addToast: ((msg: string, type: ToastItem['type']) => void) | null = null

export function showToast(message: string, type: ToastItem['type'] = 'info') {
  _addToast?.(message, type)
}

export function Toast() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    _addToast = (message, type) => {
      const id = Date.now()
      setItems(prev => [...prev, { id, message, type }])
      setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 3500)
    }
    return () => { _addToast = null }
  }, [])

  if (!items.length) return null

  return (
    <div className="fixed bottom-6 left-0 right-0 flex flex-col items-center gap-2 z-50 pointer-events-none px-4">
      {items.map(t => (
        <div
          key={t.id}
          className={`
            px-4 py-2 rounded-xl text-xs text-white/80 backdrop-blur-sm border
            ${t.type === 'error' ? 'bg-red-900/60 border-red-500/30' :
              t.type === 'success' ? 'bg-green-900/60 border-green-500/30' :
              'bg-gray-900/80 border-white/10'}
          `}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
