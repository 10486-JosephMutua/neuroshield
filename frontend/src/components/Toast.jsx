import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Icon } from './ui'

const ToastContext = createContext(() => {})

/** Small, polite notifications. Messages auto-dismiss; errors stay a little longer. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const counter = useRef(0)

  const toast = useCallback((message, kind = 'success') => {
    const id = ++counter.current
    setItems((list) => [...list, { id, message, kind }])
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 5000)
  }, [])

  const value = useMemo(() => toast, [toast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex flex-col items-center gap-2 px-4 lg:bottom-6" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg px-4 py-3 text-body-md shadow-card-hover
            ${t.kind === 'error' ? 'bg-inverse-surface text-inverse-on-surface' : 'bg-primary text-on-primary'}`}>
            <Icon name={t.kind === 'error' ? 'error' : 'check_circle'} size={22} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
