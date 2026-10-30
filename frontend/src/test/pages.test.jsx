import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { RUN, installApi, makeOverview } from './fixtures'

const open = (path) => {
  window.localStorage.setItem('ns_user', 'arthur_demo')
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

beforeEach(() => { window.localStorage.clear(); installApi() })

describe('app shells: only the content scrolls, and phones get their own navigation', () => {
  it('Companion shell is one screen tall, never scrolls itself, and has a bottom tab bar for phones', async () => {
    const { container } = open('/')
    await screen.findByText(/Your morning check-in/)
    const root = container.firstElementChild
    expect(root.className).toContain('h-dvh')
    expect(root.className).toContain('overflow-hidden')
    const main = container.querySelector('main#main')
    expect(main.className).toContain('overflow-hidden')
    expect(main.querySelector('.scroll-y')).not.toBeNull() // the page's own region is what scrolls
    const tabBars = screen.getAllByRole('navigation', { name: 'Main' })
    expect(tabBars).toHaveLength(2) // desktop tabs + phone bottom bar
    expect(tabBars[1].className).toContain('lg:hidden')
    expect(within(tabBars[1]).getAllByRole('link')).toHaveLength(5)
  })

  it('Console shell has a drawer menu on phones that opens and closes', async () => {
    const { container } = open('/lab')
    await screen.findByRole('slider', { name: /Day in the history/ })
    expect(container.firstElementChild.className).toContain('h-dvh')
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const dialog = screen.getByRole('dialog', { name: 'Menu' })
    expect(within(dialog).getByRole('link', { name: /Clinician Report/ })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull()
  })

  it('has no fabricated security claims anywhere in the rendered pages', async () => {
    const banned = /SGX|AES-GCM|TLS 1\.3|cryptographically|enclave|attestation|zero-retention|90% of analysis/i
    for (const path of ['/', '/privacy', '/summary', '/runs/3f2a9c1b7d40', '/report/3f2a9c1b7d40']) {
      const { container, unmount } = open(path)
      await waitFor(() => expect(container.textContent.length).toBeGreaterThan(200), { timeout: 3000 })
      expect(container.textContent).not.toMatch(banned)
      unmount()
    }
  })
})

describe('Welcome', () => {
  it('needs a name and the acknowledgement before it lets you start, and creates a person with consent', async () => {
    window.localStorage.clear()
    const calls = installApi({ 'POST /api/users': { user: { user_id: 'wanjiru-abc123', display_name: 'Wanjiru', is_synthetic: false, checkin_consent: false } } })
    render(<MemoryRouter initialEntries={['/welcome']}><App /></MemoryRouter>)
    const start = await screen.findByRole('button', { name: /Get started/ })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Your first name'), { target: { value: 'Wanjiru' } })
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/not a medical device/))
    expect(start).toBeEnabled()
    fireEvent.click(screen.getByRole('switch', { name: /daily check-in/i })) // opt out
    fireEvent.click(start)
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/users')).toBe(true))
    expect(calls.find((c) => c.url === '/api/users' && c.method === 'POST').body).toEqual({ display_name: 'Wanjiru', checkin_consent: false })
  })

  it('redirects a visitor with no person to the welcome page', async () => {
    window.localStorage.clear()
    render(<MemoryRouter initialEntries={['/journal']}><App /></MemoryRouter>)
    expect(await screen.findByText('Your thoughts stay yours.')).toBeInTheDocument()
  })
})

describe('Today', () => {
  it('shows tri-coded status with text, and the newcomer view when there is no baseline yet', async () => {
    open('/')
    expect((await screen.findAllByText('Worth a conversation')).length).toBeGreaterThan(0)
    cleanup()
    installApi({ 'GET /api/users/arthur_demo/overview': { ...makeOverview('insufficient_data'), screen: { overall_signal: 'insufficient_data', history_days: 8, metrics: {}, domains: {} } } })
    open('/')
    expect(await screen.findByText('Getting to know your normal')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /baseline/i })).toHaveAttribute('aria-valuenow', '19')
  })
})

