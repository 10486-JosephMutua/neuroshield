import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Sparkline } from '../components/charts'
import { AnalysisStepper, ErrorNotice, Icon, Skeleton, Spinner, StatusChip } from '../components/ui'
import { addDays, monthDay } from '../lib/format'
import { toWeekly } from '../lib/series'
import { DOMAINS, DOMAIN_SENTENCES, domainStatus } from '../lib/signals'
import { PageScroll, SanctuaryFooter } from '../shells/layout'
import { STEP_LABELS, useAnalysisRunner } from '../state/useAnalysisRunner'
import { useAsync } from '../state/useAsync'
import { useUser } from '../state/UserContext'

const LINE = { steady: '#005c55', slight: '#B45309', worth: '#5B21B6' }
const CAUSES = [{ icon: 'bedtime', text: 'Tiredness' }, { icon: 'keyboard', text: 'A new keyboard' }, { icon: 'calendar_view_week', text: 'A busy week' }, { icon: 'bedtime', text: 'Poor sleep' }]

export default function Summary() {
  const { user } = useUser()
  const navigate = useNavigate()
  const [hideActions, setHideActions] = useState(false)
  const runner = useAnalysisRunner()
  const { data, error, loading, reload } = useAsync(
    ({ signal }) => Promise.all([api.overview(user.user_id, undefined, { signal }), api.series(user.user_id, undefined, { signal })]),
    [user.user_id],
  )

  if (error) return <PageScroll><div className="flex justify-center py-10"><ErrorNotice error={error} onRetry={reload} /></div></PageScroll>
  if (loading || !data) return <PageScroll><Skeleton className="mb-4 h-10 w-1/2" /><Skeleton className="mb-8 h-48" /><div className="grid gap-gutter md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}</div></PageScroll>

  const [overview, series] = data
  const { screen, template, latest_analysis: latest } = overview
  const asOf = screen.as_of
  const current = Boolean(latest?.is_current)
  const message = current ? latest.patient_message : template.patient_message
  const recommendation = current ? latest.recommendation : template.recommendation
  const newcomer = screen.overall_signal === 'insufficient_data'
  const worth = recommendation === 'suggest_routine_checkup'

  async function refreshSummary() {
    const run = await runner.run(user.user_id, asOf)
    if (run) reload()
  }
  async function prepareForDoctor() {
    if (current) return navigate(`/report/${latest.run_id}`)
    const run = await runner.run(user.user_id, asOf)
    if (run) navigate(`/report/${run.run_id}`)
  }

  const hero = worth
    ? { bg: 'bg-worth-bg/50', icon: 'forum', iconFg: 'text-worth-fg', kicker: 'Rhythm reflection', kickerFg: 'text-accent' }
    : recommendation === 'keep_monitoring'
      ? { bg: 'bg-slight-bg/50', icon: 'visibility', iconFg: 'text-slight-fg', kicker: 'Worth keeping an eye on', kickerFg: 'text-slight-fg' }
      : { bg: 'bg-steady-bg/60', icon: 'check_circle', iconFg: 'text-steady-fg', kicker: 'All looks steady', kickerFg: 'text-steady-fg' }

  return (
    <PageScroll>
      <p className="mb-1 flex items-center gap-2 text-label-md uppercase tracking-wider text-primary"><Icon name="calendar_month" size={18} /> Monthly perspective</p>
      <h1 className="mb-1 text-headline-lg-mobile md:text-headline-lg">Your monthly summary</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">{monthDay(addDays(asOf, -29))} to {monthDay(asOf)}</p>

      <section className={`mb-8 rounded-lg p-5 md:p-8 ${hero.bg}`} aria-labelledby="hero">
        <div className="flex items-start gap-4">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white ${hero.iconFg}`}><Icon name={hero.icon} /></span>
          <div className="min-w-0 flex-1">
            <p id="hero" className={`mb-2 text-label-md uppercase tracking-wider ${hero.kickerFg}`}>{hero.kicker}</p>
            <p className="mb-5 font-headline text-[19px] leading-8 md:text-[22px] md:leading-9">“{message}”</p>
            {runner.running ? (
              <div className="rounded-lg bg-white p-4"><p className="mb-3 text-label-lg">Updating your summary…</p><AnalysisStepper progress={runner.progress} labels={STEP_LABELS} /></div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {worth && !hideActions && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={prepareForDoctor}><Icon name="assignment" size={20} /> Prepare a summary for my doctor</button>
                    <button type="button" className="btn btn-outline" onClick={() => setHideActions(true)}>Not now</button>
                  </>
                )}
                {!newcomer && <button type="button" className="btn btn-ghost" onClick={refreshSummary}><Icon name="refresh" size={20} /> {current ? 'Update my summary' : 'Write my summary'}</button>}
              </div>
            )}
            {runner.error && <p role="alert" className="mt-3 rounded-md bg-white p-3 text-body-sm text-worth-fg">{runner.error.message}</p>}
          </div>
        </div>
      </section>

      {newcomer ? (
        <div className="card p-6 text-center"><Icon name="hourglass_top" size={36} className="mb-2 text-outline" /><p className="text-body-lg">We are still getting to know your normal. Keep writing and checking in; your comparison will appear here.</p><Link to="/journal" className="btn btn-primary mt-4">Open journal</Link></div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="text-headline-sm md:text-headline-md">How your patterns compare with your own normal</h2><p className="text-body-md text-on-surface-variant">Compared only against your own first weeks, not other people.</p></div>
            <span className="text-body-sm text-on-surface-variant"><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-teal/15 align-middle" /> Shaded = your usual range</span>
          </div>
          <div className="mb-8 grid gap-gutter md:grid-cols-2">
            {Object.entries(DOMAINS).map(([key, d]) => {
              const dom = screen.domains?.[key]
              if (!dom) return null
              const status = domainStatus(key, dom.status, screen.overall_signal)
              const base = screen.metrics?.[d.metric]?.baseline
              const weekly = toWeekly(series.series[d.metric] || [], asOf, 12).map((w) => w.mean)
              const range = base ? { low: base.median - 2 * base.spread, high: base.median + 2 * base.spread } : null
              return (
                <article key={key} className="card p-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-body text-label-lg"><Icon name={d.icon} className="text-primary" size={22} /> {d.title}</h3><StatusChip kind={status.key} small /></div>
                  <p className="mb-3 text-body-md text-on-surface-variant">{DOMAIN_SENTENCES[key][status.key]}</p>
                  <Sparkline values={weekly} range={range} color={LINE[status.key]} height={72} label={`${d.title} over the last 12 weeks`} />
                  <div className="mt-1 flex justify-between text-[12px] text-on-surface-variant"><span>12 weeks ago</span><span className="font-semibold text-on-surface">Now</span></div>
                </article>
              )
            })}
          </div>
        </>
      )}

      <section className="card mb-6 p-5 md:p-6">
        <h2 className="text-headline-sm">Everyday things that can cause this</h2>
        <p className="mb-4 text-body-md text-on-surface-variant">Fluctuations are natural and often temporary.</p>
        <ul className="flex flex-wrap gap-2">{CAUSES.map((c) => <li key={c.text} className="inline-flex items-center gap-2 rounded-full bg-surface-container px-4 py-2 text-label-md"><Icon name={c.icon} size={18} /> {c.text}</li>)}</ul>
      </section>
      <p className="flex items-center justify-center gap-2 text-center text-body-sm text-on-surface-variant"><Icon name="eco" size={16} /> This is a gentle overview, not a diagnosis.</p>
      <SanctuaryFooter synthetic={user.is_synthetic} />
    </PageScroll>
  )
}
