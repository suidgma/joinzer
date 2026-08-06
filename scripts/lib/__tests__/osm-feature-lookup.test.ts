import { describe, it, expect } from 'vitest'
// Relative import, not '@/' — vitest has no alias config in this repo.
import { osmIdToLookupParam, lookupOsmFeature } from '../geocode-nominatim.mjs'

type Hit = Record<string, any>
const lookup = (osmId: unknown, opts: Record<string, unknown>) =>
  lookupOsmFeature(osmId as string, opts as any) as Promise<Record<string, any> | null>

/**
 * The VERBATIM `/lookup` response for way/1165951096, captured from the live endpoint on
 * 2026-08-06. Kept byte-faithful rather than hand-simplified: the whole point of this fixture is
 * that the shape the endpoint actually returns classifies correctly through the untouched
 * classifier. A tidied fixture would test the tidying.
 */
const CENTRAL_WINDS: Hit = {
  place_id: 302082515,
  licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
  osm_type: 'way',
  osm_id: 1165951096,
  lat: '28.7075117',
  lon: '-81.2750142',
  category: 'leisure',
  type: 'pitch',
  place_rank: 30,
  addresstype: 'leisure',
  name: 'Central Winds Pickleball Courts',
  display_name: 'Central Winds Pickleball Courts, 1000, Hicks Avenue;Oviedo Road, Winter Springs, Seminole County, Florida, 32708, United States',
  address: {
    leisure: 'Central Winds Pickleball Courts',
    house_number: '1000',
    road: 'Hicks Avenue;Oviedo Road',
    town: 'Winter Springs',
    county: 'Seminole County',
    state: 'Florida',
    postcode: '32708',
    country: 'United States',
    country_code: 'us',
  },
  namedetails: { name: 'Central Winds Pickleball Courts' },
}

const VENUE_NAME = 'AdventHealth Pickleball Complex at Central Winds Park'

/** A fetch stub. Never touches the network; asserts the URL the module actually builds. */
function stubFetch(payload: unknown, seen: string[] = []) {
  return async (url: URL | string) => {
    seen.push(String(url))
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as any
  }
}

/** A cache path under the OS temp dir, so no test ever writes into metro-research/. */
const tmpCache = (n: string) => `${process.env.TEMP || '/tmp'}/joinzer-lookup-test-${n}-${process.pid}.json`

