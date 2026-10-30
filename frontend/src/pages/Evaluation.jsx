import { api } from '../api/client'
import { EmptyState, ErrorNotice, Icon, Skeleton, Badge } from '../components/ui'
import { PageScroll } from '../shells/layout'
import { useAsync } from '../state/useAsync'

const pct = (r) => `${Math.round(r * 100)}%`
const ci = (c) => `95% CI ${pct(c.ci95[0])}–${pct(c.ci95[1])}`

function Stat({ big, label, sub, tone = 'steady' }) {
  const tones = { steady: 'bg-steady-bg text-steady-fg', slight: 'bg-slight-bg text-slight-fg', worth: 'bg-worth-bg text-worth-fg' }
  return (
    <div className="rounded-lg bg-surface-container-low p-4">
      <div className={`mb-2 inline-flex rounded-md px-2.5 py-1 font-mono text-[22px] font-semibold ${tones[tone]}`}>{big}</div>
      <div className="text-label-lg">{label}</div>
      <div className="text-body-sm text-on-surface-variant">{sub}</div>
    </div>
  )
}

/** The measured behaviour of the statistical screen on simulated people, with honest limits. */
export default function Evaluation() {
  const { data, error, loading, reload } = useAsync(() => api.evaluation(), [])

  if (error?.status === 404) {
    return <PageScroll max="max-w-[900px]"><EmptyState icon="query_stats" title="No evaluation has been run yet" action={<code className="rounded-md bg-surface-container px-3 py-2 font-mono text-[13px]">python scripts/run_evaluation.py</code>}>Run this command on the server (about 20 seconds) and reload this page to see measured results.</EmptyState></PageScroll>
  }
  if (error) return <PageScroll><div className="flex justify-center py-10"><ErrorNotice error={error} onRetry={reload} /></div></PageScroll>
  if (loading || !data) return <PageScroll max="max-w-[900px]"><Skeleton className="mb-4 h-12 w-2/3" /><Skeleton className="h-64" /></PageScroll>

  const { healthy, decline, flu, keyboard, parameters: p } = data
  const maxDelay = Math.max(...decline.map((d) => d.median_delay_days || 0), 1)

  return (
    <PageScroll max="max-w-[900px]">
      <div className="mb-2 flex flex-wrap items-center gap-2"><Badge className="bg-slight-bg text-slight-fg"><Icon name="science" size={14} /> Simulated people</Badge><Badge className="bg-surface-container font-mono">{new Date(data.generated_at).toLocaleDateString('en-GB')} · {data.seconds}s</Badge></div>
      <h1 className="mb-2 text-headline-lg-mobile md:text-headline-lg">How well does the screen work?</h1>
      <p className="mb-6 text-body-lg text-on-surface-variant">Measured on {healthy.people + p.people_per_decline_strength * decline.length + p.people_per_confounder * 2} simulated people over {p.days} days. These numbers describe how the method behaves, not how it would perform on real patients.</p>

      <section className="card mb-4 p-5 md:p-6" aria-labelledby="fa">
        <h2 id="fa" className="mb-1 flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="notifications_off" className="text-primary" /> False alarms</h2>
        <p className="mb-4 text-body-md text-on-surface-variant">Healthy, steady people. How often does the screen wrongly raise a sustained change?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat big={`${healthy.people_ever_flagged.count} of ${healthy.people_ever_flagged.of}`} label="people ever flagged" sub={`checked at days ${healthy.checkpoint_days.join(', ')} · ${ci(healthy.people_ever_flagged)}`} />
          <Stat big={`${healthy.checkpoints_flagged.count} of ${healthy.checkpoints_flagged.of}`} label="individual checks flagged" sub={ci(healthy.checkpoints_flagged)} />
        </div>
        <p className="mt-3 text-body-sm text-on-surface-variant">Zero in {healthy.people} still allows a true rate of up to about {pct(healthy.people_ever_flagged.ci95[1])}: a small sample cannot prove it is zero.</p>
      </section>

      <section className="card mb-4 p-5 md:p-6" aria-labelledby="dt">
        <h2 id="dt" className="mb-1 flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="radar" className="text-primary" /> Detecting a gradual decline</h2>
        <p className="mb-4 text-body-md text-on-surface-variant">A decline starts on day {p.decline_onset_day}. How often is it caught by day {p.days}, and how many days after it begins?</p>
        <ul className="space-y-4">
          {decline.map((d) => (
            <li key={d.label}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><span className="text-label-lg">{d.label} <span className="font-normal text-on-surface-variant">({Math.round(d.scale * 100)}% of demo strength)</span></span><span className="font-mono text-label-md">{d.detected.count}/{d.people} caught · {pct(d.detected.rate)}</span></div>
              <div className="h-3 overflow-hidden rounded-full bg-surface-container" role="img" aria-label={`${pct(d.detected.rate)} detected`}><div className={`h-full rounded-full ${d.detected.rate >= 0.9 ? 'bg-primary-container' : 'bg-slight-fg'}`} style={{ width: `${Math.max(2, d.detected.rate * 100)}%` }} /></div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-body-sm text-on-surface-variant"><span>{ci(d.detected)}</span><span>{d.median_delay_days === null ? 'Not reliably detected' : `Median ${d.median_delay_days} days after onset (90th percentile ${d.p90_delay_days})`}</span></div>
              {d.median_delay_days !== null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-low" aria-hidden="true"><div className="h-full rounded-full bg-accent/60" style={{ width: `${(d.median_delay_days / maxDelay) * 100}%` }} /></div>}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-md bg-slight-bg p-3 text-body-sm text-slight-fg">The screen has a limit: very subtle changes are mostly missed. That is by design, since flagging tiny changes would cause false alarms.</p>
      </section>

      <section className="card mb-4 p-5 md:p-6" aria-labelledby="cf">
        <h2 id="cf" className="mb-1 flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="psychology_alt" className="text-primary" /> Telling decline apart from everyday causes</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat tone={flu.mistaken_for_decline_during_illness.rate <= 0.1 ? 'steady' : 'slight'} big={`${flu.mistaken_for_decline_during_illness.count} of ${flu.people}`} label="flu mistaken for decline" sub={`during the illness (day ${flu.mid_illness_day}) · ${ci(flu.mistaken_for_decline_during_illness)}. Recognised as short-lived: ${flu.recognised_as_acute_during_illness.count} of ${flu.people}.`} />
          <Stat big={`${flu.flagged_after_recovery.count} of ${flu.people}`} label="still flagged after recovery" sub={`on day ${flu.recovered_day} · ${ci(flu.flagged_after_recovery)}`} />
          <Stat big={`${keyboard.recognised_as_mechanical_only.count} of ${keyboard.people}`} label="new keyboard recognised as mechanical" sub={`timing changed, thinking measures did not · ${ci(keyboard.recognised_as_mechanical_only)}`} />
          <Stat tone={keyboard.mistaken_for_cognitive_change.count ? 'worth' : 'steady'} big={`${keyboard.mistaken_for_cognitive_change.count} of ${keyboard.people}`} label="keyboard mistaken for cognitive change" sub={ci(keyboard.mistaken_for_cognitive_change)} />
        </div>
      </section>

      <section className="card mb-6 p-5 md:p-6">
        <h2 className="mb-2 text-headline-sm">Method and honest limits</h2>
        <ul className="mb-4 list-disc space-y-1.5 pl-5 text-body-md">{data.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="rounded-lg bg-surface-container-low p-3 font-mono text-[12px] leading-5 text-on-surface-variant">
          Baseline: first {p.thresholds ? 28 : 28} days · shift ≥ {p.thresholds.shift_z} robust z · CUSUM k={p.thresholds.cusum_k}, h={p.thresholds.cusum_h} · sustained after {p.thresholds.sustained_min_age_days} days<br />
          Flagged signals: {p.flagged_signals.join(', ')}<br />
          Reproduce: <b>python scripts/run_evaluation.py</b>
        </div>
      </section>
    </PageScroll>
  )
}
