/**
 * Backoff-and-retry on transient Nominatim rate-limit responses.
 *
 * WHY THIS EXISTS: before 2026-08-04 the geocoder threw on ANY non-200, so a single transient 429
 * killed a whole metro's extract mid-run. The rate limit is on the ENDPOINT, not on this process, so
 * one client under load is enough to trip it — this is not only a concurrency concern.
 *
 * Every test here injects `fetchImpl` / `sleepImpl` / `random`, so the whole ladder is exercised with
 * no network and no wall-clock wait. `random: () => 0.5` makes the ±25% jitter multiplier exactly
 * 1.0 (0.75 + 0.5 * 0.5), so the asserted delays are the raw exponential values.
 *
 * `geocode-nominatim.mjs` is plain ESM with no types, so tsc widens its exports to `object`. Typed
 * wrappers at the boundary keep `tsc --noEmit` green without loosening the gate.
 */
import { describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, parseRetryAfter, retryDelayMs } from '../geocode-nominatim.mjs'

type Row = Record<string, any>

const parseRA = parseRetryAfter as (value: unknown, nowMs?: number) => number | null
const retryDelay = retryDelayMs as (args: Row) => number | null
const withRetry = fetchWithRetry as (url: unknown, opts?: Row) => Promise<Row>

/** A minimal Response stand-in. `headers.get` mirrors the real casing-insensitive lookup we rely on. */
const response = (status: number, { body = [] as unknown, retryAfter = null as string | null, statusText = '' } = {}): Row => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: statusText || (status === 429 ? 'Too Many Requests' : status === 503 ? 'Service Unavailable' : status === 404 ? 'Not Found' : 'Error'),
  headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
  text: async () => '',
  json: async () => body,
})

/** Returns a fetch stub that replays `queue` in order, plus the recorded calls. */
const fetcher = (queue: Row[]) => {
  const calls: Row[] = []
  const impl = async (url: unknown, opts: Row) => {
    calls.push({ url, opts })
    if (!queue.length) throw new Error('fetch stub exhausted — the retry loop asked for more attempts than the test queued')
    return queue.shift()!
  }
  return { impl, calls }
}

const recorder = () => {
  const slept: number[] = []
  return { slept, sleepImpl: async (ms: number) => void slept.push(ms) }
}

describe('parseRetryAfter', () => {
  it('reads the delta-seconds form', () => {
    expect(parseRA('7')).toBe(7000)
    expect(parseRA('  120 ')).toBe(60_000) // clamped at the 60 s cap
    expect(parseRA('0')).toBe(0)
  })

  it('reads the HTTP-date form, relative to the supplied clock', () => {
    const now = Date.parse('2026-08-04T12:00:00Z')
    expect(parseRA('Tue, 04 Aug 2026 12:00:30 GMT', now)).toBe(30_000)
  })

  it('clamps a date already in the past to zero rather than going negative', () => {
    const now = Date.parse('2026-08-04T12:00:00Z')
    expect(parseRA('Tue, 04 Aug 2026 11:59:00 GMT', now)).toBe(0)
  })

  it('caps an absurd value so a hostile or misconfigured header cannot park the run', () => {
    const now = Date.parse('2026-08-04T12:00:00Z')
    expect(parseRA('86400', now)).toBe(60_000)
    expect(parseRA('Wed, 05 Aug 2026 12:00:00 GMT', now)).toBe(60_000)
  })

  it('returns null — not 0 — for anything unusable, so the caller falls back to its own ladder', () => {
    expect(parseRA(null)).toBeNull()
    expect(parseRA(undefined)).toBeNull()
    expect(parseRA('')).toBeNull()
    expect(parseRA('   ')).toBeNull()
    expect(parseRA('soon')).toBeNull()
  })

  /**
   * REGRESSION. `Date.parse` is not a validity test: V8 reads `-5` as a date in year 5 BC, which
   * clamps to a 0 ms delay and so would silently disable the backoff for that request. Caught by
   * this test on the first run. The shape guard rejects it and we fall back to our own ladder.
   */
  it('rejects junk that Date.parse happens to accept as an ancient date', () => {
    expect(parseRA('-5')).toBeNull()
    expect(parseRA('7x')).toBeNull()
  })

  it('still accepts all three RFC 7231 date forms', () => {
    const now = Date.parse('1994-11-06T08:49:07Z')
    // The two zoned forms are deterministic, so assert the delta exactly.
    expect(parseRA('Sun, 06 Nov 1994 08:49:37 GMT', now)).toBe(30_000) // IMF-fixdate
    expect(parseRA('Sunday, 06-Nov-94 08:49:37 GMT', now)).toBe(30_000) // RFC 850
    // asctime carries NO timezone, so Date.parse reads it as LOCAL time and the delta depends on the
    // runner's offset. Assert only what is machine-independent: the shape guard admits it rather
    // than dropping it to the exponential fallback.
    expect(parseRA('Sun Nov  6 08:49:37 1994', now)).not.toBeNull()
  })
})

