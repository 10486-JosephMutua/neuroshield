import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Run an async function when `deps` change and expose { data, error, loading, reload }.
 * Stale responses (from a previous dependency value or after unmount) are ignored, and the
 * request's AbortSignal is aborted so the browser can cancel it.
 */
export function useAsync(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const runId = useRef(0)
  const controller = useRef(null)

  const run = useCallback(async () => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const id = ++runId.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await fnRef.current({ signal: abort.signal })
      if (id === runId.current) setState({ data, error: null, loading: false })
    } catch (error) {
      if (error?.name === 'AbortError' || id !== runId.current) return
      setState((s) => ({ ...s, error, loading: false }))
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }))
      return undefined
    }
    run()
    return () => controller.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps])

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), [])
  return { ...state, reload: run, setData }
}
