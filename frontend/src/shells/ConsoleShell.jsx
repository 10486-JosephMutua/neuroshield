import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Badge, Icon, Logo } from '../components/ui'
import { UserSwitcher } from './UserSwitcher'
import { useUser } from '../state/UserContext'

const ITEMS = [
  { to: '/lab', label: 'Time-Travel Lab', icon: 'history_toggle_off' },
  { to: '/runs', label: 'Analysis Run', icon: 'account_tree' },
  { to: '/evaluation', label: 'Evaluation', icon: 'query_stats' },
  { to: '/report', label: 'Clinician Report', icon: 'description' },
  { to: '/privacy', label: 'Privacy Inspector', icon: 'shield_lock' },
]

function Nav({ onNavigate }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Console">
      {ITEMS.map((i) => (
        <NavLink key={i.to} to={i.to} onClick={onNavigate}
          className={({ isActive }) => `flex min-h-[48px] items-center gap-3 rounded-xl px-4 text-label-lg transition-colors ${isActive ? 'bg-primary-container text-on-primary shadow-sm' : 'text-on-surface hover:bg-surface-container-low'}`}>
          <Icon name={i.icon} size={22} /> {i.label}
        </NavLink>
      ))}
      <div className="mt-auto pt-3">
        <NavLink to="/" onClick={onNavigate} className="flex min-h-[48px] items-center gap-3 rounded-xl px-4 text-label-lg text-on-surface-variant hover:bg-surface-container-low">
          <Icon name="arrow_back" size={22} /> Companion app
        </NavLink>
        <div className="mt-3 rounded-lg bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
          <span className="font-mono text-[12px] uppercase tracking-wide">Data</span>
          <p>Numbers only. Typed words are never stored or sent.</p>
        </div>
      </div>
    </nav>
  )
}

/** Console shell: a fixed sidebar on large screens, a slide-over drawer on phones. */
export default function ConsoleShell() {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const here = ITEMS.find((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="print-reset flex h-dvh overflow-hidden bg-surface">
      <aside className="no-print hidden w-[260px] shrink-0 flex-col border-r border-border bg-surface-container-lowest lg:flex">
        <div className="flex h-16 items-center gap-2 px-5"><Logo /><div><div className="font-headline text-headline-sm leading-5 text-primary">NeuroShield</div><div className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Clinician console</div></div></div>
        <Nav />
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-[rgba(31,41,51,0.25)] backdrop-blur-[4px]" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-surface-container-lowest pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-card-hover">
            <div className="flex h-16 items-center justify-between px-5">
              <span className="flex items-center gap-2"><Logo /><span className="font-headline text-headline-sm text-primary">NeuroShield</span></span>
              <button type="button" onClick={() => setOpen(false)} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-surface-container-low" aria-label="Close menu"><Icon name="close" /></button>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print z-30 flex shrink-0 items-center gap-2 border-b border-border bg-surface/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md md:px-5">
          <div className="flex h-14 w-full items-center gap-2">
            <button type="button" onClick={() => setOpen(true)} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-surface-container-low lg:hidden" aria-label="Open menu"><Icon name="menu" /></button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {here && <span className="truncate text-label-lg text-primary" aria-live="polite">{here.label}</span>}
              {user?.is_synthetic
                ? <Badge className="bg-slight-bg text-slight-fg"><Icon name="science" size={14} /> Synthetic data</Badge>
                : <Badge className="bg-teal-tint text-teal"><Icon name="person" size={14} /> Real person's data</Badge>}
            </div>
            <Link to="/" className="flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-label-md text-on-surface-variant hover:bg-surface-container-low" aria-label="Back to the companion app">
              <Icon name="arrow_back" size={20} /> <span className="hidden sm:inline">Companion app</span>
            </Link>
            <UserSwitcher />
          </div>
        </header>
        <main className="print-reset min-h-0 flex-1 overflow-hidden" key={user?.user_id}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
