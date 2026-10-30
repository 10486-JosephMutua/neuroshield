import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { Icon, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { MIN_KEYSTROKES, TypingRecorder, buildPayload } from '../lib/typingFeatures'
import { useUser } from '../state/UserContext'

const METERS = [
  { key: 'median_flight_ms', label: 'Typing rhythm', icon: 'speed', hint: 'Median time between keypresses', max: 500, fmt: (v) => `${Math.round(v)} ms` },
  { key: 'pause_rate', label: 'Reflective pauses', icon: 'hourglass_top', hint: 'Pauses longer than 2 seconds, per 100 keys', max: 10, fmt: (v) => `${v.toFixed(1)} / 100 keys` },
  { key: 'correction_rate', label: 'Corrections', icon: 'backspace', hint: 'Share of keys that were edits', max: 0.3, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'lexical_diversity', label: 'Word variety', icon: 'menu_book', hint: 'Richness of vocabulary', max: 1, fmt: (v) => v.toFixed(2) },
]

/**
 * Journal: write freely while timing is measured IN THIS BROWSER. The text lives only in this page's
 * memory; when the person finishes, only the numbers shown in the preview are sent.
 */
export default function Journal() {
  const { user } = useUser()
  const toast = useToast()
  const recorder = useRef(new TypingRecorder())
  const textRef = useRef('')
  const areaRef = useRef(null)
  const [text, setText] = useState('')
  const [live, setLive] = useState(() => recorder.current.features(''))
  const [saving, setSaving] = useState(false)

  textRef.current = text

  // React's onBeforeInput is not the native event, so subscribe directly (needed for phone keyboards).
  useEffect(() => {
    const el = areaRef.current
    const handler = (e) => recorder.current.beforeInput({ inputType: e.inputType, timeStamp: e.timeStamp })
    el?.addEventListener('beforeinput', handler)
    return () => el?.removeEventListener('beforeinput', handler)
  }, [])

  // Refresh the live meters twice a second instead of on every keystroke.
  useEffect(() => {
    const id = setInterval(() => setLive(recorder.current.features(textRef.current)), 500)
    return () => clearInterval(id)
  }, [])

  const payload = useMemo(() => buildPayload(user.user_id, live), [user.user_id, live])
  const numericCount = Object.keys(payload).filter((k) => !['user_id', 'session_id', 'day', 'input_mode'].includes(k)).length

  const keyInfo = (e) => ({ key: e.key, code: e.code, repeat: e.repeat, isComposing: e.nativeEvent.isComposing, timeStamp: e.timeStamp })

  function discard() {
    recorder.current.reset()
    setText('')
    setLive(recorder.current.features(''))
  }

  async function finish() {
    const result = recorder.current.features(text)
    if (!result.ready) return
    setSaving(true)
    try {
      await api.ingest(buildPayload(user.user_id, result))
      toast(`Saved ${numericCount} numbers. Your words were not sent.`)
      discard()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="print-reset flex h-full flex-col">
      <div className="scroll-y min-h-0 flex-1 lg:overflow-hidden">
        <div className="mx-auto grid max-w-[960px] gap-gutter px-margin-mobile py-5 md:px-margin md:py-6 lg:h-full lg:grid-cols-5">
          <section className="card flex min-h-0 flex-col p-5 md:p-6 lg:col-span-3 lg:h-full" aria-labelledby="wf">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 id="wf" className="text-headline-md md:text-headline-lg">Write freely</h1>
                <p className="text-body-md text-on-surface-variant">Take your time. No timers, no scores, no evaluations.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 text-label-md text-primary"><Icon name="lightbulb" size={16} /> Morning reflection</span>
            </div>
            <p className="mb-3 flex items-center gap-2 rounded-md bg-teal-tint/60 px-3 py-2 text-body-sm"><Icon name="edit_note" size={18} className="text-primary" /> Prompt: How was your morning? Describe a sight, a sound, or a feeling.</p>
            <label htmlFor="journal-text" className="sr-only">Your journal entry</label>
            <textarea id="journal-text" ref={areaRef} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => recorder.current.keyDown(keyInfo(e))} onKeyUp={(e) => recorder.current.keyUp(keyInfo(e))}
              onPaste={(e) => { e.preventDefault(); toast('Pasting is turned off so the numbers reflect your own typing.', 'error') }}
              placeholder="Start typing, there is no right or wrong." spellCheck autoCorrect="on"
              className="min-h-[300px] w-full flex-1 resize-none rounded-lg border-[1.5px] border-border bg-surface p-4 font-headline text-body-xl leading-8 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 lg:min-h-0" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-body-sm text-on-surface-variant">
              <span><b className="rounded bg-surface-container px-2 py-0.5 text-on-surface">{live.features.word_count} words</b> <span className="ml-1">({live.features.keystroke_count} keystrokes)</span></span>
              <span className="inline-flex items-center gap-1"><Icon name="lock" size={16} /> Held in this page only</span>
            </div>
          </section>

          <aside className="card scroll-y min-h-0 p-5 md:p-6 lg:col-span-2 lg:h-full" aria-labelledby="od">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h2 id="od" className="text-headline-sm md:text-headline-md">On your device right now</h2>
              <span className="rounded-full bg-teal-tint px-2.5 py-1 text-[12px] font-semibold text-teal">Local only</span>
            </div>
            <p className="mb-4 text-body-sm text-on-surface-variant">
              Measured here, as you type. Input style detected: <b>{live.mode === 'keyboard' ? 'keyboard' : 'touch screen'}</b>.
            </p>
            <ul className="space-y-3">
              {METERS.map((m) => {
                const v = live.features[m.key]
                const width = v === null || v === undefined ? 0 : Math.min(100, (v / m.max) * 100)
                return (
                  <li key={m.key} className="rounded-lg bg-surface-container-low p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-label-md"><span className="flex items-center gap-2"><Icon name={m.icon} size={18} className="text-primary" />{m.label}</span><span className="font-mono">{v === null || v === undefined ? '–' : m.fmt(v)}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-container-high"><div className="h-full rounded-full bg-primary-container transition-all duration-500" style={{ width: `${width}%` }} /></div>
                    <div className="mt-1 text-[12px] text-on-surface-variant">{m.hint}</div>
                  </li>
                )
              })}
            </ul>
            {live.mode === 'touch' && <p className="mt-3 rounded-md bg-slight-bg p-3 text-body-sm text-slight-fg">Phone keyboards don’t report how long a key is held, so that measure is skipped on a touch screen.</p>}

            <div className="mt-4 rounded-lg border border-border bg-surface-container-low p-4">
              <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-2 text-label-lg"><Icon name="lock" size={18} /> Your words stay here</span><span className="rounded bg-teal-tint px-2 py-0.5 font-mono text-[11px] text-teal">NEVER SENT</span></div>
              <div className="relative overflow-hidden rounded-md bg-white p-3 text-body-sm text-on-surface-variant" aria-hidden="true">
                <span className="select-none blur-[5px]">{text ? text.slice(-90) : 'Whatever you write appears here and goes nowhere.'}</span>
              </div>
              <p className="mt-2 text-body-sm text-on-surface-variant">The text is never stored or sent to a server.</p>
            </div>

            <details className="group mt-4">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between rounded-md text-label-lg">
                <span className="flex items-center gap-2"><Icon name="data_object" className="text-accent" /> What will be shared when you finish</span>
                <Icon name="expand_more" className="transition-transform group-open:rotate-180" />
              </summary>
              <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-inverse-surface p-4 font-mono text-[13px] leading-5 text-inverse-on-surface">{JSON.stringify(payload, null, 2)}</pre>
              <p className="mt-2 flex items-start gap-1.5 text-body-sm text-on-surface-variant"><Icon name="info" size={16} className="mt-0.5" /> Only these numbers are sent. No letters, words or phrases.</p>
            </details>
          </aside>
        </div>
      </div>

      <div className="no-print shrink-0 border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-3 px-margin-mobile py-3 md:px-margin">
          <span className="hidden items-center gap-2 text-body-sm text-on-surface-variant sm:flex"><Icon name="lock" size={16} /> {live.ready ? 'Ready to share the numbers' : live.reason}</span>
          <div className="flex w-full gap-3 sm:w-auto">
            <button type="button" className="btn btn-outline flex-1 sm:flex-none" onClick={discard} disabled={saving || (!text && live.features.keystroke_count === 0)}>Discard</button>
            <button type="button" className="btn btn-primary flex-1 sm:flex-none" onClick={finish} disabled={!live.ready || saving} title={live.ready ? '' : `At least ${MIN_KEYSTROKES} keystrokes are needed`}>
              {saving ? <Spinner className="h-4 w-4" /> : null} Finish and share numbers <Icon name="arrow_forward" size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
