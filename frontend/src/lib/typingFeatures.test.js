import { describe, expect, it } from 'vitest'
import { TypingRecorder, buildPayload, computeFeatures, lexicalDiversity, median, percentile, wordCount } from './typingFeatures'

/** Simulate a typist: `n` keys, each pressed every `step` ms and held `hold` ms. */
function type(recorder, { n, step, hold, start = 1000, gapAt = null, gap = 0, backspaceEvery = 0 }) {
  let t = start
  for (let i = 0; i < n; i += 1) {
    if (gapAt === i) t += gap
    const del = backspaceEvery && i % backspaceEvery === backspaceEvery - 1
    const key = del ? 'Backspace' : 'a'
    recorder.keyDown({ key, code: del ? 'Backspace' : 'KeyA', timeStamp: t })
    recorder.keyUp({ key, code: del ? 'Backspace' : 'KeyA', timeStamp: t + hold })
    t += step
  }
}

describe('basic statistics', () => {
  it('median and percentile', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(percentile([1, 2, 3, 4, 5], 90)).toBeCloseTo(4.6)
  })
})

describe('lexical diversity (MATTR)', () => {
  it('is null for very short text and high for varied text', () => {
    expect(lexicalDiversity('too short')).toBeNull()
    const varied = 'the quick brown fox jumps over a lazy dog while seven bright owls watch from tall green trees nearby today'
    expect(lexicalDiversity(varied)).toBeGreaterThan(0.9)
  })
  it('is low for repetitive text', () => {
    const repetitive = Array(60).fill('good day good day good').join(' ')
    expect(lexicalDiversity(repetitive)).toBeLessThan(0.3)
  })
  it('counts words in any script', () => {
    expect(wordCount("Habari ya asubuhi, it's a lovely day")).toBe(7)
  })
})

describe('keyboard features', () => {
  it('measures flight, hold and pauses from key events', () => {
    const r = new TypingRecorder()
    type(r, { n: 60, step: 250, hold: 90 }) // flight = 250 - 90 = 160 ms
    const { ready, mode, features } = r.features('some text '.repeat(10))
    expect(ready).toBe(true)
    expect(mode).toBe('keyboard')
    expect(features.median_flight_ms).toBeCloseTo(160, 0)
    expect(features.hold_time_ms).toBeCloseTo(90, 0)
    expect(features.pause_rate).toBe(0)
    expect(features.correction_rate).toBe(0)
    expect(features.keystroke_count).toBe(60)
  })

  it('counts long pauses and corrections', () => {
    const r = new TypingRecorder()
    type(r, { n: 50, step: 200, hold: 80, gapAt: 25, gap: 3000, backspaceEvery: 10 })
    const { features } = r.features('word '.repeat(30))
    expect(features.pause_rate).toBeCloseTo(2, 0) // 1 long pause in 50 keystrokes
    expect(features.correction_rate).toBeCloseTo(0.1, 2)
    expect(features.p90_pause_ms).toBeGreaterThan(0)
  })

  it('ignores held-down key repeat and composition events', () => {
    const r = new TypingRecorder()
    r.keyDown({ key: 'a', code: 'KeyA', timeStamp: 1000, repeat: true })
    r.keyDown({ key: 'a', code: 'KeyA', timeStamp: 1010, isComposing: true })
    r.keyDown({ key: 'Unidentified', code: '', timeStamp: 1020 })
    r.keyDown({ key: 'Shift', code: 'ShiftLeft', timeStamp: 1030 })
    expect(r.downs).toHaveLength(0)
  })

  it('is not ready until there are enough keystrokes', () => {
    const r = new TypingRecorder()
    type(r, { n: 5, step: 200, hold: 80 })
    expect(r.features('hi').ready).toBe(false)
  })
})

describe('touch (virtual keyboard) fallback', () => {
  it('uses beforeinput timing, reports no hold time, and labels the session as touch', () => {
    const r = new TypingRecorder()
    for (let i = 0; i < 40; i += 1) {
      r.keyDown({ key: 'Unidentified', code: '', timeStamp: 1000 + i * 300 }) // Android IME: ignored
      r.beforeInput({ inputType: i % 8 === 7 ? 'deleteContentBackward' : 'insertText', timeStamp: 1000 + i * 300 })
    }
    const { ready, mode, features } = r.features('the garden was wet this morning and the robins sang loudly')
    expect(ready).toBe(true)
    expect(mode).toBe('touch')
    expect(features.hold_time_ms).toBeNull()
    expect(features.median_flight_ms).toBeCloseTo(300, 0)
    expect(features.correction_rate).toBeCloseTo(5 / 40, 2)
  })
})

describe('what leaves the device', () => {
  it('builds a payload with only contract fields and never any text', () => {
    const r = new TypingRecorder()
    type(r, { n: 60, step: 250, hold: 90 })
    const result = computeFeatures(r, 'a private sentence that must never be sent anywhere at all today ok')
    const payload = buildPayload('arthur_demo', result, new Date('2026-04-01T09:00:00'))
    const allowed = ['user_id', 'session_id', 'day', 'input_mode', 'median_flight_ms', 'hold_time_ms', 'p90_pause_ms',
      'pause_rate', 'correction_rate', 'lexical_diversity', 'keystroke_count', 'word_count']
    expect(Object.keys(payload).every((k) => allowed.includes(k))).toBe(true)
    expect(JSON.stringify(payload)).not.toContain('private')
    expect(payload.day).toBe('2026-04-01')
    expect(payload.session_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })
})
