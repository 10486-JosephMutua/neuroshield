import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Sparkline } from '../components/charts'
import { Icon, Skeleton, StatusChip, ErrorNotice } from '../components/ui'
import { signalInfo, toneStatus } from '../lib/signals'
import { addDays, firstName, greeting, longDate, monthDay, todayIso } from '../lib/format'
import { toWeekly } from '../lib/series'
import { DOMAINS, domainStatus } from '../lib/signals'
import { PageScroll, SanctuaryFooter } from '../shells/layout'
import { useAsync } from '../state/useAsync'
import { useUser } from '../state/UserContext'

const GLANCE = [
  { domain: 'motor', label: 'Typing rhythm', icon: 'keyboard' },
  { domain: 'linguistic', label: 'Word variety', icon: 'menu_book' },
  { domain: 'memory', label: 'Memory check-ins', icon: 'psychology' },
]

/** Shown only for fictional demo people: says what this person demonstrates and where to look next. */
function DemoGuide({ user }) {
  const [persona, setPersona] = useState(null)
  useEffect(() => {
    api.personas().then((r) => setPersona((r.personas || []).find((p) => p.user_id === user.user_id) || null)).catch(() => {})
  }, [user.user_id])
  return (
    <section className="mb-gutter rounded-lg bg-slight-bg/60 p-4 md:p-5" aria-label="Demo guide">
      <div className="mb-1 flex items-center gap-2 text-label-lg text-slight-fg"><Icon name="science" size={20} /> You are viewing {user.display_name}, a fictional demo person</div>
      {persona && <p className="mb-3 text-body-md text-on-surface">What this person shows: {persona.description}</p>}
      <p className="mb-3 text-body-sm text-on-surface-variant">Suggested path: read the summary, then open the Time-Travel Lab, move through the history and run an analysis. Use the person menu at the top right to switch to another demo person.</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/summary" className="btn btn-outline !min-h-[44px] !px-4">Read the summary</Link>
        <Link to="/lab" className="btn btn-primary !min-h-[44px] !px-4">Open the Time-Travel Lab</Link>
      </div>
    </section>
  )
}

const START_STEPS = [
  { to: '/journal', icon: 'edit_note', title: 'Write in your journal', text: 'Type a few sentences about anything. Only typing timing is measured, never your words.' },
  { to: '/checkin', icon: 'chat_bubble', title: 'Answer the daily check-in', text: 'A short friendly chat that notices how well you remember your plans.' },
  { to: '/summary', icon: 'insights', title: 'Read your summary', text: 'Once there is enough history, this shows how you compare with your own normal.' },
]

