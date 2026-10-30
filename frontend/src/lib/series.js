import { addDays, daysBetween } from './format'

/** Keep only points on or before a day (ISO strings compare correctly as text). */
export const upTo = (points, asOf) => (asOf ? points.filter((p) => p.day <= asOf) : points)

/** Weekly means for the last `weeks` weeks ending at `asOf` (oldest first). Empty weeks are skipped. */
export function toWeekly(points, asOf, weeks = 12) {
  const end = asOf || points[points.length - 1]?.day
  if (!end) return []
  const result = []
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const weekEnd = addDays(end, -7 * w)
    const weekStart = addDays(weekEnd, -6)
    const values = points.filter((p) => p.day >= weekStart && p.day <= weekEnd).map((p) => p.value)
    if (values.length) result.push({ week_ending: weekEnd, mean: values.reduce((a, b) => a + b, 0) / values.length })
  }
  return result
}

/** The value on or just before a day (what a person would have "seen" that day). */
export function valueAt(points, day) {
  let found = null
  for (const p of points) {
    if (p.day <= day) found = p
    else break
  }
  return found
}

/** Position (0..1) of a date within a [firstDay, firstDay + totalDays - 1] window. */
export const position = (day, firstDay, totalDays) =>
  totalDays <= 1 ? 0 : Math.min(1, Math.max(0, daysBetween(firstDay, day) / (totalDays - 1)))

export function stats(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]
  return { min: sorted[0], max: sorted[sorted.length - 1], p10: at(0.1), p90: at(0.9), median: at(0.5) }
}
