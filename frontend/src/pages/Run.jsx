import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { CompareBars } from '../components/charts'
import { PipelineGraph } from '../components/PipelineGraph'
import { Badge, EmptyState, ErrorNotice, Icon, Skeleton, StatusChip } from '../components/ui'
import { metricValue, monthDay, num, pct, seconds, usd } from '../lib/format'
import { RECOMMENDATIONS, RUN_NODES, signalInfo, toneStatus } from '../lib/signals'
import { SplitPanes } from '../shells/layout'
import { useAsync } from '../state/useAsync'
import { useUser } from '../state/UserContext'

const TABS = [['evidence', 'Evidence', 'query_stats'], ['confounders', 'Confounders', 'psychology_alt'], ['guardrails', 'Guardrails', 'health_and_safety'], ['trace', 'Trace', 'receipt_long']]
const LIKELIHOOD = { low: 'bg-steady-bg text-steady-fg', medium: 'bg-slight-bg text-slight-fg', high: 'bg-worth-bg text-worth-fg' }

/** /runs with no id opens the most recent run for the current person. */
export function RunLatest() {
  const { user } = useUser()
  const { data, error, loading, reload } = useAsync(() => api.runs(user.user_id), [user.user_id])
  if (error) return <div className="flex h-full items-center justify-center p-6"><ErrorNotice error={error} onRetry={reload} /></div>
  if (loading || !data) return <div className="p-6"><Skeleton className="h-40" /></div>
  if (!data.runs.length) return <div className="flex h-full items-center justify-center p-6"><EmptyState icon="account_tree" title="No analysis runs yet" action={<Link to="/lab" className="btn btn-primary">Open the Time-Travel Lab</Link>}>Run an analysis from the Time-Travel Lab and it will appear here with its full audit trail.</EmptyState></div>
  return <Navigate to={`/runs/${data.runs[0].run_id}`} replace />
}

