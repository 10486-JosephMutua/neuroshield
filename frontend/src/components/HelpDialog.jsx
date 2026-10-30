import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { COMPANION_TABS, CONSOLE_ITEMS } from '../lib/nav'
import { Icon } from './ui'

const ROUTINE = [
  'Write in your Journal for a few minutes.',
  'Say hello in Check-in (optional).',
  'Come back tomorrow. After a few weeks, My Summary compares you with your own normal.',
]

function Row({ to, icon, label, text, onNavigate }) {
  return (
    <li>
      <Link to={to} onClick={onNavigate} className="flex min-h-[56px] items-start gap-3 rounded-lg p-3 hover:bg-surface-container-low">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal"><Icon name={icon} size={22} /></span>
        <span className="min-w-0"><span className="block text-label-lg text-on-surface">{label}</span><span className="block text-body-sm text-on-surface-variant">{text}</span></span>
      </Link>
    </li>
  )
}

function HelpPanel({ inConsole, onClose, onNavigate }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = panelRef.current.querySelectorAll('a[href], button:not([disabled])')
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="no-print fixed inset-0 z-[100] flex items-end justify-center bg-[rgba(31,41,51,0.25)] p-3 backdrop-blur-[4px] sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="help-title"
        className="card scroll-y max-h-[88dvh] w-full max-w-lg p-5 md:p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="help-title" className="text-headline-md">Finding your way around</h2>
            <p className="text-body-md text-on-surface-variant">NeuroShield notices changes in how you type over weeks. It is never a diagnosis.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close help"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-surface-container-low"><Icon name="close" /></button>
        </div>

        <h3 className="mb-2 mt-4 font-body text-label-lg">A simple daily routine</h3>
        <ol className="mb-5 space-y-2">
          {ROUTINE.map((text, i) => (
            <li key={text} className="flex items-start gap-3 text-body-md">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-label-md text-white" aria-hidden="true">{i + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>

        <h3 className="mb-1 font-body text-label-lg">{inConsole ? 'Clinician console' : 'Where things are'}</h3>
        <ul className="mb-4">
          {(inConsole ? CONSOLE_ITEMS : COMPANION_TABS).map((i) => <Row key={i.to} {...i} onNavigate={onNavigate} />)}
        </ul>

        <ul className="space-y-1 border-t border-border pt-3">
          {inConsole
            ? <Row to="/" icon="arrow_back" label="Back to my app" text="Return to Today, Journal and your summary." onNavigate={onNavigate} />
            : <Row to="/lab" icon="stethoscope" label="Clinician console" text="For clinicians and demos: replay history, inspect an analysis, print a report." onNavigate={onNavigate} />}
          <Row to="/welcome" icon="group_add" label="Switch or add a person" text="Use someone else, or try a fictional demo person." onNavigate={onNavigate} />
        </ul>
      </div>
    </div>
  )
}

/** A "Help" button in the header that opens a short guide to the app, available on every page. */
export function HelpButton({ inConsole = false }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus() }, [])
  const leave = useCallback(() => setOpen(false), [])
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Help: finding your way around"
        className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-1.5 rounded-full px-3 text-label-md text-primary hover:bg-surface-container-low">
        <Icon name="help" size={24} /><span className="hidden md:inline">Help</span>
      </button>
      {open && <HelpPanel inConsole={inConsole} onClose={close} onNavigate={leave} />}
    </>
  )
}