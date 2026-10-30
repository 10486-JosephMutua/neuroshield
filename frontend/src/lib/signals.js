/** Plain-language labels for the server's signals, and the tri-coded status system from the design. */

export const STATUS = {
  steady: { key: 'steady', label: 'Steady', icon: 'check_circle', bg: 'bg-steady-bg', fg: 'text-steady-fg' },
  slight: { key: 'slight', label: 'Slightly different', icon: 'visibility', bg: 'bg-slight-bg', fg: 'text-slight-fg' },
  worth: { key: 'worth', label: 'Worth a conversation', icon: 'forum', bg: 'bg-worth-bg', fg: 'text-worth-fg' },
}

/** Server per-domain status -> design status. Motor-only changes are never "worth a conversation". */
export function domainStatus(domain, status, overall) {
  if (status === 'sustained_shift') return domain === 'motor' && overall === 'motor_only_change' ? STATUS.slight : STATUS.worth
  if (status === 'acute_shift' || status === 'watch') return STATUS.slight
  return STATUS.steady
}

export function metricStatus(status) {
  if (status === 'sustained_shift') return STATUS.worth
  if (status === 'acute_shift' || status === 'watch') return STATUS.slight
  return STATUS.steady
}

export const SIGNALS = {
  insufficient_data: { label: 'Still learning your normal', tone: 'steady', icon: 'hourglass_top',
    text: 'There is not enough history yet to compare you with your own baseline.' },
  stable: { label: 'Steady', tone: 'steady', icon: 'check_circle',
    text: 'Patterns are steady compared with the personal baseline.' },
  minor_fluctuation: { label: 'Small fluctuations', tone: 'steady', icon: 'check_circle',
    text: 'Small ups and downs only; nothing sustained.' },
  acute_change: { label: 'A recent short-lived change', tone: 'slight', icon: 'visibility',
    text: 'A recent change that has not lasted long; common with tiredness or illness.' },
  motor_only_change: { label: 'Typing mechanics changed', tone: 'slight', icon: 'keyboard',
    text: 'Key timing changed while thinking-related measures did not; often a new keyboard or device.' },
  single_domain_drift: { label: 'One area changed', tone: 'slight', icon: 'visibility',
    text: 'A sustained change in one area only.' },
  sustained_multi_domain_drift: { label: 'Sustained change across several areas', tone: 'worth', icon: 'forum',
    text: 'A gradual, sustained change across several areas compared with the personal baseline.' },
}

export const signalInfo = (key) => SIGNALS[key] || SIGNALS.insufficient_data
export const toneStatus = (tone) => STATUS[tone] || STATUS.steady

export const DOMAINS = {
  motor: { title: 'Typing speed', clinical: 'Motor', icon: 'keyboard', metric: 'median_flight_ms' },
  hesitation: { title: 'Pauses and corrections', clinical: 'Hesitation', icon: 'timer_pause', metric: 'p90_pause_ms' },
  linguistic: { title: 'Word variety', clinical: 'Language', icon: 'menu_book', metric: 'lexical_diversity' },
  memory: { title: 'Remembering', clinical: 'Memory', icon: 'psychology', metric: 'recall_score' },
}

export const DOMAIN_SENTENCES = {
  motor: { steady: 'Your typing speed is in your usual range.', slight: 'Your typing has been a little slower than usual.',
    worth: 'Your typing has been noticeably slower than usual.' },
  hesitation: { steady: 'Your pauses are in your usual range.', slight: 'You have paused to think a little more often.',
    worth: 'You have paused to think a bit more often.' },
  linguistic: { steady: 'Your range of words is as usual.', slight: 'You have used a slightly narrower range of words.',
    worth: 'You have used a narrower range of words than usual.' },
  memory: { steady: 'Your daily check-ins have gone well.', slight: 'Your check-ins have been a little different lately.',
    worth: 'Your check-ins have been different from usual.' },
}

export const RECOMMENDATIONS = {
  no_action: 'Nothing needs your attention',
  keep_monitoring: 'Keep monitoring',
  suggest_routine_checkup: 'Suggest mentioning at a routine check-up',
}

export const RUN_NODES = {
  load_screen: { label: 'load_screen', badge: 'MCP', detail: 'Deterministic statistics' },
  confounder_review: { label: 'confounder_review', badge: 'Nemotron Nano', detail: 'Everyday explanations' },
  analyst: { label: 'analyst', badge: 'Nemotron Ultra', detail: 'Interprets the screen' },
  verify: { label: 'verify', badge: 'Code + Nano', detail: 'Checks numbers and wording' },
  safety_guard: { label: 'safety_guard', badge: 'Code', detail: 'Policy and wording rules' },
  build_report: { label: 'build_report', badge: 'MCP', detail: 'Clinician report' },
  template_summary: { label: 'template_summary', badge: 'Code', detail: 'Calm signal: no model needed' },
  fallback_summary: { label: 'fallback_summary', badge: 'Code', detail: 'Used if verification fails' },
}
