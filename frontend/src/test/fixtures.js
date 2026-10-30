/** Realistic API payloads for the render tests. */
const METRICS = {
  median_flight_ms: ['Median flight time', 'ms', 'motor', 190, 260],
  hold_time_ms: ['Median key hold time', 'ms', 'motor', 95, 108],
  p90_pause_ms: ['90th-percentile inter-key pause', 'ms', 'hesitation', 900, 1400],
  pause_rate: ['Long pauses per 100 keystrokes', 'per 100 keys', 'hesitation', 3, 5.5],
  correction_rate: ['Correction rate', 'fraction', 'hesitation', 0.08, 0.13],
  lexical_diversity: ['Lexical diversity', '0-1', 'linguistic', 0.62, 0.5],
  recall_score: ['Delayed-recall score', '0-1', 'memory', 0.9, 0.8],
}

const iso = (d) => d.toISOString().slice(0, 10)
export const FIRST_DAY = '2026-01-01'

export const makeSeries = (days = 90) => {
  const series = {}
  Object.entries(METRICS).forEach(([key, [, , , base, end]]) => {
    series[key] = Array.from({ length: days }, (_, i) => {
      const d = new Date(`${FIRST_DAY}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      const p = Math.max(0, (i - 35) / (days - 36))
      return { day: iso(d), value: base + (end - base) * p }
    })
  })
  return { user_id: 'arthur_demo', as_of: null, first_day: FIRST_DAY, series }
}

export const makeScreen = (overall = 'sustained_multi_domain_drift') => {
  const drift = overall === 'sustained_multi_domain_drift'
  const metrics = {}
  Object.entries(METRICS).forEach(([key, [label, unit, domain, base, end]]) => {
    metrics[key] = {
      metric: key, label, unit, domain, status: drift ? 'sustained_shift' : 'stable', pattern: drift ? 'gradual_drift' : null,
      baseline: { median: base, spread: base * 0.05, days: 28 },
      recent: { mean: drift ? end : base, days: 14, change_pct: drift ? Math.round(((end - base) / base) * 1000) / 10 : 0.4, shift_z: drift ? 6 : 0.2 },
      trend: { weeks: 10, slope_per_week: 1, tau: 0.8, p_value: 0.001 }, cusum: { active: drift, value: 9, onset: '2026-02-20', onset_age_days: 40 },
    }
  })
  const domains = {}
  ;['motor', 'hesitation', 'linguistic', 'memory'].forEach((d) => { domains[d] = { status: drift ? 'sustained_shift' : 'stable', metrics: [] } })
  return { as_of: '2026-03-31', first_day: FIRST_DAY, history_days: 90, active_days: 84, input_mode: 'keyboard',
    overall_signal: overall, sustained_domains: drift ? Object.keys(domains) : [], acute_domains: [], domains, metrics }
}

export const USERS = [
  { user_id: 'arthur_demo', display_name: 'Arthur (synthetic)', is_synthetic: true, checkin_consent: true, session_count: 176, first_day: FIRST_DAY, last_day: '2026-03-31' },
  { user_id: 'mary_demo', display_name: 'Mary (synthetic)', is_synthetic: true, checkin_consent: true, session_count: 150, first_day: FIRST_DAY, last_day: '2026-03-31' },
]

export const LAST_PAYLOAD = { user_id: 'arthur_demo', session_id: 'arthur_demo-2026-03-31-0', day: '2026-03-31', input_mode: 'keyboard',
  median_flight_ms: 228, hold_time_ms: 118, p90_pause_ms: 1480, pause_rate: 5.4, correction_rate: 0.14, lexical_diversity: 0.46, keystroke_count: 894, word_count: 142 }

export const makeOverview = (overall = 'sustained_multi_domain_drift') => ({
  user: USERS[0], screen: makeScreen(overall), min_history_days: 42,
  template: { headline: 'A sustained, gradual change', recommendation: overall === 'sustained_multi_domain_drift' ? 'suggest_routine_checkup' : 'no_action',
    patient_message: overall === 'sustained_multi_domain_drift' ? 'Over the past few weeks we noticed a steady change. It may be worth mentioning at your next routine check-up.' : 'Everything looks steady.' },
  latest_analysis: null, plans: [{ memory_id: 7, day: '2026-03-30', plan: 'plant the tomatoes' }], last_payload: LAST_PAYLOAD, checkin_available: true, notifications: [],
})

export const RUN = {
  run_id: '3f2a9c1b7d40', user_id: 'arthur_demo', as_of: '2026-03-31', screen: makeScreen(),
  final: { overall_signal: 'sustained_multi_domain_drift', recommendation: 'suggest_routine_checkup', confidence: 'high', headline: 'Gradual multi-domain shift versus baseline',
    patient_message: 'Over recent weeks we noticed a steady change.', clinician_summary: 'Gradual multi-domain shift. This is a screening summary, not a diagnosis.',
    evidence: [{ metric: 'p90_pause_ms', observation: 'Longer pauses than the personal baseline.', baseline_value: 900, recent_value: 1400, change_pct: 55.6 }],
    limitations: ['Baseline is the first four weeks.'], confounders: [{ name: 'New keyboard', likelihood: 'low', reasoning: 'Thinking measures also moved.' }],
    confounder_pattern_summary: 'Gradual and multi-domain.', verification_status: 'passed', needs_human_review: false, guardrail_notes: [] },
  report: { title: 'Cognitive-pattern screening summary', subject: { user_id: 'arthur_demo', display_name: 'Arthur (synthetic)', synthetic_data: true },
    window: { as_of: '2026-03-31', first_day: FIRST_DAY, history_days: 90, active_days: 84 }, overall_signal: 'sustained_multi_domain_drift',
    metrics_table: Object.entries(METRICS).map(([key, [label, unit, domain, base, end]]) => ({ metric: label, unit, domain, baseline_median: base, recent_mean: end,
      change_pct: Math.round(((end - base) / base) * 1000) / 10, status: 'sustained_shift' })),
    narrative: { clinician_summary: 'Gradual multi-domain shift. This is a screening summary, not a diagnosis.', confidence: 'high', recommendation: 'suggest_routine_checkup', confounders_considered: [] },
    disclaimer: 'This report is NOT a diagnosis.', limitations: ['Baseline is the first four weeks.', 'Heuristic thresholds.'] },
  trace: [{ node: 'load_screen', status: 'ok', duration_ms: 12 }, { node: 'confounder_review', status: 'ok', duration_ms: 800 }, { node: 'analyst', status: 'ok', duration_ms: 2400 },
    { node: 'verify', status: 'ok', duration_ms: 600 }, { node: 'safety_guard', status: 'ok', duration_ms: 1 }, { node: 'build_report', status: 'ok', duration_ms: 20 }],
  usage: { calls: 4, total_tokens: 7300, total_cost_usd: 0.0042, per_model: {
    'nvidia/Nemotron-3-Ultra-550b-a55b': { calls: 1, latency_ms: 2400, input_tokens: 2500, output_tokens: 600, cost_usd: 0.0038 },
    'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B': { calls: 3, latency_ms: 1400, input_tokens: 3800, output_tokens: 400, cost_usd: 0.0004 } } },
}

/** Install a fake fetch. `routes` maps "METHOD /path" (query ignored) to a body or a function returning {status, body}. */
export function installApi(routes = {}) {
  const calls = []
  const defaults = {
    'GET /api/users': { users: USERS },
    'GET /api/health': { status: 'ok', models: { analyst: 'nvidia/Nemotron-3-Ultra-550b-a55b', fast: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B' }, checkin_enabled: true, checkin_runs_locally: false, checkin_model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B' },
    'GET /api/evaluation': EVALUATION,
    'GET /api/privacy/contract': { allowed_fields: ['day', 'median_flight_ms', 'session_id', 'user_id', 'word_count'], metrics: [] },
    'GET /api/users/arthur_demo/overview': makeOverview(),
    'GET /api/users/arthur_demo/series': makeSeries(),
    'GET /api/users/arthur_demo/screen': makeScreen(),
    'GET /api/demo/personas': { personas: [
      { user_id: 'arthur_demo', display_name: 'Arthur (synthetic)', description: 'Gradual slowing', events: [{ label: 'Gradual change begins', start_day: 36, end_day: null }], seeded: true },
      { user_id: 'mary_demo', display_name: 'Mary (synthetic)', description: 'Healthy and steady', events: [], seeded: true }] },
    'GET /api/runs/3f2a9c1b7d40': RUN,
    'GET /api/users/arthur_demo/runs': { runs: [{ run_id: '3f2a9c1b7d40' }] },
  }
  const table = { ...defaults, ...routes }
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(url).split('?')[0]
    calls.push({ method, url: String(url), body: init.body ? JSON.parse(init.body) : undefined })
    const entry = table[`${method} ${path}`]
    if (entry === undefined) return { ok: false, status: 404, json: async () => ({ error: { code: 'not_found', message: `no mock for ${method} ${path}` } }) }
    const out = typeof entry === 'function' ? entry(init) : entry
    const status = out?.__status ?? 200
    const body = out?.__status ? out.body : out
    return { ok: status < 400, status, json: async () => body }
  }
  return calls
}

const rate = (count, of) => ({ count, of, rate: count / of, ci95: [Math.max(0, count / of - 0.06), Math.min(1, count / of + 0.06)] })
export const EVALUATION = {
  generated_at: '2026-10-06T18:00:00+00:00', seconds: 15.8, synthetic: true,
  parameters: { days: 90, decline_onset_day: 36, healthy_people: 60, people_per_decline_strength: 30, people_per_confounder: 30,
    flagged_signals: ['motor_only_change', 'single_domain_drift', 'sustained_multi_domain_drift'],
    thresholds: { shift_z: 1.5, cusum_k: 0.5, cusum_h: 5, sustained_min_age_days: 21 } },
  healthy: { people: 60, checkpoint_days: [50, 60, 70, 80, 90], people_ever_flagged: rate(0, 60), checkpoints_flagged: rate(0, 300) },
  decline: [
    { scale: 0.25, label: 'Very subtle', people: 30, detected: rate(6, 30), median_delay_days: 51, p90_delay_days: 54 },
    { scale: 0.5, label: 'Subtle', people: 30, detected: rate(30, 30), median_delay_days: 42, p90_delay_days: 48 },
    { scale: 1, label: 'Demo strength', people: 30, detected: rate(30, 30), median_delay_days: 30, p90_delay_days: 33 }],
  flu: { people: 30, mid_illness_day: 74, recovered_day: 90, mistaken_for_decline_during_illness: rate(2, 30),
    recognised_as_acute_during_illness: rate(25, 30), flagged_after_recovery: rate(1, 30) },
  keyboard: { people: 30, day: 90, recognised_as_mechanical_only: rate(30, 30), mistaken_for_cognitive_change: rate(0, 30) },
  caveats: ['All people are simulated. The simulator and the thresholds were developed together, so these results are optimistic.', 'Real-world accuracy has not been measured.'],
}
