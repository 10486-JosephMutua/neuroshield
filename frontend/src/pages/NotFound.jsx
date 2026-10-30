import { Link } from 'react-router-dom'
import { Icon, Logo } from '../components/ui'
import { usePageTitle } from '../state/usePageTitle'

/** Shown for any address the app does not have, instead of silently sending people somewhere else. */
export default function NotFound() {
  usePageTitle('Page not found')
  return (
    <div className="print-reset flex h-dvh items-center justify-center overflow-y-auto bg-surface p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <Logo className="mx-auto mb-3 h-10 w-10" />
        <Icon name="explore_off" className="mb-2 text-outline" size={36} />
        <h1 className="mb-1 text-headline-md">We could not find that page</h1>
        <p className="mb-6 text-body-md text-on-surface-variant">The address may be out of date or mistyped. Nothing has been lost.</p>
        <Link to="/" className="btn btn-primary w-full"><Icon name="wb_sunny" size={20} /> Go to Today</Link>
      </div>
    </div>
  )
}