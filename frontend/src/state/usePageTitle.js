import { useEffect } from 'react'

/** Keep the browser tab title in step with the page, so tabs and history entries say where you are. */
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · NeuroShield` : 'NeuroShield'
  }, [title])
}