describe('Journal', () => {
  it('keeps the finish button disabled until there is enough typing, and previews numbers only', async () => {
    open('/journal')
    const area = await screen.findByLabelText('Your journal entry')
    const finish = screen.getByRole('button', { name: /Finish and share numbers/ })
    expect(finish).toBeDisabled()
    // The text typed by the person must never appear in the "what will be shared" preview.
    fireEvent.change(area, { target: { value: 'my secret garden sentence' } })
    const preview = document.querySelector('details pre')
    expect(preview.textContent).not.toContain('secret')
    expect(preview.textContent).toContain('"user_id": "arthur_demo"')
  })

  it('blocks pasting so measurements reflect real typing', async () => {
    open('/journal')
    const area = await screen.findByLabelText('Your journal entry')
    const evt = new Event('paste', { bubbles: true, cancelable: true })
    fireEvent(area, evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(await screen.findByText(/Pasting is turned off/)).toBeInTheDocument()
  })
})

describe('Privacy Inspector', () => {
  it('shows the allowed fields, rejects an injected field in a dry run, and accepts a compliant payload', async () => {
    const calls = installApi({
      'POST /api/ingest/validate': (init) => {
        const body = JSON.parse(init.body)
        return 'text' in body
          ? { __status: 400, body: { error: { code: 'invalid_payload', message: "unknown fields rejected by privacy wall: ['text']" } } }
          : { accepted: true, stored: false }
      },
    })
    open('/privacy')
    await screen.findByText('What leaves your device')
    expect(screen.getByRole('list', { name: 'Allowed fields' }).textContent).toContain('median_flight_ms')
    await waitFor(() => expect(screen.getByLabelText(/Outgoing data/).value).toContain('"text": "hello"'))
    fireEvent.click(screen.getByRole('button', { name: /Send test/ }))
    expect(await screen.findByText('Rejected.')).toBeInTheDocument()
    expect(screen.getByText(/unknown fields rejected by privacy wall/)).toBeInTheDocument()
    expect(screen.getByText('HTTP 400')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Compliant payload' }))
    await waitFor(() => expect(screen.getByLabelText(/Outgoing data/).value).not.toContain('"text"'))
    fireEvent.click(screen.getByRole('button', { name: /Send test/ }))
    expect(await screen.findByText('Accepted by the privacy wall.')).toBeInTheDocument()
    expect(calls.filter((c) => c.url === '/api/ingest')).toHaveLength(0) // dry run never stores anything
  })

  it('deleting all data needs a confirmation, and only the delete action is red', async () => {
    const calls = installApi({ 'DELETE /api/users/arthur_demo': { deleted: {} } })
    const { container } = open('/privacy')
    await screen.findByText('Your data controls')
    fireEvent.click(screen.getByRole('button', { name: /Delete all my data/ }))
    const dialog = screen.getByRole('alertdialog')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/users/arthur_demo')).toBe(true))
    const redUsers = [...container.querySelectorAll('[class*="danger"]')].filter((el) => !el.textContent.includes('Delete'))
    expect(redUsers).toHaveLength(0)
  })
})

describe('Summary', () => {
  it('offers to prepare a doctor summary for a sustained change and shows four domain cards', async () => {
    open('/summary')
    expect(await screen.findByRole('button', { name: /Prepare a summary for my doctor/ })).toBeInTheDocument()
    for (const title of ['Typing speed', 'Pauses and corrections', 'Word variety', 'Remembering']) expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument()
  })

  it('shows the calm variant without action buttons when everything is steady', async () => {
    installApi({ 'GET /api/users/arthur_demo/overview': makeOverview('stable') })
    open('/summary')
    expect(await screen.findByText('All looks steady')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Prepare a summary/ })).toBeNull()
  })
})

describe('Time-Travel Lab', () => {
  it('replays history with a slider, shows ground truth on demand, and runs a background analysis with progress', async () => {
    let polls = 0
    const calls = installApi({
      'POST /api/users/arthur_demo/analyze/async': { job_id: 'job1' },
      'GET /api/runs/3f2a9c1b7d40': { ...RUN, as_of: '2026-03-16' }, // the run is for the day we replayed to
      'GET /api/jobs/job1': () => { polls += 1; return polls < 2 ? { status: 'running', events: [{ node: 'load_screen' }], steps: ['load_screen', 'analyst'] } : { status: 'done', run_id: '3f2a9c1b7d40', events: [], steps: [] } },
    })
    open('/lab')
    const slider = await screen.findByRole('slider', { name: /Day in the history/ })
    expect(slider).toHaveAttribute('max', '89')
    fireEvent.change(slider, { target: { value: '74' } })
    expect(await screen.findByText(/Day 75/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Show ground truth'))
    expect(screen.getByText(/Gradual change begins, day 36/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Run analysis as of day 75/ }))
    expect(await screen.findByText('Open run details', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/users/arthur_demo/analyze/async').body).toEqual({ as_of: '2026-03-16', force: false })
  }, 15000)

  it('charts: seven measures, each with an accessible label', async () => {
    open('/lab')
    await screen.findByRole('slider', { name: /Day in the history/ })
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Line chart/ }).length).toBeGreaterThanOrEqual(7))
  })
})

describe('Analysis run and clinician report', () => {
  it('shows the pipeline, evidence, honest cost, and tabs', async () => {
    open('/runs/3f2a9c1b7d40')
    expect(await screen.findByText(/Execution pipeline/)).toBeInTheDocument()
    expect(screen.getByText('confounder_review')).toBeInTheDocument()
    expect(screen.getByText('90th-percentile inter-key pause')).toBeInTheDocument()
    expect(screen.getByText('$0.0042 total')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Guardrails/ }))
    expect(screen.getByText(/checked against the screen and passed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Trace/ }))
    expect(screen.getAllByText('safety_guard').length).toBeGreaterThanOrEqual(2) // pipeline card and trace row
  })

  it('/runs with no id opens the latest run', async () => {
    open('/runs')
    expect(await screen.findByText(/Execution pipeline/)).toBeInTheDocument()
  })

  it('report is one printable sheet with all seven measures, a synthetic stamp and the disclaimer', async () => {
    open('/report/3f2a9c1b7d40')
    expect(await screen.findByRole('article', { name: 'Clinician report' })).toBeInTheDocument()
    const rows = document.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(7)
    expect(screen.getByText(/SYNTHETIC DATA/)).toBeInTheDocument()
    expect(screen.getByText(/NOT a diagnosis/)).toBeInTheDocument()
    expect(document.querySelector('.no-print')).not.toBeNull() // toolbar disappears when printing
    expect(document.querySelector('.print-sheet')).not.toBeNull()
    // status uses the purple "worth a conversation" style, never red
    expect(document.querySelector('article [class*="text-danger"], article [class*="bg-error"]')).toBeNull()
  })
})

describe('error handling', () => {
  it('shows a friendly retry when the server cannot be reached, instead of a blank page', async () => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    window.localStorage.setItem('ns_user', 'arthur_demo')
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(await screen.findByText(/Cannot reach the NeuroShield server/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
