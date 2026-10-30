import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Icon, Logo, Spinner, Toggle } from '../components/ui'
import { checkinWhere, useHealth } from '../state/useHealth'
import { useUser } from '../state/UserContext'

const REASSURE = [
  { icon: 'lock', text: 'We never read your words' },
  { icon: 'person', text: 'Everything is compared with your own normal, not anyone else’s' },
  { icon: 'visibility', text: 'You can see, download and delete your data at any time' },
]

/** First-run page: create a person with explicit consent, or explore with a fictional demo person. */
export default function Welcome() {
  const { refresh, setUserId, user } = useUser()
  const where = checkinWhere(useHealth())
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [checkin, setCheckin] = useState(true)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [personas, setPersonas] = useState([])

  useEffect(() => {
    api.personas().then((r) => setPersonas(r.personas || [])).catch(() => { /* the single demo button still works */ })
  }, [])

  const ready = ack && name.trim().length > 0

  async function start() {
    setBusy('start'); setError(null)
    try {
      const { user: created } = await api.createUser(name, checkin)
      await refresh()
      setUserId(created.user_id)
      navigate('/')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function demo(id = 'arthur_demo') {
    setBusy(id === 'arthur_demo' ? 'demo' : id); setError(null)
    try {
      const { personas } = await api.personas()
      if (!personas.every((p) => p.seeded)) await api.seed()
      await refresh()
      setUserId(id)
      navigate('/')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="print-reset h-dvh overflow-y-auto bg-surface">
      <div className="mx-auto flex min-h-full max-w-[1040px] flex-col px-margin-mobile pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] md:px-margin">
        <header className="flex items-center justify-between py-2">
          <span className="flex items-center gap-2"><Logo className="h-9 w-9" /><span className="font-headline text-headline-sm text-primary">NeuroShield</span></span>
          {user && <Link to="/" className="btn btn-ghost !min-h-[44px] !px-3">Back to the app</Link>}
        </header>

        <main className="grid flex-1 items-start gap-8 py-6 lg:grid-cols-2 lg:gap-12">
          <section className="lg:sticky lg:top-8">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-xl bg-teal-tint"><Logo className="h-12 w-12" /></div>
            <h1 className="mb-3 text-headline-xl-mobile md:text-headline-xl">Your thoughts stay yours.</h1>
            <p className="mb-8 text-body-lg text-on-surface-variant">
              NeuroShield notices changes in how you type, never what you write. Only numbers ever leave your device.
            </p>
            <ul className="space-y-4">
              {REASSURE.map((r) => (
                <li key={r.icon} className="flex items-start gap-3 text-body-lg">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal"><Icon name={r.icon} size={22} /></span>
                  <span className="pt-1.5">{r.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-6 md:p-8" aria-labelledby="consent-title">
            <h2 id="consent-title" className="mb-5 text-headline-md">Before we begin</h2>
            <label className="mb-5 block">
              <span className="mb-1 block text-label-lg">What should we call you?</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="given-name"
                className="min-h-[48px] w-full rounded-md border-[1.5px] border-border bg-white px-4 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" placeholder="Your first name" />
            </label>
            <div className="space-y-5">
              <Toggle id="c-track" checked disabled onChange={() => {}} label="Typing-pattern tracking (numbers only)" description="Required. Measures timing, never letters." />
              <Toggle id="c-checkin" checked={checkin} onChange={setCheckin} label="Friendly daily check-in"
                description={where.local ? 'A friendly chat that notices how well you remember. It runs on a model on this machine, so your words never leave it.' : 'Your replies are sent to an AI so it can notice how well you remember. This is the only time words leave your device.'} />
              <label className="flex min-h-[48px] cursor-pointer items-start gap-4">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-[#0F766E]" />
                <span>I understand NeuroShield is not a medical device and cannot diagnose anything.</span>
              </label>
            </div>
            {error && <p role="alert" className="mt-4 rounded-md bg-worth-bg p-3 text-body-sm text-worth-fg">{error}</p>}
            <button type="button" className="btn btn-primary mt-6 w-full" disabled={!ready || busy !== null} onClick={start}>
              {busy === 'start' && <Spinner className="h-4 w-4" />} Get started
            </button>
            {!ready && <p className="mt-2 text-center text-body-sm text-on-surface-variant">Please add your name and tick the box to continue.</p>}
            <div className="mt-5 flex flex-col items-center gap-2 border-t border-border pt-5 text-center">
              <button type="button" className="btn btn-outline w-full" onClick={() => demo()} disabled={busy !== null}>
                {busy === 'demo' ? <Spinner className="h-4 w-4" /> : <Icon name="science" size={20} />} Explore with a fictional demo person
              </button>
              {personas.length > 0 && (
                <div className="mt-2 w-full text-left">
                  <p className="mb-2 text-label-md text-on-surface-variant">Testers: pick a fictional person to see a different situation</p>
                  <ul className="space-y-2">
                    {personas.map((p) => (
                      <li key={p.user_id}>
                        <button type="button" disabled={busy !== null} onClick={() => demo(p.user_id)}
                          className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg bg-surface-container-low p-3 text-left transition-colors hover:bg-surface-container disabled:opacity-60">
                          <span><span className="block text-label-lg">{p.display_name}</span><span className="block text-body-sm text-on-surface-variant">{p.description}</span></span>
                          {busy === p.user_id ? <Spinner className="h-4 w-4" /> : <Icon name="arrow_forward" size={20} className="text-primary" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link to="/privacy" className="text-label-md text-accent underline underline-offset-2">See exactly what is shared</Link>
            </div>
          </section>
        </main>
        <footer className="py-4 text-center text-body-sm text-on-surface-variant">The demo people are fictional and their data is synthetic.</footer>
      </div>
    </div>
  )
}