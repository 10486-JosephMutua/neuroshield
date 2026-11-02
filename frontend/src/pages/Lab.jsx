import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { MetricChart } from '../components/charts'
import { AnalysisStepper, Badge, ErrorNotice, Icon, Skeleton, Spinner, StatusChip } from '../components/ui'
import { addDays, daysBetween, monthDay, metricValue, usd } from '../lib/format'
import { upTo, valueAt } from '../lib/series'
import { DOMAINS, RECOMMENDATIONS, signalInfo, toneStatus, domainStatus } from '../lib/signals'
import { SplitPanes } from '../shells/layout'
import { STEP_LABELS, useAnalysisRunner } from '../state/useAnalysisRunner'
import { useAsync } from '../state/useAsync'
import { useUser } from '../state/UserContext'

const CHARTS = [
  { key: 'median_flight_ms', title: 'Median flight time', kicker: 'Motor velocity', color: '#005c55' },
  { key: 'hold_time_ms', title: 'Key hold time', kicker: 'Motor coordination', color: '#005c55' },
  { key: 'p90_pause_ms', title: 'Long-pause length (p90)', kicker: 'Hesitation profile', color: '#4338CA' },
  { key: 'pause_rate', title: 'Pauses per 100 keys', kicker: 'Hesitation frequency', color: '#4338CA' },
  { key: 'correction_rate', title: 'Correction rate', kicker: 'Typing corrections', color: '#005c55' },
  { key: 'lexical_diversity', title: 'Lexical diversity', kicker: 'Language complexity', color: '#005c55' },
  { key: 'recall_score', title: 'Delayed recall', kicker: 'Episodic memory', color: '#005c55' },
]

/**
 * Time-Travel Lab: replay a person's history day by day. The statistical screen at the chosen day is
 * instant and free (no model); "Run analysis" starts the full AI pipeline as a background job.
 */
