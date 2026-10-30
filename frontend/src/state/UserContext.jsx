import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api/client'
import { ErrorNotice, FullScreenSpinner } from '../components/ui'

const STORAGE_KEY = 'ns_user'
const UserContext = createContext(null)

const readStored = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // storage can be blocked (private mode); the app still works for this tab
  }
}

/** Who is using the app. Only an opaque user id is remembered in the browser. */
export function UserProvider({ children }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [storedId, setStoredId] = useState(readStored)

  const refresh = useCallback(async () => {
    try {
      const { users: list } = await api.users()
      setUsers(list)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setUserId = useCallback((id) => {
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setStoredId(id)
  }, [])

  const user = useMemo(() => users.find((u) => u.user_id === storedId) ?? null, [users, storedId])
  const value = useMemo(
    () => ({ users, user, userId: user?.user_id ?? null, setUserId, refresh, loading, error }),
    [users, user, setUserId, refresh, loading, error],
  )
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export const useUser = () => useContext(UserContext)

/** Pages that need a person: shows a loader, an error with retry, or sends new visitors to the welcome page. */
export function RequireUser({ children }) {
  const { user, loading, error, refresh } = useUser()
  if (loading) return <FullScreenSpinner label="Loading…" />
  if (error && !user) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorNotice error={error} onRetry={refresh} />
      </div>
    )
  }
  if (!user) return <Navigate to="/welcome" replace />
  return children
}