describe('osmIdToLookupParam', () => {
  it('converts each of the three OSM feature types', () => {
    expect(osmIdToLookupParam('way/1165951096')).toBe('W1165951096')
    expect(osmIdToLookupParam('node/13027774185')).toBe('N13027774185')
    expect(osmIdToLookupParam('relation/12345')).toBe('R12345')
  })

  it('tolerates surrounding whitespace but nothing else', () => {
    expect(osmIdToLookupParam('  way/1165951096  ')).toBe('W1165951096')
  })

  // REJECT BY FORM, not by best effort. Each of these would otherwise reach the endpoint and come
  // back empty, which is indistinguishable from "OSM does not carry this feature" — and the caller's
  // honest response to that is to give up on a coordinate that was in fact perfectly findable.
  it.each([
    ['a bare number with no type', '1165951096'],
    ['a non-numeric id', 'way/abc'],
    ['an unknown feature type', 'path/123'],
    ['the /lookup wire form, which is not the stored form', 'W1165951096'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a trailing segment', 'way/123/extra'],
    ['a negative id', 'way/-123'],
  ])('rejects %s', (_label, input) => {
    expect(() => osmIdToLookupParam(input as string)).toThrow(/not a valid OSM feature id/)
  })
})

describe('lookupOsmFeature', () => {
  it('classifies the real Central Winds response as high through the untouched classifier', async () => {
    const seen: string[] = []
    const hit = await lookup('way/1165951096', {
      venueName: VENUE_NAME,
      wantHouseNumber: '1000',
      cachePath: tmpCache('high'),
      fetchImpl: stubFetch([CENTRAL_WINDS], seen),
    })

    // `high` is EARNED here, not asserted anywhere in the adoption path: house number 1000 == 1000,
    // and nameOverlap ties {central, winds} across both names. If this ever comes back `medium` the
    // classifier changed, and the ADR-16 label on every adopted row changes with it.
    expect(hit!.precision).toBe('high')
    expect(hit!.lat).toBeCloseTo(28.7075117, 7)
    expect(hit!.lng).toBeCloseTo(-81.2750142, 7)
    expect(hit!.origin).toBe('nominatim')
    expect(hit!.matched_rung).toBe('osm-feature-lookup')
    expect(hit!.osm_id).toBe('way/1165951096')
    expect(hit!.matched_name).toBe('Central Winds Pickleball Courts')
    expect(hit!.licence).toMatch(/ODbL 1\.0/)
    expect(hit!.anchor).toContain('leisure/pitch')
    expect(hit!.anchor).toContain('osm-feature-lookup')
  })

  it('calls the /lookup endpoint with the converted id and no limit param', async () => {
    const seen: string[] = []
    await lookup('way/1165951096', {
      venueName: VENUE_NAME,
      cachePath: tmpCache('url'),
      fetchImpl: stubFetch([CENTRAL_WINDS], seen),
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('/lookup')
    expect(seen[0]).toContain('osm_ids=W1165951096')
    // `limit` is meaningless to /lookup. Its absence also keeps the two endpoints' param sets
    // disjoint, which is what makes the shared cache collision-free by construction.
    expect(seen[0]).not.toContain('limit=')
  })

  it('returns null when OSM does not carry the feature', async () => {
    const hit = await lookup('way/999999999999', {
      venueName: VENUE_NAME,
      cachePath: tmpCache('empty'),
      fetchImpl: stubFetch([]),
    })
    expect(hit).toBeNull()
  })

  // Asked for one id, handed two features: the endpoint's contract was violated or the request was
  // malformed. Picking one would be inventing an adjudication nobody made.
  it('throws rather than choosing when more than one feature comes back', async () => {
    await expect(lookup('way/1165951096', {
      venueName: VENUE_NAME,
      cachePath: tmpCache('multi'),
      fetchImpl: stubFetch([CENTRAL_WINDS, { ...CENTRAL_WINDS, osm_id: 999 }]),
    })).rejects.toThrow(/returned 2 features for the single id/)
  })

  // The Gulf-of-Guinea trap: Number(null) === 0, so a null-coordinate hit would otherwise read as
  // the point (0,0) and be adopted as a real coordinate. coordOf treats it as NaN; this pins that.
  it('throws on a feature with no usable coordinate rather than adopting (0,0)', async () => {
    await expect(lookup('way/1165951096', {
      venueName: VENUE_NAME,
      cachePath: tmpCache('nocoord'),
      fetchImpl: stubFetch([{ ...CENTRAL_WINDS, lat: null, lon: null }]),
    })).rejects.toThrow(/no usable coordinate/)
  })

  // A street-shaped feature must NOT come back high just because it was adjudicated. Precision is
  // classified, so an adoption cannot smuggle a street band past the ADR-16 approximate label.
  it('still classifies a road as low, so adoption cannot fake precision', async () => {
    const road: Hit = {
      licence: CENTRAL_WINDS.licence,
      osm_type: 'way',
      osm_id: 645260772,
      lat: '28.7073709',
      lon: '-81.2708528',
      category: 'highway',
      type: 'residential',
      name: 'Central Winds Parkway',
      namedetails: { name: 'Central Winds Parkway' },
      address: { road: 'Central Winds Parkway', town: 'Winter Springs' },
    }
    const hit = await lookup('way/645260772', {
      venueName: VENUE_NAME,
      wantHouseNumber: '1000',
      cachePath: tmpCache('road'),
      fetchImpl: stubFetch([road]),
    })
    expect(hit!.precision).toBe('low')
  })
})
