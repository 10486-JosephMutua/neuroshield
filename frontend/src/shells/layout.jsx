/**
 * Layout regions. The app shells are one screen tall (100dvh) and never scroll, so pages put their
 * content in one of these:
 *   <PageScroll>  a single scrolling column
 *   <SplitPanes>  two scrolling panes on large screens, one stacked column on phones
 *                 (`rightFirstOnMobile` puts the summary above the main panel on phones)
 */
export function PageScroll({ children, className = '', max = 'max-w-[960px]' }) {
  return (
    <div className="scroll-y print-reset h-full">
      <div className={`mx-auto w-full ${max} px-margin-mobile py-5 md:px-margin md:py-8 ${className}`}>{children}</div>
    </div>
  )
}

export function SplitPanes({ left, right, leftClass = 'lg:col-span-8', rightClass = 'lg:col-span-4', className = '', rightFirstOnMobile = false }) {
  return (
    <div className={`print-reset h-full overflow-y-auto lg:overflow-hidden ${className}`}>
      <div className="grid gap-gutter-console p-4 md:p-6 lg:h-full lg:grid-cols-12">
        <div className={`${leftClass} scroll-y min-h-0 lg:h-full lg:pr-1`}>{left}</div>
        <div className={`${rightClass} ${rightFirstOnMobile ? 'order-first lg:order-none' : ''} scroll-y min-h-0 lg:h-full lg:pr-1`}>{right}</div>
      </div>
    </div>
  )
}

export function SanctuaryFooter({ synthetic }) {
  return (
    <p className="mt-10 border-t border-border pt-6 text-body-sm text-on-surface-variant">
      Your typed words never leave this device; only numbers are shared. See Privacy for exactly what.
      {synthetic ? ' This demo uses fictional, synthetic people.' : ''}
    </p>
  )
}
