/**
 * On-device typing feature extraction. Everything here runs in the browser. The typed text is
 * only used to count words and compute lexical diversity; only the resulting numbers
 * (see `buildPayload`) are sent to the server.
 *
 * Two input modes:
 *  - "keyboard": keydown/keyup events give flight time (release -> next press) and hold time.
 *  - "touch":    virtual keyboards often report "Unidentified" keys and no reliable keyup, so
 *                `beforeinput` timestamps are used instead and no hold time is reported.
 * The mode is sent with the numbers, and the server never mixes the two in a baseline.
 */

export const LONG_PAUSE_MS = 2000
export const MIN_KEYSTROKES = 20
const MAX_INTERVAL_MS = 20000 // gaps longer than this are breaks, not typing
const MATTR_WINDOW = 25

const DELETE_INPUT_TYPES = new Set(['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward'])
const TYPED_INPUT_TYPES = new Set(['insertText', 'insertCompositionText', 'insertReplacementText', ...DELETE_INPUT_TYPES])

export const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export const percentile = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))
const round = (value, digits = 1) => Number(value.toFixed(digits))

export function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])
}

export const wordCount = (text) => tokenize(text).length

/**
 * Moving-average type/token ratio (MATTR): the mean share of unique words in a sliding window.
 * Unlike a plain type/token ratio it does not shrink just because the text is longer.
 * Returns null for very short texts, where the measure is meaningless.
 */
export function lexicalDiversity(text, windowSize = MATTR_WINDOW) {
  const tokens = tokenize(text)
  if (tokens.length < 10) return null
  if (tokens.length <= windowSize) return new Set(tokens).size / tokens.length
  const counts = new Map()
  let unique = 0
  let total = 0
  let windows = 0
  tokens.forEach((token, i) => {
    counts.set(token, (counts.get(token) || 0) + 1)
    if (counts.get(token) === 1) unique += 1
    if (i >= windowSize) {
      const old = tokens[i - windowSize]
      counts.set(old, counts.get(old) - 1)
      if (counts.get(old) === 0) unique -= 1
    }
    if (i >= windowSize - 1) {
      total += unique / windowSize
      windows += 1
    }
  })
  return total / windows
}

const isDeleteKey = (key) => key === 'Backspace' || key === 'Delete'
const isTrackedKey = (key) => key.length === 1 || isDeleteKey(key) || key === 'Enter'

/** Collects raw timing events from a text field. It never stores which characters were typed. */
export class TypingRecorder {
  constructor() {
    this.reset()
  }

  reset() {
    this.downs = [] // {t, del}
    this.holds = []
    this.flights = []
    this.pendingDown = new Map() // physical key (event.code) -> press time
    this.lastUp = null
    this.inputs = [] // {t, del}  (beforeinput, used on touch screens)
  }

  keyDown(e) {
    if (e.isComposing || e.repeat || !e.key || e.key === 'Unidentified' || !isTrackedKey(e.key)) return
    const t = e.timeStamp
    if (this.lastUp !== null && t >= this.lastUp) {
      const flight = t - this.lastUp
      if (flight <= LONG_PAUSE_MS) this.flights.push(flight)
    }
    this.pendingDown.set(e.code || e.key, t)
    this.downs.push({ t, del: isDeleteKey(e.key) })
  }

  keyUp(e) {
    const code = e.code || e.key
    const pressed = this.pendingDown.get(code)
    if (pressed === undefined) return
    this.pendingDown.delete(code)
    const hold = e.timeStamp - pressed
    if (hold > 0 && hold < 1000) this.holds.push(hold)
    this.lastUp = e.timeStamp
  }

  beforeInput(e) {
    if (!TYPED_INPUT_TYPES.has(e.inputType)) return
    this.inputs.push({ t: e.timeStamp, del: DELETE_INPUT_TYPES.has(e.inputType) })
  }

  /** The input style this session looks like. */
  get mode() {
    return this.downs.length >= 0.7 * this.inputs.length && this.downs.length > 0 ? 'keyboard' : 'touch'
  }

  get keystrokeCount() {
    return this.mode === 'keyboard' ? this.downs.length : this.inputs.length
  }

  /** Numbers for the live "On your device" panel (null while there is not enough to measure). */
  features(text) {
    return computeFeatures(this, text)
  }
}

/**
 * Turn recorded events + text into the numeric features of the data contract.
 * Returns { ready, reason?, mode, features }.
 */
export function computeFeatures(recorder, text) {
  const mode = recorder.mode
  const events = mode === 'keyboard' ? recorder.downs : recorder.inputs
  const keystrokes = events.length
  const words = wordCount(text)
  const diversity = lexicalDiversity(text)

  const intervals = []
  for (let i = 1; i < events.length; i += 1) {
    const gap = events[i].t - events[i - 1].t
    if (gap > 0 && gap <= MAX_INTERVAL_MS) intervals.push(gap)
  }
  const flights = mode === 'keyboard' ? recorder.flights : intervals.filter((g) => g <= LONG_PAUSE_MS)

  const features = {
    median_flight_ms: flights.length ? clamp(round(median(flights)), 20, 2000) : null,
    hold_time_ms: mode === 'keyboard' && recorder.holds.length ? clamp(round(median(recorder.holds)), 10, 1000) : null,
    p90_pause_ms: intervals.length ? clamp(round(percentile(intervals, 90)), 50, 20000) : null,
    pause_rate: keystrokes ? clamp(round((intervals.filter((g) => g > LONG_PAUSE_MS).length / keystrokes) * 100, 2), 0, 100) : null,
    correction_rate: keystrokes ? clamp(round(events.filter((e) => e.del).length / keystrokes, 3), 0, 1) : null,
    lexical_diversity: diversity === null ? null : round(diversity, 3),
    keystroke_count: keystrokes,
    word_count: words,
  }

  if (keystrokes < MIN_KEYSTROKES) {
    return { ready: false, reason: `Keep writing: ${MIN_KEYSTROKES - keystrokes} more keystrokes are needed.`, mode, features }
  }
  return { ready: true, mode, features }
}

const localDay = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The exact JSON that leaves the device. Null measures are omitted, text is never included, and
 * the server rejects any field that is not part of the data contract.
 */
export function buildPayload(userId, result, now = new Date()) {
  const payload = {
    user_id: userId,
    session_id: `${userId}-${localDay(now)}-${now.getTime().toString(36)}`.slice(0, 64),
    day: localDay(now),
    input_mode: result.mode,
  }
  Object.entries(result.features).forEach(([key, value]) => {
    if (value !== null && value !== undefined) payload[key] = value
  })
  return payload
}
