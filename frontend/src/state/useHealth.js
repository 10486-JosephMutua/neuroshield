import { useEffect, useState } from 'react'
import { api } from '../api/client'

let cached = null

/** Server facts the copy depends on (for example: does the check-in run on a local model?). Fetched once. */
export function useHealth() {
  const [health, setHealth] = useState(cached)
  useEffect(() => {
    if (cached) return undefined
    let alive = true
    api.health().then((h) => { cached = h; if (alive) setHealth(h) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return health
}

/** Honest wording for where check-in replies go. */
export function checkinWhere(health) {
  return health?.checkin_runs_locally
    ? { local: true, short: 'Your replies are processed by a model running on this machine and never leave it.', toggle: 'Replies are processed on a model running on this machine.' }
    : { local: false, short: 'Your replies are sent to an AI to be scored. Only a number is kept, not your words.', toggle: 'Chat replies are sent to an AI to be scored.' }
}
