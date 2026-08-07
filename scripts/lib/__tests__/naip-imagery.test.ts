/**
 * NAIP fetch-layer invariants: bbox geometry, catalog-item selection, and the backoff floor.
 *
 * Every test here is network-free — `fetchImpl` / `sleepImpl` / `random` are injected, the same seam
 * geocode-retry.test.ts uses. `random: () => 0.5` makes the ±25% jitter multiplier exactly 1.0, so
 * the asserted delays are the raw exponential values.
 *
 * `naip-imagery.mjs` is plain ESM with no types, so tsc widens its exports to `object`. Typed
 * wrappers at the boundary keep `tsc --noEmit` green without loosening the gate.
 */
import { describe, expect, it } from 'vitest'
import {
  webMercator, cropBbox, chooseSize, sourceCatalogItems, acquisitionDate, summarizeIdentify,
  naipRetryDelayMs, fetchWithRetry, MAX_PIXELS, MIN_BACKOFF_MS,
} from '../naip-imagery.mjs'

type Row = Record<string, any>

const merc = webMercator as (lat: number, lng: number) => { x: number; y: number }
const bboxOf = cropBbox as (a: Row) => { bbox: string; sr: number }
const size = chooseSize as (a: Row) => number
const sources = sourceCatalogItems as (j: unknown) => Row[]
const acqDate = acquisitionDate as (ms: unknown) => string | null
const summarize = summarizeIdentify as (j: unknown) => Row
const retryDelay = naipRetryDelayMs as (a: Row) => number | null
const withRetry = fetchWithRetry as (url: unknown, opts?: Row) => Promise<Row>

const response = (status: number, { retryAfter = null as string | null, contentType = 'image/jpeg' } = {}): Row => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 429 ? 'Too Many Requests' : status === 500 ? 'Internal Server Error' : 'Error',
  headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? retryAfter : n.toLowerCase() === 'content-type' ? contentType : null) },
  text: async () => '',
  json: async () => ({}),
})

const fetcher = (queue: Row[]) => {
  const calls: Row[] = []
  return {
    calls,
    impl: async (url: unknown, opts: Row) => {
      calls.push({ url, opts })
      if (!queue.length) throw new Error('fetch stub exhausted — the retry loop asked for more attempts than the test queued')
      return queue.shift()!
    },
  }
}

const nums = (bbox: string) => bbox.split(',').map(Number)

describe('webMercator', () => {
  it('maps the origin to the origin and preserves longitude sign', () => {
    // `toBeCloseTo`, not `toEqual`: log(tan(PI/4)) is 0 only to within float error.
    expect(merc(0, 0).x).toBeCloseTo(0, 6)
    expect(merc(0, 0).y).toBeCloseTo(0, 6)
    expect(merc(0, -76).x).toBeLessThan(0)
    expect(merc(43, 0).y).toBeGreaterThan(0)
  })

  it('agrees with the value the live service reported for a known point', () => {
    // From an `identify` response at Manlius Village Centre Field (43.003299, -75.9852624):
    // location = { x: -8458640.718161277, y: 5312474.001865876 }, wkid 102100.
    const { x, y } = merc(43.003299, -75.9852624)
    expect(x).toBeCloseTo(-8458640.718, 2)
    expect(y).toBeCloseTo(5312474.002, 2)
  })
})

describe('cropBbox', () => {
  it('is square and centred on the venue', () => {
    const [xmin, ymin, xmax, ymax] = nums(bboxOf({ lat: 43, lng: -76, groundMeters: 400 }).bbox)
    const { x, y } = merc(43, -76)
    expect(xmax - xmin).toBeCloseTo(ymax - ymin, 6)
    expect((xmin + xmax) / 2).toBeCloseTo(x, 6)
    expect((ymin + ymax) / 2).toBeCloseTo(y, 6)
  })

  it('undoes Web Mercator scale so the GROUND extent is what was asked for', () => {
    // This is the regression that matters: without the /cos(lat) correction a 400 m request at
    // latitude 43 yields ~293 ground metres, and the error grows with latitude — worst exactly where
    // the northern metros are.
    const width = (lat: number) => {
      const [xmin, , xmax] = nums(bboxOf({ lat, lng: -76, groundMeters: 400 }).bbox)
      return (xmax - xmin) * Math.cos((lat * Math.PI) / 180) // projected -> ground metres
    }
    expect(width(43)).toBeCloseTo(400, 6)
    expect(width(25)).toBeCloseTo(400, 6)
    expect(width(48)).toBeCloseTo(400, 6)
  })

  it('requests the service native spatial reference', () => {
    expect(bboxOf({ lat: 43, lng: -76, groundMeters: 400 }).sr).toBe(3857)
  })
})

