import { Icon, Badge } from './ui'
import { RUN_NODES } from '../lib/signals'

const MAIN = ['load_screen', 'confounder_review', 'analyst', 'verify', 'safety_guard', 'build_report']
const SKIPPABLE = ['template_summary', 'fallback_summary']

/**
 * The LangGraph pipeline as a row of cards. `trace` is the list of events the run recorded:
 * a node that appears in it ran; one that does not was skipped. Scrolls sideways on small
 * screens instead of squeezing the cards.
 */
export function PipelineGraph({ trace = [] }) {
  const ran = (name) => trace.filter((e) => e.node === name)
  const revisions = Math.max(0, ran('analyst').length - 1)
  const card = (name, skipped) => {
    const events = ran(name)
    const meta = RUN_NODES[name]
    const ms = events.reduce((sum, e) => sum + (e.duration_ms || 0), 0)
    return (
      <div key={name} className={`w-[168px] shrink-0 rounded-lg border p-3 ${skipped ? 'border-dashed border-outline-variant bg-surface-container-low opacity-60' : 'border-primary-container bg-surface-container-lowest'}`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <Badge className="bg-surface-container text-on-surface-variant">{meta.badge}</Badge>
          <Icon name={skipped ? 'do_not_disturb_on' : 'check_circle'} size={18} className={skipped ? 'text-outline' : 'text-steady-fg'} />
        </div>
        <div className="font-mono text-data-mono">{meta.label}</div>
        <div className="mt-1 text-body-sm text-on-surface-variant">{skipped ? 'Skipped' : `${ms} ms${events.length > 1 ? ` · ${events.length} passes` : ''}`}</div>
      </div>
    )
  }
  const executed = MAIN.filter((n) => ran(n).length)
  return (
    <div>
      <div className="scroll-y -mx-1 overflow-x-auto px-1 pb-2" style={{ overflowY: 'hidden' }}>
        <div className="flex min-w-max items-stretch gap-2">
          {MAIN.map((n, i) => {
            const skipped = !ran(n).length
            return (
              <div key={n} className="flex items-center gap-2">
                {card(n, skipped)}
                {i < MAIN.length - 1 && <Icon name="arrow_forward" className="text-outline" size={20} />}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
        <Badge className="bg-steady-bg text-steady-fg">{executed.length + SKIPPABLE.filter((n) => ran(n).length).length} steps ran</Badge>
        {revisions > 0 && (
          <Badge className="bg-worth-bg text-worth-fg"><Icon name="refresh" size={14} /> Verification sent the analysis back for revision ×{revisions}</Badge>
        )}
        {SKIPPABLE.map((n) => {
          const wasRun = ran(n).length > 0
          return (
            <span key={n} className="inline-flex items-center gap-1 font-mono text-[12px]">
              <Icon name={wasRun ? 'check_circle' : 'do_not_disturb_on'} size={14} className={wasRun ? 'text-steady-fg' : 'text-outline'} />
              {n}{wasRun ? '' : ' (skipped)'}
            </span>
          )
        })}
      </div>
    </div>
  )
}
