import { describe, it, expect } from 'vitest'
import { mapsUrl, type MapsUrlInput } from '../mapsUrl'

// Relative import, not '@/': there is no alias config for vitest, so a runtime '@/' import would
// fail here (type-only ones are erased and therefore fine — see lib/utils/__tests__).

const SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query='

/** A row with everything present; each test overrides only what it is about. */
function row(overrides: Partial<MapsUrlInput> = {}): MapsUrlInput {
  return {
    name: 'Copper Sky Regional Park',
    address: '44345 W Martin Rd',
    city: 'Maricopa',
    state: 'AZ',
    zip: '85138',
    lat: 33.039187,
    lng: -112.044266,
    google_place_id: 'ChIJgTioOAf7KocRyIkBta-J3Yc',
    ...overrides,
  }
}

describe('mapsUrl — rung 1: place_id present', () => {
  it('pins by place_id and keeps the coordinate as the query', () => {
    expect(mapsUrl(row())).toBe(
      `${SEARCH_BASE}33.039187,-112.044266&query_place_id=ChIJgTioOAf7KocRyIkBta-J3Yc`
    )
  })

  it('wins over an address when both are present', () => {
    const url = mapsUrl(row())!
    expect(url).toContain('query_place_id=')
    expect(url).not.toContain('Copper%20Sky')
  })

  it('url-encodes the place_id', () => {
    expect(mapsUrl(row({ google_place_id: 'abc/def+ghi' }))).toContain(
      'query_place_id=abc%2Fdef%2Bghi'
    )
  })

  it('treats a blank place_id as absent and falls through to the address rung', () => {
    const url = mapsUrl(row({ google_place_id: '   ' }))!
    expect(url).not.toContain('query_place_id')
    expect(url).toContain('Copper%20Sky')
  })
})

describe('mapsUrl — rung 2: no place_id, address present', () => {
  it('builds "<name>, <address>, <city>, <state> <zip>"', () => {
    const url = mapsUrl(row({ google_place_id: null }))!
    expect(decodeURIComponent(url.slice(SEARCH_BASE.length))).toBe(
      'Copper Sky Regional Park, 44345 W Martin Rd, Maricopa, AZ 85138'
    )
  })

  it('never emits a raw coordinate query on this rung', () => {
    const url = mapsUrl(row({ google_place_id: null }))!
    expect(url).not.toContain('33.039187,-112.044266')
  })

  it('omits the zip cleanly when absent — no dangling separator', () => {
    // 18 of the 53 affected rows have a null zip, so this is the common shape, not an edge case.
    const url = mapsUrl(row({ google_place_id: null, zip: null }))!
    expect(decodeURIComponent(url.slice(SEARCH_BASE.length))).toBe(
      'Copper Sky Regional Park, 44345 W Martin Rd, Maricopa, AZ'
    )
  })

  it('encodes an ampersand in the venue name', () => {
    // The real Daytona row that surfaced this defect.
    const url = mapsUrl(
      row({
        google_place_id: null,
        name: 'Cherry Cultural & Educational Center',
        address: '925 George W. Engram Blvd',
        city: 'Daytona Beach',
        state: 'FL',
        zip: '32114',
        lat: 29.21132,
        lng: -81.04165,
      })
    )!
    // Encoded, so the '&' cannot split the query param — the URL has exactly one '&' (api=1).
    expect(url).toContain('%26')
    expect(url.split('&')).toHaveLength(2)
    expect(decodeURIComponent(url.slice(SEARCH_BASE.length))).toBe(
      'Cherry Cultural & Educational Center, 925 George W. Engram Blvd, Daytona Beach, FL 32114'
    )
  })

  it('treats a whitespace-only address as absent', () => {
    expect(mapsUrl(row({ google_place_id: null, address: '  ' }))).toBe(
      `${SEARCH_BASE}33.039187,-112.044266`
    )
  })
})

describe('mapsUrl — rung 3: no place_id, no address', () => {
  it('falls back to the raw coordinate', () => {
    expect(mapsUrl(row({ google_place_id: null, address: null }))).toBe(
      `${SEARCH_BASE}33.039187,-112.044266`
    )
  })

  it('does NOT text-search the name+city+state (verified to mis-resolve ~1.8km)', () => {
    // Guards the deliberate decision documented in mapsUrl.ts. `Asante, Surprise, AZ` resolves to
    // the neighborhood centroid, not the courts — a confident wrong answer is worse than an
    // unnamed pin at the right spot.
    const url = mapsUrl(
      row({
        google_place_id: null,
        address: null,
        name: 'Asante',
        city: 'Surprise',
        state: 'AZ',
        zip: null,
        lat: 33.701312,
        lng: -112.402054,
      })
    )!
    expect(url).toBe(`${SEARCH_BASE}33.701312,-112.402054`)
    expect(url).not.toContain('Asante')
  })

  it('never emits the "(Label)" form, which drops the coordinate entirely', () => {
    // `33.701312,-112.402054 (Asante Pickleball Courts)` resolved to a venue in Henderson, NV.
    const url = mapsUrl(row({ google_place_id: null, address: null }))!
    expect(url).not.toContain('(')
    expect(url).not.toContain('%28')
  })
})

describe('mapsUrl — no coordinate', () => {
  it.each([
    ['lat null', { lat: null }],
    ['lng null', { lng: null }],
    ['both null', { lat: null, lng: null }],
  ])('returns null when %s, even with a place_id', (_label, override) => {
    expect(mapsUrl(row(override as Partial<MapsUrlInput>))).toBeNull()
  })

  it('returns null when the coordinate is missing but an address exists', () => {
    expect(mapsUrl(row({ lat: null, lng: null, google_place_id: null }))).toBeNull()
  })
})
