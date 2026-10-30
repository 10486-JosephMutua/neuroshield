import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { USERS, installApi, makeOverview } from './fixtures'

const open = (path) => {
  window.localStorage.setItem('ns_user', 'arthur_demo')
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

// What the server sends for a person who has not written anything yet: no as_of, no history_days.
const NO_DATA_OVERVIEW = {
  ...makeOverview('insufficient_data'),
  last_payload: null,
  plans: [],
  screen: { overall_signal: 'insufficient_data', reason: 'no data', metrics: {}, domains: {} },
}

beforeEach(() => { window.localStorage.clear(); installApi() })

describe('finding your way around', () => {
  it('has a Help guide on every Companion page that links to the clinician console, and closes with Escape', async () => {
    open('/')
    await screen.findByText(/Your morning check-in/)
    fireEvent.click(screen.getByRole('button', { name: /Help: finding your way around/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Finding your way around' })
    expect(within(dialog).getByRole('link', { name: /Clinician console/ })).toHaveAttribute('href', '/lab')
    expect(within(dialog).getByRole('link', { name: /My Summary/ })).toHaveAttribute('href', '/summary')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Finding your way around' })).toBeNull())
  })

  it('the console header names the page you are on and keeps the tab title in step', async () => {
    open('/lab')
    await screen.findByRole('slider', { name: /Day in the history/ })
    expect(document.title).toBe('Time-Travel Lab · NeuroShield')
    expect(screen.getByRole('banner')).toHaveTextContent('Time-Travel Lab')
  })

  it('the console Privacy Inspector stays inside the console instead of switching to the Companion app', async () => {
    open('/lab')
    await screen.findByRole('slider', { name: /Day in the history/ })
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('link', { name: /Privacy Inspector/ }))
    expect(await screen.findByText('What leaves your device')).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: 'Console' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(document.title).toBe('Privacy Inspector · NeuroShield')
  })

  it('an address that does not exist says so, and offers a way back, instead of silently redirecting', async () => {
    open('/no-such-page')
    expect(await screen.findByText('We could not find that page')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Go to Today/ })).toHaveAttribute('href', '/')
  })

  it('Back on a report opened directly goes to the Lab instead of leaving the app', async () => {
    open('/report/3f2a9c1b7d40')
    await screen.findByRole('article', { name: 'Clinician report' })
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByRole('slider', { name: /Day in the history/ })).toBeInTheDocument()
  })
})

describe('a brand-new person', () => {
  it('sees three clear first steps on Today', async () => {
    installApi({ 'GET /api/users/arthur_demo/overview': NO_DATA_OVERVIEW })
    open('/')
    expect(await screen.findByText(/Start here: three small steps/)).toBeInTheDocument()
    expect(screen.getByText('Write your first journal entry')).toBeInTheDocument()
    expect(screen.getByText('Getting to know your normal')).toBeInTheDocument()
  })

  it('no longer sees "Invalid Date" on My Summary, and is told how far along they are', async () => {
    installApi({ 'GET /api/users/arthur_demo/overview': NO_DATA_OVERVIEW })
    open('/summary')
    expect(await screen.findByText(/We are still getting to know your normal/)).toBeInTheDocument()
    expect(screen.getByText(/You are 0 days in/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Invalid Date/)
  })

  it('a returning person whose browser forgot them can pick their name on the Welcome page', async () => {
    const wanjiru = { user_id: 'wanjiru-abc123', display_name: 'Wanjiru', is_synthetic: false, checkin_consent: true, session_count: 12 }
    installApi({ 'GET /api/users': { users: [...USERS, wanjiru] } })
    render(<MemoryRouter initialEntries={['/welcome']}><App /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Continue as Wanjiru/ }))
    await waitFor(() => expect(window.localStorage.getItem('ns_user')).toBe('wanjiru-abc123'))
  })

  it('the Welcom~e page explains how the app works', async () => {
    render(<MemoryRouter initialEntries={['/welcome']}><App /></MemoryRouter>)
    const steps = await screen.findByRole('list', { name: 'How it works' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)
  })
})