describe('chooseSize', () => {
  it('targets native NAIP resolution', () => {
    expect(size({ groundMeters: 400 })).toBe(667)
    expect(size({ groundMeters: 300, targetGsd: 0.6 })).toBe(500)
  })

  it('clamps to the service ceiling rather than issuing a request that 400s', () => {
    expect(size({ groundMeters: 100_000 })).toBe(MAX_PIXELS)
  })
})

describe('sourceCatalogItems', () => {
  // Shape taken verbatim from a live identify response: one Category 1 source raster plus three
  // Category 2 overviews whose every descriptive attribute is null.
  const live = {
    catalogItems: {
      features: [
        { attributes: { Category: 1, MinPS: 0, Name: 'm_4307557_sw_18_060_20190802', raster_name: 'm_4307557_sw_18_060_20190802', acquisition_date: 1564704000000, resolution_value: 0.6, resolution_units: 'METER', State: 'NY' } },
        { attributes: { Category: 2, MinPS: 19.1, Name: 'Ov_i02_L01_R0000016B_C00000076.tif', raster_name: null, acquisition_date: null, resolution_value: null, resolution_units: null, State: 'NY' } },
        { attributes: { Category: 2, MinPS: 38.2, Name: 'Ov_i02_L02_R000000B5_C0000003B.tif', raster_name: null, acquisition_date: null, resolution_value: null, resolution_units: null, State: 'NY' } },
      ],
    },
  }

  it('keeps only real source rasters, discarding pyramid overviews', () => {
    const items = sources(live)
    expect(items).toHaveLength(1)
    expect(items[0].raster_name).toBe('m_4307557_sw_18_060_20190802')
  })

  it('returns nothing rather than throwing when a point has no coverage', () => {
    expect(sources({ catalogItems: { features: [] } })).toEqual([])
    expect(sources({})).toEqual([])
    expect(sources(null)).toEqual([])
  })

  it('sorts multiple source tiles finest-resolution first', () => {
    const two = {
      catalogItems: {
        features: [
          { attributes: { Category: 1, MinPS: 5, acquisition_date: 1 } },
          { attributes: { Category: 1, MinPS: 0, acquisition_date: 2 } },
        ],
      },
    }
    expect(sources(two).map((a) => a.MinPS)).toEqual([0, 5])
  })
})

describe('acquisitionDate', () => {
  it('formats epoch milliseconds as a UTC calendar date', () => {
    expect(acqDate(1564704000000)).toBe('2019-08-02')
  })

  it('does NOT slide the date backwards through a local timezone', () => {
    // Midnight UTC formatted in US Pacific is the previous day. A flight date is a calendar fact
    // about a place, not a local instant, so the whole pipeline must stay in UTC.
    expect(acqDate(Date.UTC(2022, 5, 11))).toBe('2022-06-11')
  })

  it('returns null for anything unusable', () => {
    expect(acqDate(null)).toBeNull()
    expect(acqDate(undefined)).toBeNull()
    expect(acqDate('not a number')).toBeNull()
  })
})

describe('summarizeIdentify', () => {
  it('reports the NEWEST date where two flights cover one point, and lists both', () => {
    // Picking the newest is what makes the staleness claim survivable: "even the most recent flight
    // here predates the venue" holds whichever tile the mosaic actually drew from.
    const j = {
      catalogItems: {
        features: [
          { attributes: { Category: 1, MinPS: 0, acquisition_date: Date.UTC(2019, 7, 2), resolution_value: 0.6, resolution_units: 'METER', raster_name: 'old' } },
          { attributes: { Category: 1, MinPS: 0, acquisition_date: Date.UTC(2023, 4, 9), resolution_value: 0.6, resolution_units: 'METER', raster_name: 'new' } },
        ],
      },
    }
    const s = summarize(j)
    expect(s.date).toBe('2023-05-09')
    expect(s.dates).toEqual(['2019-08-02', '2023-05-09'])
    expect(s.tile).toBe('new')
  })

  it('reports a null date rather than a fabricated one when there is no coverage', () => {
    expect(summarize({ catalogItems: { features: [] } })).toEqual({ date: null, dates: [], gsd: null, gsdUnits: null, tile: null, state: null })
  })

  it('would report null if it read features[0] blindly — so it must not', () => {
    // Overview first, source second. `features[0].acquisition_date` is null here.
    const j = {
      catalogItems: {
        features: [
          { attributes: { Category: 2, MinPS: 19.1, acquisition_date: null } },
          { attributes: { Category: 1, MinPS: 0, acquisition_date: Date.UTC(2021, 6, 14), resolution_value: 0.6 } },
        ],
      },
    }
    expect(summarize(j).date).toBe('2021-07-14')
  })
})

