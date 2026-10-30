import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Sparkline } from '../components/charts'
import { EmptyState, ErrorNotice, Icon, Logo, Skeleton, StatusChip } from '../components/ui'
import { longDate, metricValue, pct } from '../lib/format'
import { toWeekly } from '../lib/series'
import { DOMAINS, RECOMMENDATIONS, metricStatus, signalInfo, toneStatus } from '../lib/signals'
import { useAsync } from '../state/useAsync'
import { useUser } from '../state/UserContext'

const LINE = { steady: '#005c55', slight: '#B45309', worth: '#5B21B6' }

export function ReportLatest() {
  const { user } = useUser()
  const { data, error, loading, reload } = useAsync(() => api.runs(user.user_id), [user.user_id])
  if (error) return <div className="flex h-full items-center justify-center p-6"><ErrorNotice error={error} onRetry={reload} /></div>
  if (loading || !data) return <div className="p-6"><Skeleton className="h-64" /></div>
  if (!data.runs.length) return <div className="flex h-full items-center justify-center p-6"><EmptyState icon="description" title="No report yet" action={<Link to="/lab" className="btn btn-primary">Open the Time-Travel Lab</Link>}>A clinician report is created whenever an analysis runs. Run one from the Time-Travel Lab first.</EmptyState></div>
  return <Navigate to={`/report/${data.runs[0].run_id}`} replace />
}

