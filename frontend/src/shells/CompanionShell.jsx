import { NavLink, Outlet } from 'react-router-dom'
import { Icon, Logo, PrivacyPill } from '../components/ui'
import { UserSwitcher } from './UserSwitcher'
import { useUser } from '../state/UserContext'

const TABS = [
  { to: '/', label: 'Today', icon: 'wb_sunny', end: true },
  { to: '/journal', label: 'Journal', icon: 'edit_note' },
  { to: '/checkin', label: 'Check-in', icon: 'chat_bubble' },
  { to: '/summary', label: 'My Summary', icon: 'insights' },
  { to: '/privacy', label: 'Privacy', icon: 'shield_lock' },
]

/** Companion shell: the top bar stays put and the five tabs move to a bottom bar on phones. */
export default function CompanionShell() {
  const { user } = useUser()
  return (
    <div className="print-reset flex h-dvh flex-col overflow-hidden bg-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-md focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
      <header className="no-print z-40 shrink-0 bg-surface/90 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 max-w-[960px] items-center justify-between gap-3 px-margin-mobile md:h-20 md:px-margin">
          <NavLink to="/" className="flex items-center gap-2 rounded-lg" aria-label="NeuroShield home">
            <Logo />
            <span className="font-headline text-headline-sm tracking-tight text-primary">NeuroShield</span>
          </NavLink>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `whitespace-nowrap rounded-xl px-4 py-2.5 text-label-lg transition-colors ${isActive ? 'bg-primary-container text-on-primary shadow-sm' : 'text-on-surface hover:bg-surface-container-low'}`}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <NavLink to="/lab" title="Time-Travel Lab, analysis runs, evaluation and clinician report"
              className="hidden min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-label-md text-on-surface-variant hover:bg-surface-container-low md:inline-flex">
              <Icon name="stethoscope" size={20} /> Clinician console
            </NavLink>
            <PrivacyPill className="hidden xl:inline-flex" />
            <UserSwitcher />
          </div>
        </div>
      </header>

      <main id="main" className="print-reset min-h-0 flex-1 overflow-hidden" key={user?.user_id}>
        <Outlet />
      </main>

      <nav className="no-print shrink-0 border-t border-border bg-surface-container-lowest pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
        <ul className="mx-auto flex max-w-[960px] justify-around">
          {TABS.map((t) => (
            <li key={t.to} className="flex-1">
              <NavLink to={t.to} end={t.end}
                className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[12px] font-semibold ${isActive ? 'text-primary' : 'text-on-surface-variant'}`}>
                {({ isActive }) => (
                  <>
                    <span className={`flex h-7 w-14 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-teal-tint' : ''}`}><Icon name={t.icon} size={22} /></span>
                    <span className="truncate">{t.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