describe('naipRetryDelayMs', () => {
  it('retries the come-back-later statuses', () => {
    for (const status of [429, 502, 503, 504]) {
      expect(retryDelay({ status, attempt: 1, random: () => 0.5 })).toBe(2000)
    }
  })

  it('does NOT retry a 500 — ArcGIS answers a malformed request that way', () => {
    expect(retryDelay({ status: 500, attempt: 1 })).toBeNull()
    expect(retryDelay({ status: 400, attempt: 1 })).toBeNull()
    expect(retryDelay({ status: 404, attempt: 1 })).toBeNull()
  })

  it('climbs exponentially and then stops', () => {
    const r = { random: () => 0.5, status: 429 }
    expect(retryDelay({ ...r, attempt: 1 })).toBe(2000)
    expect(retryDelay({ ...r, attempt: 2 })).toBe(4000)
    expect(retryDelay({ ...r, attempt: 3 })).toBe(8000)
    expect(retryDelay({ ...r, attempt: 4 })).toBe(16_000)
    expect(retryDelay({ ...r, attempt: 5 })).toBeNull()
  })

  it('NEVER returns a delay below the floor, whatever the header says', () => {
    // The Nominatim bug, one class wider. `Retry-After: 0` is already rejected upstream by
    // parseRetryAfter; the floor is what stops a server talking us into an effectively-immediate
    // retry by any other route.
    expect(retryDelay({ status: 429, retryAfterHeader: '0', attempt: 1, random: () => 0.5 })).toBe(2000)
    expect(retryDelay({ status: 429, retryAfterHeader: '-1000', attempt: 1, random: () => 0.5 })).toBe(2000)
    const delays = [1, 2, 3, 4].map((attempt) => retryDelay({ status: 429, attempt, random: () => 0 }))
    for (const d of delays) expect(d).toBeGreaterThanOrEqual(MIN_BACKOFF_MS)
  })

  it('honours a usable Retry-After', () => {
    expect(retryDelay({ status: 503, retryAfterHeader: '7', attempt: 1 })).toBe(7000)
  })
})

describe('fetchWithRetry', () => {
  it('backs off and succeeds', async () => {
    const { impl, calls } = fetcher([response(429, { retryAfter: '0' }), response(200)])
    const slept: number[] = []
    const res = await withRetry('https://example.test/x', {
      fetchImpl: impl, sleepImpl: async (ms: number) => void slept.push(ms), random: () => 0.5,
    })
    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(2)
    // The header said 0; we waited the full ladder step anyway.
    expect(slept).toEqual([2000])
  })

  it('distinguishes a spent retry budget from a genuine error', async () => {
    const { impl } = fetcher([response(503), response(503), response(503), response(503), response(503)])
    await expect(withRetry('https://example.test/x', {
      fetchImpl: impl, sleepImpl: async () => {}, random: () => 0.5,
    })).rejects.toThrow(/gave up after 5 attempt\(s\)/)

    const hard = fetcher([response(400)])
    await expect(withRetry('https://example.test/x', {
      fetchImpl: hard.impl, sleepImpl: async () => {},
    })).rejects.toThrow(/NAIP HTTP 400/)
    expect(hard.calls).toHaveLength(1)
  })

  it('runs beforeAttempt on retries too, so the courtesy spacing covers every real request', async () => {
    const { impl } = fetcher([response(429), response(429), response(200)])
    let attempts = 0
    await withRetry('https://example.test/x', {
      fetchImpl: impl, sleepImpl: async () => {}, random: () => 0.5, beforeAttempt: async () => { attempts++ },
    })
    expect(attempts).toBe(3)
  })
})
