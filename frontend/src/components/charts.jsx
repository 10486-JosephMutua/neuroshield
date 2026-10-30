import { stats as describe } from '../lib/series'
import { daysBetween } from '../lib/format'

const W = 100
const H = 40
const PAD = 4

/** Build an SVG path through points (x, y in the 0..100 / 0..40 viewBox). */
const toPath = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

/**
 * Chart for one metric across a person's history.
 *  - shaded band: personal baseline (first `baselineDays` days, 10th-90th percentile)
 *  - dashed line: baseline median
 *  - vertical line: "now"; later data is faded (it has not happened yet in the replay)
 *  - optional ground-truth windows are shaded
 * The SVG stretches to its container with non-scaling strokes.
 */
export function MetricChart({ points, firstDay, totalDays, cursorDay, baselineDays = 28, events = [], showEvents = false, color = '#005c55', height = 120 }) {
  if (!points?.length || !firstDay) return <div className="rounded-md bg-surface-container-low" style={{ height }} aria-hidden="true" />

  const xOf = (day) => (daysBetween(firstDay, day) / Math.max(1, totalDays - 1)) * W
  const baselineVals = points.filter((p) => daysBetween(firstDay, p.day) < baselineDays).map((p) => p.value)
  const base = describe(baselineVals)
  const all = describe(points.map((p) => p.value))
  const lo = Math.min(all.min, base?.p10 ?? all.min)
  const hi = Math.max(all.max, base?.p90 ?? all.max)
  const span = hi - lo || 1
  const yOf = (v) => PAD + (1 - (v - lo) / span) * (H - PAD * 2)

  const past = points.filter((p) => !cursorDay || p.day <= cursorDay)
  const future = points.filter((p) => cursorDay && p.day > cursorDay)
  const lastPast = past[past.length - 1]
  const cursorX = cursorDay ? xOf(cursorDay) : null
  const baseEndX = (Math.min(baselineDays, totalDays) - 1) / Math.max(1, totalDays - 1) * W

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img"
      aria-label="Line chart of this measure over time with the personal baseline shaded">
      {base && <rect x="0" y={yOf(base.p90)} width={baseEndX} height={Math.max(0.5, yOf(base.p10) - yOf(base.p90))} fill="rgba(15,118,110,0.12)" />}
      {base && <line x1="0" x2={W} y1={yOf(base.median)} y2={yOf(base.median)} stroke="#6e7977" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity="0.6" />}
      {showEvents && events.map((e) => {
        const x1 = (Math.max(0, e.start_day - 1) / Math.max(1, totalDays - 1)) * W
        const x2 = e.end_day ? Math.min(W, ((e.end_day - 1) / Math.max(1, totalDays - 1)) * W) : W
        return <rect key={`${e.label}-${e.start_day}`} x={x1} y="0" width={Math.max(0.5, x2 - x1)} height={H} fill="rgba(180,83,9,0.12)" />
      })}
      {past.length > 1 && <path d={toPath(past.map((p) => [xOf(p.day), yOf(p.value)]))} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {future.length > 1 && <path d={toPath(future.map((p) => [xOf(p.day), yOf(p.value)]))} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 3" opacity="0.3" vectorEffect="non-scaling-stroke" />}
      {cursorX !== null && <line x1={cursorX} x2={cursorX} y1="0" y2={H} stroke="#4338CA" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      {lastPast && <circle cx={xOf(lastPast.day)} cy={yOf(lastPast.value)} r="1.6" fill={color} vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

/** Tiny weekly trend with the person's "usual range" shaded. `range` = {low, high} in native units. */
export function Sparkline({ values, range, color = '#005c55', height = 56, label = 'Trend over recent weeks' }) {
  if (!values?.length) return <div className="rounded-md bg-surface-container-low" style={{ height }} aria-hidden="true" />
  const lows = [...values, range?.low, range?.high].filter((v) => v !== undefined && v !== null)
  const lo = Math.min(...lows)
  const hi = Math.max(...lows)
  const span = hi - lo || 1
  const yOf = (v) => 6 + (1 - (v - lo) / span) * (H - 12)
  const xOf = (i) => (values.length === 1 ? W / 2 : (i / (values.length - 1)) * W)
  const pts = values.map((v, i) => [xOf(i), yOf(v)])
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full rounded-md bg-surface-container-low" style={{ height }} role="img" aria-label={label}>
      {range && <rect x="0" y={yOf(range.high)} width={W} height={Math.max(1, yOf(range.low) - yOf(range.high))} fill="rgba(15,118,110,0.10)" />}
      <path d={toPath(pts)} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Baseline-vs-recent horizontal bars, scaled to the larger of the two. */
export function CompareBars({ baseline, recent, format = (v) => v, recentColor = 'bg-secondary-container' }) {
  const max = Math.max(baseline ?? 0, recent ?? 0) || 1
  const row = (label, value, color) => (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-body-sm text-on-surface-variant">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-container">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, ((value ?? 0) / max) * 100)}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-data-mono">{format(value)}</span>
    </div>
  )
  return <div className="space-y-2">{row('Baseline', baseline, 'bg-primary-container')}{row('Recent', recent, recentColor)}</div>
}
