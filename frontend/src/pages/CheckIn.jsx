import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Icon, Spinner } from '../components/ui'
import { firstName } from '../lib/format'
import { checkinWhere, useHealth } from '../state/useHealth'
import { useUser } from '../state/UserContext'

function Bubble({ role, children }) {
  const mine = role === 'user'
  return (
    <div className={`flex items-end gap-3 ${mine ? 'justify-end' : ''}`}>
      {!mine && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-container text-white"><Icon name="eco" size={22} /></span>}
      <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-5 py-3 text-body-lg ${mine ? 'rounded-br-sm bg-teal-tint' : 'rounded-bl-sm bg-surface-container-lowest border border-border shadow-card'}`}>{children}</p>
    </div>
  )
}

/** Daily check-in: a calm chat. The messages area scrolls; the info bar and the input stay put. */
export default function CheckIn() {
  const { user, refresh } = useUser()
  const where = checkinWhere(useHealth())
  const [messages, setMessages] = useState([])
  const [phase, setPhase] = useState(user.checkin_consent ? 'loading' : 'off') // loading|ready|sending|done|error|off
  const [error, setError] = useState('')
  const [planId, setPlanId] = useState(null)
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const startedFor = useRef(null)

  const begin = useCallback(async () => {
    setPhase('loading'); setError('')
    try {
      const res = await api.checkin(user.user_id)
      setMessages([{ role: 'assistant', text: res.message }])
      setPlanId(res.plan_memory_id)
      setPhase('ready')
    } catch (e) {
      setError(e.message); setPhase('error')
    }
  }, [user.user_id])

  useEffect(() => {
    if (!user.checkin_consent) { setPhase('off'); return }
    if (startedFor.current === user.user_id) return
    startedFor.current = user.user_id
    setMessages([]); setDraft('')
    begin()
  }, [user.user_id, user.checkin_consent, begin])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, phase])

  async function turnOn() {
    try { await api.setConsent(user.user_id, true); await refresh() } catch (e) { setError(e.message); setPhase('error') }
  }

  async function send(e) {
    e.preventDefault()
    const reply = draft.trim()
    if (!reply || phase !== 'ready') return
    setMessages((m) => [...m, { role: 'user', text: reply }]); setDraft(''); setPhase('sending')
    try {
      const res = await api.checkinReply(user.user_id, reply, planId)
      const closing = res.new_plan_memory_id ? `Thank you, ${firstName(user.display_name)}. I’ll ask how it goes next time.` : `Thank you, ${firstName(user.display_name)}. See you tomorrow.`
      setMessages((m) => [...m, { role: 'assistant', text: closing }]); setPhase('done')
    } catch (err) {
      setError(err.message); setPhase('error')
    }
  }

  return (
    <div className="print-reset flex h-full flex-col">
      <div className="shrink-0 border-b border-border bg-surface-container-low">
        <p className="mx-auto flex max-w-[720px] items-start gap-2 px-margin-mobile py-2.5 text-body-sm md:px-margin">
          <Icon name="info" size={18} className="mt-0.5 text-primary" />
          <span>{where.short} <Link to="/privacy" className="font-semibold text-accent underline">Learn more</Link></span>
        </p>
      </div>

      <div className="scroll-y min-h-0 flex-1" aria-live="polite">
        <div className="mx-auto flex min-h-full max-w-[720px] flex-col justify-end gap-4 px-margin-mobile py-6 md:px-margin">
          {phase === 'off' && (
            <div className="card p-6 text-center">
              <Icon name="chat_bubble_outline" className="mb-2 text-outline" size={36} />
              <h1 className="mb-1 text-headline-sm">The daily check-in is turned off</h1>
              <p className="mb-4 text-body-md text-on-surface-variant">Turn it on if you would like a friendly good-morning chat. You can switch it off again in Privacy.</p>
              <button type="button" className="btn btn-primary" onClick={turnOn}>Turn on check-in</button>
            </div>
          )}
          {messages.map((m, i) => <Bubble key={i} role={m.role}>{m.text}</Bubble>)}
          {(phase === 'loading' || phase === 'sending') && (
            <div className="flex items-end gap-3" role="status" aria-label="Typing">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-container text-white"><Icon name="eco" size={22} /></span>
              <span className="flex gap-1.5 rounded-xl rounded-bl-sm border border-border bg-white px-5 py-4 shadow-card">{[0, 1, 2].map((d) => <span key={d} className="h-2.5 w-2.5 animate-bounce rounded-full bg-outline" style={{ animationDelay: `${d * 150}ms` }} />)}</span>
            </div>
          )}
          {phase === 'error' && (
            <div role="alert" className="card p-5">
              <p className="mb-3 text-body-md">{error}</p>
              <button type="button" className="btn btn-outline" onClick={messages.length ? () => { setPhase('ready'); setError('') } : begin}>Try again</button>
            </div>
          )}
          {phase === 'done' && <p className="flex items-center justify-center gap-2 py-2 text-body-md text-steady-fg"><Icon name="check_circle" /> All done for today</p>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="no-print shrink-0 border-t border-border bg-surface">
        <form onSubmit={send} className="mx-auto max-w-[720px] px-margin-mobile py-3 md:px-margin">
          {phase === 'done' ? (
            <Link to="/" className="btn btn-primary w-full">Back to Today</Link>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <label htmlFor="reply" className="sr-only">Your reply</label>
                <input id="reply" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" maxLength={500}
                  disabled={phase !== 'ready'} placeholder={phase === 'ready' ? 'Type your reply…' : ' '}
                  className="min-h-[56px] flex-1 rounded-full border-[1.5px] border-border bg-white px-5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:bg-surface-container-low" />
                <button type="submit" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-container text-white disabled:opacity-50" disabled={phase !== 'ready' || !draft.trim()} aria-label="Send reply"><Icon name="send" /></button>
              </div>
              <div className="mt-1 text-center"><Link to="/" className="inline-flex min-h-[44px] items-center text-label-md text-on-surface-variant underline">Skip today</Link></div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
