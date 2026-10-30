import { useCallback, useRef, useState } from 'react'
import { runAnalysis } from '../api/client'

export const STEP_LABELS = {
  load_screen: 'Screening the numbers',
  confounder_review: 'Reviewing everyday explanations',
  analyst: 'Analysing',
  verify: 'Checking the work',
  safety_guard: 'Applying safety rules',
  build_report: 'Preparing the report',
}

/**
 * Start an analysis in the background and follow it. `progress.completed` lists the pipeline nodes
 * that have finished so far, which drives the stepper shown while the models work.
 */
export function useAnalysisRunner() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ completed: [], steps: Object.keys(STEP_LABELS) })
  const [error, setError] = useState(null)
  const active = useRef(false)

  const run = useCallback(async (userId, asOf, { force = false } = {}) => {
    if (active.current) return null
    active.current = true
    setRunning(true); setError(null); setProgress({ completed: [], steps: Object.keys(STEP_LABELS) })
    try {
      return await runAnalysis(userId, asOf, {
        force,
        onProgress: (job) => setProgress({ completed: job.events.map((e) => e.node), steps: job.steps || Object.keys(STEP_LABELS) }),
      })
    } catch (e) {
      setError(e)
      return null
    } finally {
      active.current = false
      setRunning(false)
    }
  }, [])

  return { run, running, progress, error, clearError: () => setError(null) }
}