describe('retryDelayMs — which statuses are transient', () => {
  const base = { attempt: 1, random: () => 0.5 }

  it('retries 429 and 503, the two the endpoint actually returns under load', () => {
    expect(retryDelay({ ...base, status: 429 })).toBe(2000)
    expect(retryDelay({ ...base, status: 503 })).toBe(2000)
  })

  it('does NOT retry a genuine error — a real failure must never be laundered into a retry', () => {
    for (const status of [400, 401, 403, 404, 500, 502, 504]) {
      expect(retryDelay({ ...base, status })).toBeNull()
    }
  })

  it('doubles per attempt and caps the exponential ladder', () => {
    const at = (attempt: number) => retryDelay({ status: 429, attempt, random: () => 0.5, maxRetries: 99 })
    expect(at(1)).toBe(2000)
    expect(at(2)).toBe(4000)
    expect(at(3)).toBe(8000)
    expect(at(4)).toBe(16_000)
    expect(at(5)).toBe(30_000) // 32 s would exceed the cap
    expect(at(9)).toBe(30_000)
  })

  it('returns null once the retry budget is spent, so a persistent 429 TERMINATES', () => {
    expect(retryDelay({ status: 429, attempt: 4, random: () => 0.5 })).toBe(16_000)
    expect(retryDelay({ status: 429, attempt: 5, random: () => 0.5 })).toBeNull()
  })

  it('lets Retry-After override the exponential value', () => {
    expect(retryDelay({ status: 429, attempt: 1, retryAfterHeader: '9', random: () => 0.5 })).toBe(9000)
  })

  it('applies jitter within +/-25% of the base', () => {
    expect(retryDelay({ status: 429, attempt: 1, random: () => 0 })).toBe(1500)
    expect(retryDelay({ status: 429, attempt: 1, random: () => 1 })).toBe(2500)
  })
})

describe('fetchWithRetry', () => {
  it('recovers from a transient 429 and returns the eventual body', async () => {
    const { impl, calls } = fetcher([response(429), response(429), response(200, { body: [{ lat: '1', lon: '2' }] })])
    const { slept, sleepImpl } = recorder()

    const res = await withRetry('https://example.test/search?q=x', { fetchImpl: impl, sleepImpl, random: () => 0.5 })

    expect(await res.json()).toEqual([{ lat: '1', lon: '2' }])
    expect(calls).toHaveLength(3)
    expect(slept).toEqual([2000, 4000])
  })

  it('retries 503 the same way', async () => {
    const { impl, calls } = fetcher([response(503), response(200, { body: [] })])
    const { slept, sleepImpl } = recorder()

    await withRetry('u', { fetchImpl: impl, sleepImpl, random: () => 0.5 })

    expect(calls).toHaveLength(2)
    expect(slept).toEqual([2000])
  })

  it('honours Retry-After in preference to its own backoff', async () => {
    const { impl } = fetcher([response(429, { retryAfter: '5' }), response(200)])
    const { slept, sleepImpl } = recorder()

    await withRetry('u', { fetchImpl: impl, sleepImpl, random: () => 0.5 })

    expect(slept).toEqual([5000])
  })

  it('throws on a genuine error with the ORIGINAL message shape, first try, zero sleeps', async () => {
    const { impl, calls } = fetcher([response(404)])
    const { slept, sleepImpl } = recorder()

    await expect(withRetry('u', { fetchImpl: impl, sleepImpl, label: 'q=Kanis+Park' }))
      .rejects.toThrow('nominatim HTTP 404 Not Found for q=Kanis+Park')
    expect(calls).toHaveLength(1)
    expect(slept).toEqual([])
  })

  it('does not retry a 500 — an ambiguous server error stays terminal', async () => {
    const { impl, calls } = fetcher([response(500)])
    const { sleepImpl, slept } = recorder()

    await expect(withRetry('u', { fetchImpl: impl, sleepImpl })).rejects.toThrow(/nominatim HTTP 500/)
    expect(calls).toHaveLength(1)
    expect(slept).toEqual([])
  })

  it('gives up after a bounded number of attempts rather than hanging, and says so', async () => {
    const { impl, calls } = fetcher([response(429), response(429), response(429), response(429), response(429)])
    const { slept, sleepImpl } = recorder()

    await expect(withRetry('u', { fetchImpl: impl, sleepImpl, random: () => 0.5, label: 'q=x' }))
      .rejects.toThrow('nominatim HTTP 429 Too Many Requests for q=x — gave up after 5 attempt(s) and 30.0s of backoff')

    expect(calls).toHaveLength(5)
    expect(slept).toEqual([2000, 4000, 8000, 16_000])
  })

  it('runs beforeAttempt for EVERY attempt, so endpoint spacing survives a retry', async () => {
    const { impl } = fetcher([response(429), response(429), response(200)])
    const { sleepImpl } = recorder()
    // Typed parameter, not `async () => {}` — otherwise tsc infers a zero-length tuple for
    // mock.calls and the index below is a compile error.
    const beforeAttempt = vi.fn(async (_attempt: number) => {})

    await withRetry('u', { fetchImpl: impl, sleepImpl, beforeAttempt, random: () => 0.5 })

    expect(beforeAttempt).toHaveBeenCalledTimes(3)
    expect(beforeAttempt.mock.calls.map((c) => c[0])).toEqual([1, 2, 3])
  })

  it('reports each backoff through onRetry with a running total', async () => {
    const { impl } = fetcher([response(429), response(429), response(200)])
    const { sleepImpl } = recorder()
    const seen: Row[] = []

    await withRetry('u', { fetchImpl: impl, sleepImpl, random: () => 0.5, onRetry: (e: Row) => seen.push(e) })

    expect(seen.map((e) => [e.attempt, e.status, e.delayMs, e.totalWaitedMs])).toEqual([
      [1, 429, 2000, 2000],
      [2, 429, 4000, 6000],
    ])
  })

  /**
   * THE GREENSBORO LESSON, pinned. Eight straight empty responses there were genuine 200-with-[],
   * and treating them as rate-limiting would have been wrong. A 200 is returned untouched however
   * empty its body is — it is a real "no such place", and the caller caches it.
   */
  it('never retries a 200 carrying an empty result set', async () => {
    const { impl, calls } = fetcher([response(200, { body: [] })])
    const { slept, sleepImpl } = recorder()

    const res = await withRetry('u', { fetchImpl: impl, sleepImpl })

    expect(await res.json()).toEqual([])
    expect(calls).toHaveLength(1)
    expect(slept).toEqual([])
  })
})
