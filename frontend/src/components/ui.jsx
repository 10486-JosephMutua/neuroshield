import { useEffect, useRef } from 'react'
import { STATUS } from '../lib/signals'

/** Material Symbols icon (font is self-hosted; the text is the icon's ligature name). */
export function Icon({ name, className = '', size, label }) {
  return (
    <span
      className={`icon ${className}`}
      style={size ? { fontSize: size } : undefined}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {name}
    </span>
  )
}

export function Logo({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 2.5 5 6.7v8.1c0 7.1 4.6 12.2 11 14.7 6.4-2.5 11-7.6 11-14.7V6.7L16 2.5Z" fill="#0F766E" />
      <path d="M8.5 16.5c2.2 0 2.2-4 4.4-4s2.2 7 4.4 7 2.2-5 4.4-5 1.6 2 2.3 2" fill="none" stroke="#fff"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Tri-coded status: colour + icon + text, never colour alone. `kind` is a key of STATUS. */
export function StatusChip({ kind = 'steady', label, small = false, className = '' }) {
  const s = STATUS[kind] || STATUS.steady
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-body font-semibold ${s.bg} ${s.fg}
      ${small ? 'px-2.5 py-0.5 text-[12px]' : 'px-3 py-1 text-label-md'} ${className}`}>
      <Icon name={s.icon} size={small ? 14 : 18} />
      {label || s.label}
    </span>
  )
}

export function PrivacyPill({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-teal/20 bg-teal-tint px-3 py-1.5 text-label-md text-teal ${className}`}>
      <Icon name="lock" size={16} /> On your device
    </span>
  )
}

export function Spinner({ className = 'h-5 w-5' }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} role="status" aria-label="Loading" />
}

export function FullScreenSpinner({ label }) {
  return (
    <div className="flex h-full min-h-dvh items-center justify-center gap-3 text-on-surface-variant">
      <Spinner className="h-6 w-6" /> <span>{label}</span>
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-surface-container ${className}`} aria-hidden="true" />
}

export function ErrorNotice({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <div role="alert" className="card max-w-md p-6 text-center">
      <Icon name="cloud_off" className="mb-2 text-outline" size={36} />
      <h2 className="mb-1 text-headline-sm">{title}</h2>
      <p className="mb-4 text-body-md text-on-surface-variant">{error?.message || 'Please try again.'}</p>
      {onRetry && <button type="button" className="btn btn-outline" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className="card flex flex-col items-center p-8 text-center">
      <Icon name={icon} className="mb-3 text-outline" size={40} />
      <h2 className="mb-1 text-headline-sm">{title}</h2>
      <div className="mb-4 max-w-md text-body-md text-on-surface-variant">{children}</div>
      {action}
    </div>
  )
}

/** Accessible on/off switch with a 48px hit area. */
export function Toggle({ checked, onChange, label, description, disabled = false, id }) {
  return (
    <label htmlFor={id} className={`flex min-h-[48px] items-start gap-4 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <span className="relative mt-0.5 inline-flex h-8 w-14 shrink-0 items-center">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-full bg-outline-variant transition-colors peer-checked:bg-primary-container peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute left-1 h-6 w-6 rounded-full bg-white shadow transition-transform peer-checked:translate-x-6" />
      </span>
      <span>
        <span className="block text-label-lg text-on-surface">{label}</span>
        {description && <span className="block text-body-sm text-on-surface-variant">{description}</span>}
      </span>
    </label>
  )
}

/** Modal confirmation. Esc cancels, focus moves into the dialog, the page behind is dimmed and blurred. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', destructive = false, busy = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    cancelRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[rgba(31,41,51,0.25)] p-4 backdrop-blur-[4px] sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" className="card w-full max-w-md p-6">
        <h2 id="dlg-title" className="mb-2 text-headline-md">{title}</h2>
        <div className="mb-6 text-body-md text-on-surface-variant">{children}</div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Badge({ children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${className}`}>{children}</span>
}

export function SectionTitle({ children, aside }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-headline-sm md:text-headline-md">{children}</h2>
      {aside}
    </div>
  )
}

/** Live stepper for a running analysis: finished steps tick, the next one pulses. */
export function AnalysisStepper({ progress, labels }) {
  const done = new Set(progress.completed)
  const active = progress.steps.find((s) => !done.has(s))
  return (
    <ol className="space-y-2" aria-live="polite" aria-label="Analysis progress">
      {progress.steps.map((step) => {
        const isDone = done.has(step)
        const isActive = step === active
        return (
          <li key={step} className={`flex items-center gap-3 text-body-md ${isDone ? 'text-steady-fg' : isActive ? 'text-on-surface' : 'text-outline'}`}>
            {isDone ? <Icon name="check_circle" size={20} /> : isActive ? <Spinner className="h-4 w-4" /> : <Icon name="radio_button_unchecked" size={20} />}
            {labels[step] || step}
          </li>
        )
      })}
    </ol>
  )
}
