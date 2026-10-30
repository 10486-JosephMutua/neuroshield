/** Client for the Flask API. Every failure becomes an `ApiError` with a readable message. */
const BASE = import.meta.env?.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request(method, path, body, { signal } = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError(0, 'network', 'Cannot reach the NeuroShield server. Check that it is running, then try again.')
  }
  let data = null
  try {
    data = await response.json()
  } catch {
    /* non-JSON body */
  }
  if (!response.ok) {
    const err = data?.error
    throw new ApiError(response.status, err?.code || 'error', err?.message || `Request failed (${response.status}).`)
  }
  return data
}

const get = (path, opts) => request('GET', path, undefined, opts)
const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return s.toString() ? `?${s}` : ''
}

export const api = {
  health: () => get('/api/health'),
  contract: () => get('/api/privacy/contract'),
  users: () => get('/api/users'),
  createUser: (display_name, checkin_consent) => request('POST', '/api/users', { display_name, checkin_consent }),
  setConsent: (id, checkin_consent) => request('PUT', `/api/users/${id}/settings`, { checkin_consent }),
  deleteUser: (id) => request('DELETE', `/api/users/${id}`),
  exportUrl: (id) => `${BASE}/api/users/${id}/export`,
  personas: () => get('/api/demo/personas'),
  seed: () => request('POST', '/api/demo/seed', {}),
  validate: (payload) => request('POST', '/api/ingest/validate', payload),
  ingest: (payload) => request('POST', '/api/ingest', payload),
  overview: (id, asOf, opts) => get(`/api/users/${id}/overview${q({ as_of: asOf })}`, opts),
  series: (id, asOf, opts) => get(`/api/users/${id}/series${q({ as_of: asOf })}`, opts),
  screen: (id, asOf, opts) => get(`/api/users/${id}/screen${q({ as_of: asOf })}`, opts),
  startAnalysis: (id, as_of, force = false) => request('POST', `/api/users/${id}/analyze/async`, { as_of, force }),
  job: (jobId, opts) => get(`/api/jobs/${jobId}`, opts),
  run: (runId) => get(`/api/runs/${runId}`),
  runs: (id) => get(`/api/users/${id}/runs`),
  evaluation: () => get('/api/evaluation'),
  watchScan: (include_synthetic = false) => request('POST', '/api/watch/scan', { include_synthetic }),
  notifications: (id) => get(`/api/users/${id}/notifications`),
  markRead: (id, nid) => request('POST', `/api/users/${id}/notifications/${nid}/read`, {}),
  plans: (id) => get(`/api/users/${id}/plans`),
  deletePlan: (id, memoryId) => request('DELETE', `/api/users/${id}/plans/${memoryId}`),
  checkin: (id) => request('POST', `/api/users/${id}/checkin`, {}),
  checkinReply: (id, reply, plan_memory_id) => request('POST', `/api/users/${id}/checkin/reply`, { reply, plan_memory_id }),
}

/**
 * Poll a background job until it finishes. `onProgress(job)` is called on every poll so the UI can
 * show which pipeline step is running. Rejects with an ApiError if the job fails or times out.
 */
export async function waitForJob(jobId, { onProgress, intervalMs = 700, timeoutMs = 5 * 60 * 1000, signal } = {}) {
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const job = await api.job(jobId, { signal })
    onProgress?.(job)
    if (job.status === 'done') return job
    if (job.status === 'failed') throw new ApiError(job.error?.http_status || 500, job.error?.code || 'job_failed', job.error?.message || 'The analysis failed.')
    if (Date.now() - started > timeoutMs) throw new ApiError(504, 'timeout', 'The analysis is taking too long. Please try again.')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * Start an analysis and wait for it; resolves with the stored run. `run.cached` is true when an identical,
 * still-valid analysis was reused (instant and free); pass { force: true } to run the models again.
 */
export async function runAnalysis(userId, asOf, opts = {}) {
  const { job_id } = await api.startAnalysis(userId, asOf, Boolean(opts.force))
  const job = await waitForJob(job_id, opts)
  return { ...(await api.run(job.run_id)), cached: Boolean(job.cached) }
}