export default function Lab() {
  const { user, users, setUserId } = useUser()
  const runner = useAnalysisRunner()
  const toast = useToast()
  const [scanning, setScanning] = useState(false)
  const [dayIndex, setDayIndex] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [truth, setTruth] = useState(false)
  const [screen, setScreen] = useState(null)
  const [screenError, setScreenError] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [seeding, setSeeding] = useState(false)

  const personas = useAsync(() => api.personas(), [users.length])
  const history = useAsync(({ signal }) => api.series(user.user_id, undefined, { signal }), [user.user_id])

  const firstDay = history.data?.first_day
  const series = history.data?.series
  const lastDay = useMemo(() => {
    const all = Object.values(series || {}).flat().map((p) => p.day)
    return all.length ? all.reduce((a, b) => (a > b ? a : b)) : null
  }, [series])
  const totalDays = firstDay && lastDay ? daysBetween(firstDay, lastDay) + 1 : 0
  const index = dayIndex === null ? Math.max(0, totalDays - 1) : Math.min(dayIndex, Math.max(0, totalDays - 1))
  const asOf = firstDay ? addDays(firstDay, index) : null
  const persona = personas.data?.personas.find((p) => p.user_id === user.user_id)

  // Reset the replay when the person changes.
  useEffect(() => { setDayIndex(null); setPlaying(false); setScreen(null); setLastRun(null) }, [user.user_id])

  // Playback: advance one day per tick; stop at the end.
  const tick = useRef(null)
  useEffect(() => {
    if (!playing) return undefined
    tick.current = setInterval(() => setDayIndex((i) => {
      const next = (i === null ? 0 : i) + 1
      if (next >= totalDays - 1) { setPlaying(false); return totalDays - 1 }
      return next
    }), 220 / speed)
    return () => clearInterval(tick.current)
  }, [playing, speed, totalDays])

  // The screen at the chosen day (debounced so dragging the slider stays smooth).
  useEffect(() => {
    if (!asOf) return undefined
    const abort = new AbortController()
    const t = setTimeout(async () => {
      try { setScreen(await api.screen(user.user_id, asOf, { signal: abort.signal })); setScreenError(null) } catch (e) { if (e.name !== 'AbortError') setScreenError(e) }
    }, 120)
    return () => { clearTimeout(t); abort.abort() }
  }, [user.user_id, asOf])

  async function seed() {
    setSeeding(true)
    try { await api.seed(); window.location.reload() } catch (e) { setSeeding(false) }
  }
  async function runNow(force = false) {
    const run = await runner.run(user.user_id, asOf, { force })
    if (run) setLastRun(run)
  }
  async function watchNow() {
    setScanning(true)
    try {
      const { changes } = await api.watchScan(true)
      toast(changes ? `The watch found ${changes} change${changes === 1 ? '' : 's'}. Notifications are waiting on each person's Today page.` : 'The watch found nothing new: no one changed since its last look.')
    } catch (e) { toast(e.message, 'error') } finally { setScanning(false) }
  }

  const signal = signalInfo(screen?.overall_signal)
  const tone = toneStatus(signal.tone)
  const noHistory = history.data && !totalDays

  const left = (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="text-headline-sm md:text-headline-md">Longitudinal cadence signals</h2><Badge className="bg-teal-tint text-teal">{CHARTS.length} measures</Badge></div>
      <p className="mb-3 text-body-sm text-on-surface-variant">Shaded area = the first 28 days (personal baseline). Dashed line = baseline median. The vertical line is the selected day; later days are faded.</p>
      {history.loading && !series ? <div className="grid gap-3 md:grid-cols-2">{CHARTS.map((c) => <Skeleton key={c.key} className="h-44" />)}</div> : (
        <div className="grid gap-3 pb-4 md:grid-cols-2">
          {CHARTS.map((c, i) => {
            const pts = series?.[c.key] || []
            const now = valueAt(upTo(pts, asOf), asOf)
            const base = screen?.metrics?.[c.key]
            return (
              <article key={c.key} className={`card p-4 ${i === CHARTS.length - 1 ? 'md:col-span-2' : ''}`}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">{c.kicker}</div><h3 className="font-headline text-headline-sm leading-6">{c.title}</h3></div>
                  <div className="text-right"><div className="font-mono text-[18px] font-semibold">{metricValue(c.key, now?.value)}</div>{base?.recent && <div className="text-[12px] text-on-surface-variant">{base.recent.change_pct > 0 ? '+' : ''}{base.recent.change_pct}% vs baseline</div>}</div>
                </div>
                <MetricChart points={pts} firstDay={firstDay} totalDays={totalDays} cursorDay={asOf} events={persona?.events || []} showEvents={truth} color={c.color} height={i === CHARTS.length - 1 ? 110 : 120} />
                <div className="mt-1 flex justify-between text-[11px] text-on-surface-variant"><span>Day 1</span><span>Day 28 baseline</span><span>Day {totalDays}</span></div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )

  const right = (
    <div className="space-y-3 pb-4">
      <section className="card p-4" aria-live="polite">
        <div className="mb-3 flex items-center justify-between"><span className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">Signal at day {index + 1}</span>{asOf && <span className="font-mono text-[12px]">{monthDay(asOf)}</span>}</div>
        {screenError ? <ErrorNotice error={screenError} /> : !screen ? <Skeleton className="h-28" /> : (
          <>
            <div className={`mb-3 rounded-lg p-3 ${tone.bg}`}><div className={`flex items-center gap-2 font-headline text-headline-sm ${tone.fg}`}><Icon name={signal.icon} /> {signal.label}</div><p className="mt-1 text-body-sm text-on-surface">{signal.text}</p></div>
            {screen.domains && Object.keys(screen.domains).length > 0 && (
              <ul className="space-y-2">
                {Object.entries(DOMAINS).map(([k, d]) => {
                  const dom = screen.domains[k]
                  if (!dom) return null
                  return <li key={k} className="flex items-center justify-between gap-2 rounded-lg bg-surface-container-low p-2.5"><span className="flex items-center gap-2 text-body-sm"><Icon name={d.icon} size={18} className="text-primary" /> {d.clinical}</span><StatusChip kind={domainStatus(k, dom.status, screen.overall_signal).key} small /></li>
                })}
              </ul>
            )}
            {screen.overall_signal === 'insufficient_data' && <p className="text-body-sm text-on-surface-variant">{screen.reason}</p>}
          </>
        )}
      </section>

      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 font-body text-label-lg"><Icon name="smart_toy" className="text-primary" /> AI analysis</h3>
        {runner.running ? <AnalysisStepper progress={runner.progress} labels={STEP_LABELS} /> : lastRun && lastRun.as_of === asOf ? (
          <div className="space-y-2">
            <p className="text-body-sm text-on-surface-variant">Recommendation</p>
            <p className="text-label-lg">{RECOMMENDATIONS[lastRun.final.recommendation]}</p>
            <div className="flex flex-wrap gap-2"><Badge className="bg-surface-container">Confidence: {lastRun.final.confidence}</Badge><Badge className={lastRun.final.verification_status === 'failed_verification' ? 'bg-slight-bg text-slight-fg' : 'bg-steady-bg text-steady-fg'}>{lastRun.final.verification_status.replace('_', ' ')}</Badge></div>
            {lastRun.cached && <Badge className="bg-teal-tint text-teal"><Icon name="bolt" size={14} /> Instant: identical analysis reused, no model calls</Badge>}
            <p className="font-mono text-[12px] text-on-surface-variant">{usd(lastRun.usage.total_cost_usd)} · {lastRun.usage.calls} model calls</p>
            <button type="button" className="inline-flex min-h-[44px] items-center gap-1 text-label-md text-accent underline underline-offset-2" onClick={() => runNow(true)}>Run the models again</button>
            <Link to={`/runs/${lastRun.run_id}`} className="inline-flex min-h-[48px] items-center gap-1 text-label-lg text-accent">Open run details <Icon name="arrow_forward" size={20} /></Link>
          </div>
        ) : <p className="text-body-sm text-on-surface-variant">Move to any day and choose “Run analysis” to see what the AI pipeline concludes as of that day.</p>}
        {runner.error && <p role="alert" className="mt-3 rounded-md bg-worth-bg p-3 text-body-sm text-worth-fg">{runner.error.message}</p>}
      </section>
    </div>
  )

  return (
    <div className="print-reset flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3 md:px-6">
        {/* Person picker: swipeable, snapping, edge-to-edge strip with no visible scrollbar on phones/tablets;
            equal-width cards on large screens. */}
        <div className="-mx-4 mb-3 flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto scroll-px-4 px-4 py-1 [scrollbar-width:none] md:-mx-6 md:scroll-px-6 md:px-6 lg:snap-none [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Choose a person">
          {users.filter((u) => u.is_synthetic).map((u) => {
            const selected = u.user_id === user.user_id
            const p = personas.data?.personas.find((x) => x.user_id === u.user_id)
            return (
              <button key={u.user_id} type="button" role="radio" aria-checked={selected} onClick={() => setUserId(u.user_id)}
                className={`min-h-[56px] w-[220px] shrink-0 snap-start rounded-lg border-2 p-3 text-left transition-colors lg:w-auto lg:flex-1 ${selected ? 'border-primary-container bg-teal-tint/50' : 'border-border bg-white hover:bg-surface-container-low'}`}>
                <div className="flex items-center gap-2 font-headline text-headline-sm">{u.display_name.replace(' (synthetic)', '')}{selected && <Icon name="check_circle" size={18} className="text-primary" />}</div>
                <div className="line-clamp-2 text-body-sm text-on-surface-variant">{p?.description}</div>
              </button>
            )
          })}
          {users.some((u) => u.is_synthetic) && <button type="button" onClick={watchNow} disabled={scanning} className="btn btn-outline shrink-0 snap-start self-stretch !min-h-[56px] !rounded-lg !border-2 !px-5 whitespace-nowrap" title="Re-screen everyone now, the same step the background watch runs on a schedule">{scanning ? <Spinner className="h-4 w-4" /> : <Icon name="notifications_active" size={20} />} Run the watch now</button>}
          {!users.some((u) => u.is_synthetic) && <button type="button" className="btn btn-primary" onClick={seed} disabled={seeding}>{seeding ? <Spinner className="h-4 w-4" /> : <Icon name="science" size={20} />} Create the demo people</button>}
        </div>
        {!user.is_synthetic && <p className="mb-2 rounded-md bg-slight-bg p-2 text-body-sm text-slight-fg">You are viewing a real person's data. Pick a demo person above to use the replay.</p>}

        {!history.data ? <Skeleton className="h-20" /> : noHistory ? <p className="text-body-md text-on-surface-variant">No history yet for {user.display_name}.</p> : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-[110px]"><div className="font-mono text-[11px] uppercase text-on-surface-variant">Playback</div><div className="font-headline text-headline-sm">Day {index + 1}</div><div className="text-body-sm text-on-surface-variant">{asOf ? monthDay(asOf) : ''}</div></div>
            <div className="flex items-center gap-1 rounded-lg bg-surface-container p-1">
              <button type="button" className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-white" onClick={() => setDayIndex(Math.max(0, index - 1))} aria-label="Previous day"><Icon name="skip_previous" /></button>
              <button type="button" className="flex h-11 w-12 items-center justify-center rounded-md bg-primary-container text-white" onClick={() => { if (index >= totalDays - 1) setDayIndex(0); setPlaying((p) => !p) }} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play_arrow'} /></button>
              <button type="button" className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-white" onClick={() => setDayIndex(Math.min(totalDays - 1, index + 1))} aria-label="Next day"><Icon name="skip_next" /></button>
              <div className="ml-1 hidden gap-1 sm:flex">{[1, 4, 10].map((s) => <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s} className={`min-h-[44px] rounded-md px-2.5 font-mono text-[13px] ${speed === s ? 'bg-white shadow-card text-primary' : 'text-on-surface-variant'}`}>{s}x</button>)}</div>
            </div>
            <label className="flex min-h-[48px] cursor-pointer items-center gap-2 text-body-sm"><input type="checkbox" className="h-5 w-5 accent-[#0F766E]" checked={truth} onChange={(e) => setTruth(e.target.checked)} /> Show ground truth</label>
            <button type="button" className="btn btn-primary ml-auto w-full sm:w-auto" onClick={() => runNow(false)} disabled={runner.running}>{runner.running ? <Spinner className="h-4 w-4" /> : <Icon name="psychology" size={20} />} Run analysis as of day {index + 1}</button>
            <div className="w-full">
              <input type="range" min={0} max={Math.max(0, totalDays - 1)} value={index} onChange={(e) => { setPlaying(false); setDayIndex(Number(e.target.value)) }} className="h-12 w-full cursor-pointer accent-[#0F766E]" aria-label="Day in the history" aria-valuetext={asOf ? `Day ${index + 1}, ${monthDay(asOf)}` : ''} />
              {truth && persona?.events?.length > 0 && <p className="text-body-sm text-slight-fg">Ground truth: {persona.events.map((e) => `${e.label}, day ${e.start_day}${e.end_day ? `–${e.end_day}` : ' onward'}`).join('; ')}</p>}
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {history.error ? <div className="flex justify-center p-8"><ErrorNotice error={history.error} onRetry={history.reload} /></div> : noHistory ? null : (
          <SplitPanes left={left} right={right} leftClass="lg:col-span-8" rightClass="lg:col-span-4" rightFirstOnMobile />
        )}
      </div>
    </div>
  )
}