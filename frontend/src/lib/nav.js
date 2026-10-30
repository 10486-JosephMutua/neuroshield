/** One place for the app's navigation, so the shells, the Help dialog and the page titles never disagree. */

export const COMPANION_TABS = [
  { to: '/', label: 'Today', icon: 'wb_sunny', end: true, blurb: 'Your starting point each day.' },
  { to: '/journal', label: 'Journal', icon: 'edit_note', blurb: 'Write freely for a few minutes. Only timing numbers are kept, never your words.' },
  { to: '/checkin', label: 'Check-in', icon: 'chat_bubble', blurb: 'An optional two-minute chat. You can turn it off in Privacy.' },
  { to: '/summary', label: 'My Summary', icon: 'insights', blurb: 'How your patterns compare with your own normal.' },
  { to: '/privacy', label: 'Privacy', icon: 'shield_lock', blurb: 'See exactly what is shared, and download or delete your data.' },
]

export const CONSOLE_ITEMS = [
  { to: '/lab', label: 'Time-Travel Lab', icon: 'history_toggle_off', blurb: 'Replay a person’s history day by day and run an analysis.' },
  { to: '/runs', label: 'Analysis Run', icon: 'account_tree', blurb: 'See how an analysis was produced, step by step.' },
  { to: '/evaluation', label: 'Evaluation', icon: 'query_stats', blurb: 'How well the screen works on simulated people.' },
  { to: '/report', label: 'Clinician Report', icon: 'description', blurb: 'A printable one-page summary for a doctor.' },
  { to: '/inspector', label: 'Privacy Inspector', icon: 'shield_lock', blurb: 'Test what the privacy wall accepts and rejects.' },
]

const matches = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`)

/** True for the pages that live in the clinician console. */
export const isConsolePath = (pathname) => CONSOLE_ITEMS.some((i) => matches(pathname, i.to))

/** The name of the page at `pathname`, for the browser tab and the console header. */
export function pageTitle(pathname) {
  const console = CONSOLE_ITEMS.find((i) => matches(pathname, i.to))
  if (console) return console.label
  const tab = COMPANION_TABS.find((t) => (t.end ? pathname === t.to : matches(pathname, t.to)))
  return tab ? tab.label : null
}