export default function Run() {
  const { runId } = useParams()
  const [tab, setTab] = useState('evidence')
  const { data: run, error, loading, reload } = useAsync(() => api.run(runId), [runId])
  const { user } = useUser()

  if (error) return <div className="flex h-full items-center justify-center p-6"><ErrorNotice error={error} onRetry={reload} title="Could not open this run" /></div>
  if (loading || !run) return <div className="space-y-3 p-6"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>

  const { final, screen, trace, usage } = run
  const info = signalInfo(final.overall_signal)
  const wall = trace.reduce((s, e) => s + (e.duration_ms || 0), 0)
  const codeSteps = trace.filter((e) => ['Code', 'MCP'].includes(RUN_NODES[e.node]?.badge)).length
  const models = Object.entries(usage.per_model)
  const totalCost = usage.total_cost_usd || 0

  const left = (
    <div className="space-y-4 pb-4">
      <header>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge className="bg-surface-container font-mono">Run #{run.run_id}</Badge>
          {user.is_synthetic && <Badge className="bg-slight-bg text-slight-fg"><Icon name="science" size={14} /> Synthetic data</Badge>}
          <StatusChip kind={toneStatus(info.tone).key} label={info.label} small />
        </div>
        <h1 className="text-headline-md md:text-headline-lg">Analysis run · {user.display_name} · as of {monthDay(run.as_of)}</h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">{screen.history_days} days of history, {screen.active_days} active days. The numbers come from deterministic code; models only interpret them.</p>
      </header>

      <section className="card p-4 md:p-5" aria-labelledby="dag">
        <h2 id="dag" className="mb-3 flex items-center gap-2 font-body text-label-lg"><Icon name="account_tree" className="text-primary" /> Execution pipeline <Badge className="bg-steady-bg text-steady-fg">{seconds(wall)}</Badge></h2>
        <PipelineGraph trace={trace} />
      </section>

      <section className="card overflow-hidden">
        <div className="scroll-y flex overflow-x-auto border-b border-border" role="tablist" style={{ overflowY: 'hidden' }}>
          {TABS.map(([k, label, icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`flex min-h-[52px] shrink-0 items-center gap-2 border-b-2 px-4 text-label-lg ${tab === k ? 'border-primary-container text-primary' : 'border-transparent text-on-surface-variant'}`}>
              <Icon name={icon} size={20} /> {label}
            </button>
          ))}
        </div>
        <div className="p-4 md:p-5" role="tabpanel">
          {tab === 'evidence' && (final.evidence.length ? (
            <ul className="space-y-4">{final.evidence.map((e) => {
              const m = screen.metrics?.[e.metric]
              return (
                <li key={e.metric} className="rounded-lg bg-surface-container-low p-4">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h3 className="font-headline text-headline-sm">{m?.label || e.metric}</h3><Badge className="bg-worth-bg text-worth-fg">{pct(e.change_pct)}</Badge></div>
                  <p className="mb-3 text-body-md text-on-surface-variant">{e.observation}</p>
                  <CompareBars baseline={e.baseline_value} recent={e.recent_value} format={(v) => metricValue(e.metric, v)} />
                </li>
              )
            })}</ul>
          ) : <p className="text-body-md text-on-surface-variant">{final.verification_status === 'template' ? 'The signal was calm, so no model was used and there is no evidence to list.' : 'No evidence items were produced.'}</p>)}

          {tab === 'confounders' && (final.confounders?.length ? (
            <div><p className="mb-3 text-body-md text-on-surface-variant">{final.confounder_pattern_summary}</p>
              <ul className="space-y-3">{final.confounders.map((c) => <li key={c.name} className="rounded-lg bg-surface-container-low p-4"><div className="mb-1 flex flex-wrap items-center justify-between gap-2"><span className="text-label-lg">{c.name}</span><Badge className={LIKELIHOOD[c.likelihood]}>{c.likelihood} likelihood</Badge></div><p className="text-body-md text-on-surface-variant">{c.reasoning}</p></li>)}</ul></div>
          ) : <p className="text-body-md text-on-surface-variant">No confounder review was needed for this signal.</p>)}

          {tab === 'guardrails' && (
            <ul className="space-y-3 text-body-md">
              {[['Verification', final.verification_status === 'passed' ? 'Numbers and wording were checked against the screen and passed.' : final.verification_status === 'template' ? 'No model output to verify (calm signal, safe template used).' : 'Verification failed after the allowed attempts; a safe template was used and the result is flagged for review.', final.verification_status === 'failed_verification' ? 'slight' : 'steady'],
                ['Recommendation ceiling', `Policy for “${info.label}” allows at most: ${RECOMMENDATIONS[final.recommendation]}.`, 'steady'],
                ['Patient-facing wording', 'Diagnostic wording is blocked in code and replaced with a safe message.', 'steady']].map(([t, d, k]) => (
                <li key={t} className="flex items-start gap-3 rounded-lg bg-surface-container-low p-3"><StatusChip kind={k} small label={k === 'steady' ? 'Passed' : 'Needs review'} /><span><b>{t}.</b> {d}</span></li>))}
              {final.guardrail_notes?.map((n) => <li key={n} className="rounded-lg bg-slight-bg p-3 text-slight-fg">Adjustment: {n}</li>)}
              {final.needs_human_review && <li className="rounded-lg bg-worth-bg p-3 text-worth-fg">This result needs a person to review it.</li>}
            </ul>
          )}

          {tab === 'trace' && (
            <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-body-sm"><thead><tr className="border-b border-border text-label-md text-on-surface-variant"><th className="py-2 pr-3">Step</th><th className="pr-3">Status</th><th className="pr-3 text-right">Time</th><th>Detail</th></tr></thead>
              <tbody>{trace.map((e, i) => <tr key={i} className="border-b border-border/60"><td className="py-2 pr-3 font-mono">{e.node}</td><td className="pr-3">{e.status}</td><td className="pr-3 text-right font-mono">{e.duration_ms} ms</td><td className="font-mono text-[12px] text-on-surface-variant">{Object.entries(e).filter(([k]) => !['node', 'status', 'duration_ms'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ')}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>
    </div>
  )

  const right = (
    <div className="space-y-4 pb-4">
      <section className="card p-4 md:p-5" aria-labelledby="fd">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 id="fd" className="font-headline text-headline-sm">Final decision</h2><Badge className="bg-steady-bg text-steady-fg">Confidence: {final.confidence}</Badge></div>
        <p className="mb-1 flex items-center gap-2 text-label-md text-primary"><Icon name="event_available" size={18} /> {RECOMMENDATIONS[final.recommendation]}</p>
        <p className="mb-4 font-headline text-headline-sm leading-7">{final.headline}</p>
        <details className="mb-2 rounded-lg border border-border"><summary className="flex min-h-[48px] cursor-pointer items-center justify-between px-3 text-label-md">Message to the person <Icon name="expand_more" /></summary><p className="border-t border-border p-3 font-headline text-body-md">“{final.patient_message}”</p></details>
        <details className="rounded-lg border border-border"><summary className="flex min-h-[48px] cursor-pointer items-center justify-between px-3 text-label-md">Summary for the clinician <Icon name="expand_more" /></summary><p className="border-t border-border p-3 text-body-md">{final.clinician_summary}</p></details>
        <Link to={`/report/${run.run_id}`} className="btn btn-primary mt-4 w-full"><Icon name="description" size={20} /> Open clinician report</Link>
      </section>

      <section className="card p-4 md:p-5" aria-labelledby="cs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="cs" className="font-headline text-headline-sm">Cost and speed</h2><Badge className="bg-teal-tint text-teal">{usd(totalCost)} total</Badge></div>
        {models.length ? (
          <>
            <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-surface-container" aria-hidden="true">{models.map(([name, m], i) => <div key={name} className={i === 0 ? 'bg-primary-container' : 'bg-accent'} style={{ width: `${totalCost ? (m.cost_usd / totalCost) * 100 : 100 / models.length}%` }} />)}</div>
            <div className="overflow-x-auto"><table className="w-full min-w-[300px] text-body-sm"><thead><tr className="text-left text-on-surface-variant"><th className="pb-1 font-semibold">Model</th><th className="pb-1 text-right font-semibold">Calls</th><th className="pb-1 text-right font-semibold">Tokens</th><th className="pb-1 text-right font-semibold">Cost</th></tr></thead>
              <tbody>{models.map(([name, m]) => <tr key={name} className="border-t border-border/60"><td className="py-1.5 pr-2 font-mono text-[12px]">{name.split('/').pop()}</td><td className="text-right font-mono">{m.calls}</td><td className="text-right font-mono">{num(m.input_tokens + m.output_tokens)}</td><td className="text-right font-mono">{usd(m.cost_usd)}</td></tr>)}
                <tr className="border-t border-border/60"><td className="py-1.5 pr-2 font-mono text-[12px]">Code / MCP</td><td className="text-right font-mono">{codeSteps}</td><td className="text-right font-mono">0</td><td className="text-right font-mono">{usd(0)}</td></tr></tbody></table></div>
          </>
        ) : <p className="text-body-md text-on-surface-variant">No language model was called for this run: the signal was calm, so a safe template was used. That is why it cost nothing.</p>}
        <p className="mt-3 rounded-lg bg-surface-container-low p-3 text-body-sm">Total: <b>{usage.calls} model calls</b> · <b>{num(usage.total_tokens)} tokens</b> · <b>{seconds(wall)}</b> of pipeline time</p>
      </section>
    </div>
  )

  return <SplitPanes left={left} right={right} leftClass="lg:col-span-8" rightClass="lg:col-span-4" />
}
