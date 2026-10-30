import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { RUN, installApi, makeOverview } from './fixtures'

const open = (path) => {
  window.localStorage.setItem('ns_user', 'arthur_demo')
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

beforeEach(() => { window.localStorage.clear(); installApi() })

describe('Evaluation page', () => {
  it('reports measured results with confidence intervals and the honest limits', async () => {
    open('/evaluation')
    expect(await screen.findByText('How well does the screen work?')).toBeInTheDocument()
    expect(screen.getByText('0 of 60')).toBeInTheDocument()
    expect(screen.getByText(/Very subtle/)).toBeInTheDocument()
    expect(screen.getAllByText(/95% CI/).length).toBeGreaterThan(3)
    expect(screen.getByText(/very subtle changes are mostly missed/i)).toBeInTheDocument() // the limit is stated, not hidden
    expect(screen.getByText(/simulator and the thresholds were developed together/)).toBeInTheDocument()
    expect(screen.getByText(/Simulated people/)).toBeInTheDocument()
  })

  it('tells you how to run it when nothing has been measured yet', async () => {
    installApi({ 'GET /api/evaluation': { __status: 404, body: { error: { code: 'not_found', message: 'none' } } } })
    open('/evaluation')
    expect(await screen.findByText('No evaluation has been run yet')).toBeInTheDocument()
    expect(screen.getByText('python scripts/run_evaluation.py')).toBeInTheDocument()
  })

  it('is reachable from the console menu', async () => {
    open('/lab')
    await screen.findByRole('slider', { name: /Day in the history/ })
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('link', { name: /Evaluation/ })).toBeInTheDocument()
  })
})

describe('Watch notifications on Today', () => {
  const note = { id: 5, kind: 'change_detected', title: 'A steady change was noticed', body: 'It may be worth mentioning at your next routine check-up.', signal: 'sustained_multi_domain_drift' }

  it('shows a gentle notification and hides it after "Got it", telling the server', async () => {
    const calls = installApi({ 'GET /api/users/arthur_demo/overview': { ...makeOverview(), notifications: [note] }, 'POST /api/users/arthur_demo/notifications/5/read': { read: true } })
    open('/')
    expect(await screen.findByText('A steady change was noticed')).toBeInTheDocument()
    expect(screen.getAllByText(/routine check-up/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByText('A steady change was noticed')).toBeNull())
    expect(calls.some((c) => c.url === '/api/users/arthur_demo/notifications/5/read' && c.method === 'POST')).toBe(true)
  })

  it('shows nothing extra when there are no notifications', async () => {
    open('/')
    await screen.findByText(/Your morning check-in/)
    expect(screen.queryByLabelText('Notifications from your assistant')).toBeNull()
  })
})

describe('Lab: the watch, and cached analyses', () => {
  it('runs the watch on demand and reports what it found', async () => {
    const calls = installApi({ 'POST /api/watch/scan': { results: [], changes: 2 } })
    open('/lab')
    fireEvent.click(await screen.findByRole('button', { name: /Run the watch now/ }))
    expect(await screen.findByText(/found 2 changes/)).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/watch/scan').body).toEqual({ include_synthetic: true })
  })

  it('says when an identical analysis was reused instantly, and can force the models to run again', async () => {
    const calls = installApi({
      'POST /api/users/arthur_demo/analyze/async': { job_id: 'jobC' },
      'GET /api/jobs/jobC': { status: 'done', run_id: '3f2a9c1b7d40', cached: true, events: [], steps: [] },
      'GET /api/runs/3f2a9c1b7d40': { ...RUN, as_of: '2026-03-31' },
    })
    open('/lab')
    fireEvent.click(await screen.findByRole('button', { name: /Run analysis as of day 90/ }))
    expect(await screen.findByText(/Instant: identical analysis reused/, {}, { timeout: 5000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run the models again' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/users/arthur_demo/analyze/async')).toHaveLength(2))
    expect(calls.filter((c) => c.url === '/api/users/arthur_demo/analyze/async')[1].body).toEqual({ as_of: '2026-03-31', force: true })
  }, 15000)
})

describe('Privacy copy follows where the check-in really runs', () => {
  it('says replies go to an AI when the check-in uses the cloud model', async () => {
    open('/privacy')
    expect(await screen.findByText(/The one exception: the daily check-in/)).toBeInTheDocument()
  })

  it('says replies never leave this machine when a local model runs the check-in', async () => {
    installApi({ 'GET /api/health': { status: 'ok', models: { analyst: 'a', fast: 'b' }, checkin_runs_locally: true, checkin_model: 'nemotron-3-nano:30b' } })
    open('/privacy')
    expect(await screen.findByText('The daily check-in stays on this machine')).toBeInTheDocument()
    expect(screen.getByText(/nemotron-3-nano:30b, a model running on this machine/)).toBeInTheDocument()
    expect(screen.queryByText(/The one exception/)).toBeNull()
  })
})

describe('Report: background reading', () => {
  const ref = { title: 'Typing dynamics in mild cognitive impairment', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', snippet: 'A study of typing.' }

  it('lists live-search references as unendorsed background, with safe external links', async () => {
    installApi({ 'GET /api/runs/3f2a9c1b7d40': { ...RUN, report: { ...RUN.report, references: [ref] } } })
    open('/report/3f2a9c1b7d40')
    expect(await screen.findByText(/Background reading/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: ref.title })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/not endorsed by it/)).toBeInTheDocument()
  })

  it('has no such section when literature search is off', async () => {
    open('/report/3f2a9c1b7d40')
    await screen.findByRole('article', { name: 'Clinician report' })
    expect(screen.queryByText(/Background reading/)).toBeNull()
  })
})
