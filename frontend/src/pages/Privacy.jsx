import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { ConfirmDialog, ErrorNotice, Icon, Skeleton, Spinner, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { shortDate } from '../lib/format'
import { PageScroll, SanctuaryFooter } from '../shells/layout'
import { checkinWhere } from '../state/useHealth'
import { useAsync } from '../state/useAsync'
import { useUser } from '../state/UserContext'

const EXAMPLE = {
  user_id: 'example_person', session_id: 'example-2026-04-01-abc', day: '2026-04-01', input_mode: 'keyboard',
  median_flight_ms: 184, hold_time_ms: 97, p90_pause_ms: 940, pause_rate: 2.8, correction_rate: 0.07,
  lexical_diversity: 0.61, keystroke_count: 894, word_count: 142,
}

const NOTES = {
  median_flight_ms: 'Typical time between keypresses', hold_time_ms: 'How long keys are held down',
  p90_pause_ms: 'Length of the longer pauses', pause_rate: 'Long pauses per 100 keys',
  correction_rate: 'Share of keys that were edits', lexical_diversity: 'Variety of words used',
  recall_score: 'Score from the daily check-in', keystroke_count: 'How many keys were pressed',
  word_count: 'How many words were written', input_mode: 'Keyboard or touch screen',
  day: 'The date', session_id: 'A random label for this session', user_id: 'Your anonymous id (no name)',
}

export default function Privacy() {
  const { user, refresh, setUserId } = useUser()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, error, loading, reload } = useAsync(
    ({ signal }) => Promise.all([api.contract(), api.overview(user.user_id, undefined, { signal }), api.health()]),
    [user.user_id],
  )
  const [tab, setTab] = useState('illegal')
  const [editor, setEditor] = useState('')
  const [result, setResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [plans, setPlans] = useState(null)

  const sample = data?.[1]?.last_payload ? { ...data[1].last_payload } : EXAMPLE
  const usingExample = !data?.[1]?.last_payload
  useEffect(() => { if (data) setPlans(data[1].plans) }, [data])
  useEffect(() => {
    if (!data) return
    setEditor(JSON.stringify(tab === 'illegal' ? { ...sample, text: 'hello' } : sample, null, 2))
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data])

  if (error) return <PageScroll><div className="flex justify-center py-10"><ErrorNotice error={error} onRetry={reload} /></div></PageScroll>
  if (loading || !data) return <PageScroll><Skeleton className="mb-4 h-10 w-2/3" /><Skeleton className="h-72" /></PageScroll>

  const [contract, overview, health] = data

  async function sendTest() {
    let parsed
    try { parsed = JSON.parse(editor) } catch { setResult({ ok: false, title: 'That is not valid JSON.', detail: 'Check the brackets and quotes, then try again.', status: null }); return }
    setTesting(true)
    try {
      await api.validate(parsed)
      setResult({ ok: true, title: 'Accepted by the privacy wall.', detail: 'Dry run: nothing was stored.', status: 200 })
    } catch (e) {
      setResult({ ok: false, title: 'Rejected.', detail: e.message, status: e.status || null })
    } finally { setTesting(false) }
  }

  async function setConsent(value) {
    try { await api.setConsent(user.user_id, value); await refresh(); toast(value ? 'Daily check-in turned on.' : 'Daily check-in turned off.') } catch (e) { toast(e.message, 'error') }
  }
  async function removePlan(id) {
    try { await api.deletePlan(user.user_id, id); setPlans((p) => p.filter((x) => x.memory_id !== id)); toast('Removed.') } catch (e) { toast(e.message, 'error') }
  }
  async function deleteAll() {
    setDeleting(true)
    try { await api.deleteUser(user.user_id); await refresh(); setUserId(null); navigate('/welcome', { replace: true }) } catch (e) { toast(e.message, 'error'); setDeleting(false); setConfirm(false) }
  }

  const fields = contract.allowed_fields
  const where = checkinWhere(health)
  return (
    <PageScroll max="max-w-[1040px]">
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-label-md text-primary"><Icon name="shield" size={16} /> Privacy architecture</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-tint px-3 py-1 text-label-md text-teal"><Icon name="check_circle" size={16} /> Enforced by the server, tested in code</span>
      </div>
      <h1 className="mb-2 text-headline-lg-mobile md:text-headline-xl">What leaves your device</h1>
      <p className="mb-8 max-w-2xl text-body-lg text-on-surface-variant">See exactly what is shared, and what never is. Your words stay private; only timing numbers travel on.</p>

      <h2 className="mb-3 text-headline-sm">Where each piece of information goes</h2>
      <div className="mb-10 grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
        <section className="card bg-teal-tint/50 p-5">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-body text-label-lg"><Icon name="lock" /> Stays on your device</h3><span className="rounded bg-white px-2 py-0.5 text-[12px] font-bold text-primary">Never sent</span></div>
          <p className="mb-4 text-body-md">Letters, words and sentences are used on your device to count words and measure vocabulary variety, and are never sent anywhere.</p>
          <div className="rounded-lg bg-white p-4"><p className="select-none text-body-md blur-[5px]" aria-hidden="true">Dear Sam, I wanted to ask about the garden and whether…</p><p className="mt-2 flex items-center gap-1.5 text-body-sm font-semibold"><Icon name="block" size={16} /> Typed text is not transmitted</p></div>
        </section>
        <div className="flex items-center justify-center text-outline"><Icon name="arrow_downward" className="lg:hidden" /><Icon name="arrow_forward" className="hidden lg:block" /></div>
        <section className="card p-5">
          <h3 className="mb-2 flex items-center gap-2 font-body text-label-lg"><Icon name="shield" className="text-primary" /> The privacy wall</h3>
          <p className="mb-3 text-body-md">A strict gatekeeper on the server. Only these {fields.length} fields are accepted; anything else is rejected.</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Allowed fields">{fields.map((f) => <li key={f} className="inline-flex items-center gap-1 rounded-md bg-surface-container-low px-2 py-1 font-mono text-[12px]"><Icon name="check" size={14} className="text-steady-fg" />{f}</li>)}</ul>
          <p className="mt-3 flex items-center gap-2 rounded-md bg-surface-container p-3 text-body-sm"><Icon name="gavel" size={18} /> Unknown fields are rejected, and error messages never repeat what was sent.</p>
        </section>
        <div className="flex items-center justify-center text-outline"><Icon name="arrow_downward" className="lg:hidden" /><Icon name="arrow_forward" className="hidden lg:block" /></div>
        <section className="card bg-secondary-fixed/40 p-5">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-body text-label-lg"><Icon name="cloud_sync" className="text-accent" /> Sent to the analysis</h3><span className="rounded bg-accent px-2 py-0.5 text-[12px] font-bold text-white">Numbers only</span></div>
          <p className="mb-3 text-body-md">{usingExample ? 'An example of the numbers for one writing session:' : 'Your most recent session, exactly as stored:'}</p>
          <dl className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg bg-white p-3 font-mono text-[12.5px]">
            {Object.entries(sample).filter(([k]) => !['user_id', 'session_id'].includes(k)).map(([k, v]) => (
              <div key={k}><dt className="inline">"{k}": </dt><dd className="inline font-bold text-accent">{typeof v === 'string' ? `"${v}"` : v}</dd><div className="pl-3 font-body text-[12px] text-on-surface-variant">→ {NOTES[k] || ''}</div></div>
            ))}
          </dl>
        </section>
      </div>

      <section className="card mb-10 p-5 md:p-6" aria-labelledby="try">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="try" className="flex items-center gap-2 text-headline-sm md:text-headline-md"><Icon name="terminal" className="text-primary" /> Try to break the wall</h2><p className="text-body-md text-on-surface-variant">Test the boundary yourself. Try adding a field like raw text. This is a dry run, nothing is stored.</p></div>
          <div className="inline-flex rounded-lg bg-surface-container p-1" role="tablist">
            {[['illegal', 'Illegal injection'], ['compliant', 'Compliant payload']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`min-h-[44px] rounded-md px-4 text-label-md ${tab === k ? 'bg-white shadow-card text-primary' : 'text-on-surface-variant'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="payload" className="mb-1 block text-label-md uppercase tracking-wide text-on-surface-variant">Outgoing data (editable)</label>
            <textarea id="payload" value={editor} onChange={(e) => setEditor(e.target.value)} spellCheck={false} className="h-56 w-full resize-y rounded-lg border-[1.5px] border-border bg-surface-container-low p-3 font-mono text-[13px] focus:border-accent focus:outline-none" />
            <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" onClick={sendTest} disabled={testing}>{testing ? <Spinner className="h-4 w-4" /> : <Icon name="send" size={20} />} Send test</button>
          </div>
          <div aria-live="polite">
            <div className="mb-1 flex items-center justify-between"><span className="text-label-md uppercase tracking-wide text-on-surface-variant">What the wall said</span>{result?.status ? <span className="rounded bg-surface-container px-2 py-0.5 font-mono text-[12px]">HTTP {result.status}</span> : null}</div>
            {!result ? <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-body-md text-on-surface-variant">Send a test to see the response.</div> : (
              <div className={`h-56 overflow-y-auto rounded-lg p-4 ${result.ok ? 'bg-steady-bg' : 'bg-worth-bg'}`}>
                <p className={`mb-2 flex items-center gap-2 font-headline text-headline-sm ${result.ok ? 'text-steady-fg' : 'text-worth-fg'}`}><Icon name={result.ok ? 'check_circle' : 'gpp_bad'} /> {result.title}</p>
                <p className="mb-3 break-words text-body-md">{result.detail}</p>
                {!result.ok && result.status && <p className="rounded-md bg-white p-3 text-body-sm">The whole payload was refused before anything was stored.</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card mb-10 p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="text-headline-sm md:text-headline-md">Where the analysis runs</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-3 py-1 text-label-md"><Icon name="memory" size={16} /> NVIDIA Nemotron</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-3 py-1 text-label-md"><Icon name="cloud_sync" size={16} /> Nebius Token Factory</span></div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-surface-container-low p-4"><h3 className="mb-1 font-body text-label-lg">Typing measurements happen here</h3><p className="text-body-md text-on-surface-variant">Timing and vocabulary variety are measured in your browser. Statistics and the AI analysis run on the NeuroShield server, which only ever receives numbers.</p></div>
          <div className="rounded-lg bg-secondary-fixed/40 p-4"><h3 className="mb-1 font-body text-label-lg">{where.local ? 'The daily check-in stays on this machine' : 'The one exception: the daily check-in'}</h3><p className="text-body-md text-on-surface-variant">{where.local ? `If you turn it on, your chat replies are processed by ${health.checkin_model}, a model running on this machine. They are not sent to the cloud, and only a number is kept.` : 'If you turn it on, your chat replies are sent to the Nemotron models to be scored. Only a number is kept. It is off unless you choose it.'}</p></div>
        </div>
        <p className="mt-3 text-body-sm text-on-surface-variant">Models in use: {health.models.analyst} (analysis) and {health.models.fast} (check-ins and verification).</p>
      </section>

      <section className="card mb-6 p-5 md:p-6" aria-labelledby="ctl">
        <h2 id="ctl" className="mb-4 text-headline-sm md:text-headline-md">Your data controls</h2>
        <Toggle id="consent" checked={user.checkin_consent} onChange={setConsent} label="Daily check-in" description={`${where.toggle} Off if you declined at the start.`} />
        {plans && plans.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 font-body text-label-lg">Things you mentioned in check-ins</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">{plans.map((p) => (
              <li key={p.memory_id} className="flex items-center justify-between gap-3 p-3"><span className="min-w-0"><span className="block break-words text-body-md">{p.plan}</span><span className="text-body-sm text-on-surface-variant">{shortDate(p.day)}</span></span>
                <button type="button" onClick={() => removePlan(p.memory_id)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-low" aria-label={`Remove: ${p.plan}`}><Icon name="delete" /></button></li>))}</ul>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-md text-on-surface-variant">You own your history. Download a copy, or delete it all at once.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a className="btn btn-outline" href={api.exportUrl(user.user_id)} download><Icon name="download" size={20} /> Download my data</a>
            <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}><Icon name="delete_forever" size={20} /> Delete all my data</button>
          </div>
        </div>
      </section>
      <ConfirmDialog open={confirm} destructive busy={deleting} title="Delete everything?" confirmLabel="Delete" onCancel={() => setConfirm(false)} onConfirm={deleteAll}>
        This permanently removes {user.display_name}’s numbers, remembered items and past summaries. It cannot be undone.
      </ConfirmDialog>
      <SanctuaryFooter synthetic={user.is_synthetic} />
    </PageScroll>
  )
}