export default function Today() {
  const { user } = useUser()
  const [dismissed, setDismissed] = useState(false)
  const [seen, setSeen] = useState([])
  const { data, error, loading, reload } = useAsync(
    ({ signal }) => Promise.all([api.overview(user.user_id, undefined, { signal }), api.series(user.user_id, undefined, { signal })]),
    [user.user_id],
  )

  if (error) return <PageScroll><div className="flex justify-center py-10"><ErrorNotice error={error} onRetry={reload} /></div></PageScroll>
  if (loading || !data) {
    return <PageScroll><Skeleton className="mb-3 h-10 w-2/3" /><Skeleton className="mb-8 h-5 w-1/3" /><div className="grid gap-gutter md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div></PageScroll>
  }

  const [overview, series] = data
  const { screen, template, latest_analysis: latest, plans, min_history_days: minDays } = overview
  const asOf = screen.as_of || todayIso()
  const newcomer = screen.overall_signal === 'insufficient_data'
  const flightSeries = series.series.median_flight_ms || []
  const weekly = toWeekly(flightSeries, asOf, 12).map((w) => w.mean)
  const flightBase = screen.metrics?.median_flight_ms?.baseline
  const range = flightBase ? { low: flightBase.median - 2 * flightBase.spread, high: flightBase.median + 2 * flightBase.spread } : null
  const writingDays = flightSeries.filter((p) => p.day >= addDays(asOf, -6) && p.day <= asOf).length
  const progress = Math.min(100, Math.round(((screen.history_days ?? 0) / minDays) * 100))
  const notes = (overview.notifications || []).filter((n) => !seen.includes(n.id))
  const plan = plans[0]
  const message = latest?.is_current ? latest.patient_message : template.patient_message
  const checkinQuote = plan ? `Did you get to “${plan.plan}” like you mentioned?` : 'What are you looking forward to doing today?'

  return (
    <PageScroll>
      <h1 className="mb-1 text-headline-lg-mobile md:text-headline-lg">{greeting()}, {firstName(user.display_name)}</h1>
      <p className="mb-6 flex flex-wrap items-center gap-x-3 text-body-md text-on-surface-variant md:mb-8">
        <span>{longDate(todayIso())}</span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-primary"><span className="h-2 w-2 rounded-full bg-primary-container" /> Private on this device</span>
      </p>

      {user.is_synthetic && <DemoGuide user={user} />}

      {(newcomer || user.is_synthetic) && (
        <section className="card mb-gutter p-5 md:p-6" aria-labelledby="start">
          <h2 id="start" className="mb-1 flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="flag" className="text-primary" /> New here? Start with these three steps</h2>
          <p className="mb-4 text-body-md text-on-surface-variant">You can move around any time with the menu at the {' '}<span className="lg:hidden">bottom</span><span className="hidden lg:inline">top</span> of the screen.</p>
          <ol className="grid gap-3 md:grid-cols-3">
            {START_STEPS.map((st, i) => (
              <li key={st.to}>
                <Link to={st.to} className="flex h-full flex-col gap-2 rounded-lg bg-surface-container-low p-4 transition-colors hover:bg-surface-container">
                  <span className="flex items-center gap-2 text-label-lg text-primary"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-container text-on-primary text-label-md">{i + 1}</span><Icon name={st.icon} size={20} /> {st.title}</span>
                  <span className="text-body-sm text-on-surface-variant">{st.text}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {notes.length > 0 && (
        <section className="mb-gutter space-y-3" aria-label="Notifications from your assistant">
          {notes.map((n) => {
            const tone = toneStatus(n.kind === 'resolved' ? 'steady' : signalInfo(n.signal).tone)
            return (
              <div key={n.id} className={`flex items-start gap-3 rounded-lg p-4 ${tone.bg}`}>
                <Icon name={n.kind === 'resolved' ? 'check_circle' : 'notifications_active'} className={tone.fg} />
                <div className="min-w-0 flex-1">
                  <p className="text-label-lg text-on-surface">{n.title}</p>
                  <p className="text-body-md text-on-surface">{n.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link to="/summary" className="btn btn-outline !min-h-[44px] !px-4">Read my summary</Link>
                    <button type="button" className="btn btn-ghost !min-h-[44px] !px-4" onClick={async () => { setSeen((s) => [...s, n.id]); try { await api.markRead(user.user_id, n.id) } catch { /* it stays hidden for this visit */ } }}>Got it</button>
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <div className="grid gap-gutter lg:grid-cols-5">
        <div className="space-y-gutter lg:col-span-3">
          <section className="card p-5 md:p-8" aria-labelledby="ck">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 id="ck" className="flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="waving_hand" className="text-primary" /> Your morning check-in</h2>
              <span className="rounded-md bg-surface-container-low px-2 py-1 text-body-sm">2 min</span>
            </div>
            {overview.checkin_available && !dismissed ? (
              <>
                <div className="mb-5 flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-tertiary-fixed text-primary"><Icon name="sentiment_satisfied" /></span>
                  <p className="rounded-xl rounded-tl-sm bg-surface-container-low p-4 text-body-lg">“{checkinQuote}”</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link to="/checkin" className="btn btn-primary"><Icon name="chat_bubble" size={20} /> Reply</Link>
                  <button type="button" className="btn btn-ghost" onClick={() => setDismissed(true)}>Maybe later</button>
                </div>
              </>
            ) : (
              <p className="text-body-lg text-on-surface-variant">
                {overview.checkin_available ? 'No problem. Your check-in will be here whenever you are ready.' : 'The daily check-in is turned off.'}{' '}
                {!overview.checkin_available && <Link to="/privacy" className="font-semibold text-accent underline">Turn it on in Privacy</Link>}
              </p>
            )}
          </section>

          <section className="card p-5 md:p-8" aria-labelledby="wr">
            <h2 id="wr" className="mb-1 flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="edit_note" className="text-primary" /> Write something today</h2>
            <p className="mb-4 text-body-lg text-on-surface-variant">A few minutes of writing is all it takes.</p>
            <div className="mb-5 flex items-start gap-3 rounded-lg bg-surface-container p-4">
              <Icon name="lightbulb" className="text-primary" />
              <div><div className="text-label-md text-primary">Gentle prompt</div><div className="text-body-md">What was the most pleasant sound you heard this morning?</div></div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/journal" className="btn btn-outline"><Icon name="menu_book" size={20} /> Open journal</Link>
              <span className="rounded-lg bg-surface-container px-3 py-2 text-body-sm">{writingDays} {writingDays === 1 ? 'day' : 'days'} of writing this week</span>
            </div>
          </section>
        </div>

        <div className="space-y-gutter lg:col-span-2">
          {newcomer ? (
            <section className="card p-5 md:p-6" aria-labelledby="nb">
              <h2 id="nb" className="mb-2 text-headline-sm">Getting to know your normal</h2>
              <p className="mb-4 text-body-md text-on-surface-variant">Keep writing and checking in. It takes about {Math.round(minDays / 7)} weeks to learn what is usual for you.</p>
              <div className="h-3 overflow-hidden rounded-full bg-surface-container" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to a personal baseline">
                <div className="h-full rounded-full bg-primary-container transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-body-sm text-on-surface-variant">{screen.history_days ?? 0} of {minDays} days so far ({progress}%)</p>
            </section>
          ) : (
            <section className="card p-5 md:p-6" aria-labelledby="gl">
              <h2 id="gl" className="mb-4 flex items-center justify-between text-headline-sm md:text-headline-md">This week at a glance <Icon name="insights" className="text-primary" /></h2>
              <ul className="space-y-3">
                {GLANCE.map((g) => {
                  const d = screen.domains?.[g.domain]
                  const status = domainStatus(g.domain, d?.status, screen.overall_signal)
                  return (
                    <li key={g.domain} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-container-low p-3">
                      <span className="flex items-center gap-3 text-body-md"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-primary"><Icon name={g.icon} size={20} /></span>{g.label}</span>
                      <StatusChip kind={d ? status.key : 'steady'} />
                    </li>
                  )
                })}
              </ul>
              {weekly.length > 1 && (
                <div className="mt-5">
                  <div className="mb-2 flex justify-between text-label-md"><span>Rhythm stability band</span><span className="font-normal text-on-surface-variant">Shaded = your usual range</span></div>
                  <Sparkline values={weekly} range={range} label="Typing rhythm over recent weeks" />
                </div>
              )}
            </section>
          )}

          <section className="card p-5 md:p-6" aria-labelledby="ls">
            <div className="mb-3 flex items-baseline justify-between gap-2"><h2 id="ls" className="text-headline-sm md:text-headline-md">Latest summary</h2><span className="text-body-sm text-on-surface-variant">Up to {monthDay(asOf)}</span></div>
            <p className="mb-3 rounded-lg bg-steady-bg p-3 text-body-md text-on-surface">{message}</p>
            <Link to="/summary" className="inline-flex min-h-[48px] items-center gap-1 text-label-lg text-accent">Read my summary <Icon name="arrow_forward" size={20} /></Link>
          </section>
        </div>
      </div>

      <section className="mt-gutter flex flex-wrap items-center justify-between gap-3 rounded-lg bg-teal-tint p-4 md:p-5">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-white"><Icon name="lock" size={20} /></span>
          <div><div className="text-label-lg">Your words stay on your device. Only numbers are shared.</div><div className="text-body-sm text-on-surface-variant">The optional check-in is the one exception, and you control it.</div></div></div>
        <Link to="/privacy" className="text-label-lg text-accent underline underline-offset-2">What is shared?</Link>
      </section>
      <section className="mt-gutter flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-container-low p-4 md:p-5">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-primary"><Icon name="stethoscope" size={20} /></span>
          <div><div className="text-label-lg">Are you a clinician, or want to see how it works?</div><div className="text-body-sm text-on-surface-variant">Replay a person’s history, inspect each analysis step and open the clinician report.</div></div></div>
        <Link to="/lab" className="btn btn-outline">Open the clinician console</Link>
      </section>
      <SanctuaryFooter synthetic={user.is_synthetic} />
    </PageScroll>
  )
}