/** A one-page, print-friendly report. Status is shown with an icon and words, so it survives black-and-white printing. */
export default function Report() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync(async () => {
    const run = await api.run(runId)
    const series = await api.series(run.user_id, run.as_of)
    return { run, series }
  }, [runId])

  if (error) return <div className="flex h-full items-center justify-center p-6"><ErrorNotice error={error} onRetry={reload} title="Could not open this report" /></div>
  if (loading || !data) return <div className="p-6"><Skeleton className="mx-auto h-[600px] max-w-[820px]" /></div>

  const { run, series } = data
  const { report, final, screen } = run
  const info = signalInfo(report.overall_signal)
  const labelToKey = Object.fromEntries(Object.entries(screen.metrics || {}).map(([k, m]) => [m.label, k]))
  const models = Object.keys(run.usage.per_model).map((m) => m.split('/').pop())
  const confounders = final.confounders || []

  return (
    <div className="print-reset flex h-full flex-col">
      <div className="no-print flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 md:px-6">
        <button type="button" onClick={() => navigate(-1)} className="btn btn-ghost !min-h-[44px] !px-3"><Icon name="arrow_back" size={20} /> Back</button>
        <Link to={`/runs/${run.run_id}`} className="btn btn-ghost !min-h-[44px] !px-3"><Icon name="account_tree" size={20} /> Run details</Link>
        <button type="button" onClick={() => window.print()} className="btn btn-primary ml-auto !min-h-[44px]"><Icon name="print" size={20} /> <span className="hidden sm:inline">Print or save as PDF</span><span className="sm:hidden">Print</span></button>
      </div>

      <div className="scroll-y print-reset min-h-0 flex-1 bg-surface-container-low p-2 sm:p-4 md:p-8">
        <article className="print-sheet mx-auto w-full max-w-[820px] rounded-lg bg-white p-4 shadow-card sm:p-6 md:p-10" aria-label="Clinician report">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h1 className="text-headline-md md:text-headline-lg">{report.title}</h1><p className="text-body-sm text-on-surface-variant">NeuroShield longitudinal typing report</p>
              {report.subject.synthetic_data && <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slight-fg px-2 py-1 font-mono text-[12px] text-slight-fg"><Icon name="warning" size={14} /> SYNTHETIC DATA: FOR DEMO USE ONLY</p>}</div>
            <div className="text-right"><span className="inline-flex items-center gap-2"><Logo className="h-7 w-7" /><span className="font-headline text-headline-sm text-primary">NeuroShield</span></span><p className="mt-1 font-mono text-[12px] text-on-surface-variant">Run {run.run_id}</p></div>
          </header>

          <dl className="mb-6 grid gap-x-8 gap-y-2 rounded-lg border border-border bg-surface-container-low p-4 text-body-sm sm:grid-cols-2">
            {[['Subject', report.subject.display_name || report.subject.user_id], ['As of', longDate(report.window.as_of)], ['History', `${report.window.history_days} days (${report.window.active_days} active)`], ['Input device', screen.input_mode === 'touch' ? 'Touch screen' : 'Keyboard']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-on-surface-variant">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>))}
            <div className="flex items-center justify-between gap-3 sm:col-span-2"><dt className="text-on-surface-variant">Overall signal</dt><dd><StatusChip kind={toneStatus(info.tone).key} label={info.label} small /></dd></div>
          </dl>

          <section className="mb-6"><h2 className="mb-2 font-body text-label-lg uppercase tracking-wide">1 · Summary</h2><p className="text-body-md leading-7">{report.narrative.clinician_summary}</p></section>

          <section className="mb-6"><h2 className="mb-2 font-body text-label-lg uppercase tracking-wide">2 · Measures versus personal baseline</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-left text-body-sm">
                <thead className="bg-surface-container-low text-label-md"><tr>{['Measure', 'Domain', 'Baseline', 'Recent', 'Change', 'Status', 'Trend'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody>{report.metrics_table.map((row) => {
                  const key = labelToKey[row.metric]
                  const status = metricStatus(row.status)
                  const base = screen.metrics?.[key]?.baseline
                  const weekly = toWeekly(series.series[key] || [], run.as_of, 12).map((w) => w.mean)
                  const range = base ? { low: base.median - 2 * base.spread, high: base.median + 2 * base.spread } : null
                  return (
                    <tr key={row.metric} className={`border-t border-border ${status.key !== 'steady' ? 'bg-surface-container-low/60' : ''}`}>
                      <td className="px-3 py-2 font-semibold">{row.metric}</td><td className="px-3 py-2 text-on-surface-variant">{DOMAINS[row.domain]?.clinical}</td>
                      <td className="px-3 py-2 font-mono">{metricValue(key, row.baseline_median)}</td><td className="px-3 py-2 font-mono font-semibold">{metricValue(key, row.recent_mean)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono">{row.change_pct > 0 ? '↑' : row.change_pct < 0 ? '↓' : ''} {pct(row.change_pct)}</td>
                      <td className="px-3 py-2"><StatusChip kind={status.key} small /></td>
                      <td className="px-3 py-2"><div className="w-24"><Sparkline values={weekly} range={range} color={LINE[status.key]} height={28} label={`${row.metric} weekly trend`} /></div></td>
                    </tr>)
                })}</tbody>
              </table>
            </div>
          </section>

          <section className="mb-6"><h2 className="mb-2 font-body text-label-lg uppercase tracking-wide">3 · Alternative explanations considered</h2>
            {confounders.length ? <ul className="mb-3 flex flex-wrap gap-2">{confounders.map((c) => <li key={c.name} className="rounded-md border border-border px-3 py-1.5 text-body-sm"><b>{c.name}</b> <span className="text-on-surface-variant">({c.likelihood})</span></li>)}</ul> : <p className="mb-3 text-body-sm text-on-surface-variant">No review was needed for this signal.</p>}
            <p className="rounded-lg border border-border bg-surface-container-low p-3 text-body-sm"><b>Confidence:</b> {report.narrative.confidence} · <b>Suggested action:</b> {RECOMMENDATIONS[report.narrative.recommendation]}</p></section>

          {report.references?.length > 0 && (
            <section className="mb-6"><h2 className="mb-2 font-body text-label-lg uppercase tracking-wide">4 · Background reading</h2>
              <p className="mb-2 text-body-sm text-on-surface-variant">Found by a live literature search. These links are not part of the analysis and are not endorsed by it.</p>
              <ul className="space-y-2 text-body-sm">{report.references.map((r) => <li key={r.url} className="rounded-lg border border-border p-3"><a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline underline-offset-2">{r.title}</a><div className="break-all font-mono text-[11px] text-on-surface-variant">{r.url}</div>{r.snippet && <p className="mt-1 text-on-surface-variant">{r.snippet}</p>}</li>)}</ul></section>
          )}

          <section className="mb-6"><h2 className="mb-2 font-body text-label-lg uppercase tracking-wide">{report.references?.length > 0 ? '5' : '4'} · Limitations</h2><ul className="list-disc space-y-1 pl-5 text-body-sm">{report.limitations.map((l) => <li key={l}>{l}</li>)}</ul></section>

          <p className="rounded-lg border-2 border-on-surface p-4 text-body-sm"><b>Notice:</b> {report.disclaimer}</p>
          <footer className="mt-5 flex flex-wrap justify-between gap-2 font-mono text-[11px] text-on-surface-variant"><span>{models.length ? `Models: ${models.join(', ')} via Nebius Token Factory` : 'No language model used (calm signal)'}</span><span>Run {run.run_id}</span></footer>
        </article>
      </div>
    </div>
  )
}
