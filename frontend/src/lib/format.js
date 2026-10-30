const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const monthDay = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

export const longDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export const shortDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

export const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(`${toIso}T00:00:00`) - new Date(`${fromIso}T00:00:00`)) / 86400000)

export const todayIso = () => isoOf(new Date())

export const greeting = (date = new Date()) => {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export const num = (value, digits = 0) =>
  value === null || value === undefined ? '–' : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits })

export const pct = (value, digits = 1) =>
  value === null || value === undefined ? '–' : `${value > 0 ? '+' : ''}${Number(value).toFixed(digits)}%`

export const usd = (value) => `$${Number(value || 0).toFixed(4)}`

export const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

export const firstName = (name = '') => name.replace(/\s*\(synthetic\)\s*/i, '').split(' ')[0] || 'there'

/** Unit-aware display of a metric value. */
export function metricValue(key, value) {
  if (value === null || value === undefined) return '–'
  if (key === 'correction_rate') return `${(value * 100).toFixed(1)}%`
  if (key === 'lexical_diversity' || key === 'recall_score') return Number(value).toFixed(2)
  if (key === 'pause_rate') return Number(value).toFixed(1)
  return `${Math.round(value).toLocaleString('en-GB')} ms`
}
