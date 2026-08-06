/**
 * The row this module writes carries three invariants that nothing else in the codebase enforces.
 * `verified_by` is the important one: scripts/publish-facilities.mjs publishes eligible drafts on
 * its own, and `passesReleaseFence` is literally `row.verified_by != null`. A user-submitted venue
 * otherwise passes the ADR-17 gate, so a regression that stamps that column would silently push
 * crowd-sourced rows onto /courts.
 */
import { describe, expect, it, vi } from 'vitest'
import { createFacilityListing, USER_SUBMISSION_SOURCE } from '../createFacilityListing'
import { coerceVenueDetail } from '../submissionFields'

type Inserted = Record<string, any>

/**
 * Minimal Supabase double. `takenSlugs` seeds the collision scan; `failInsertsWith` makes the
 * first N inserts fail with a code, which is how the race path is exercised.
 */
function fakeDb(options: { takenSlugs?: string[]; failInsertsWith?: string[] } = {}) {
  const taken = options.takenSlugs ?? []
  const failures = [...(options.failInsertsWith ?? [])]
  const inserts: Inserted[] = []

  const db = {
    inserts,
    from(table: string) {
      if (table !== 'facility_listings') throw new Error(`unexpected table ${table}`)
      return {
        // slug availability scan
        select: (cols: string) => ({
          like: (_col: string, pattern: string) => {
            const prefix = pattern.replace(/%$/, '').replace(/\\(.)/g, '$1')
            return Promise.resolve({
              data: taken.filter((s) => s.startsWith(prefix)).map((slug) => ({ slug })),
              error: null,
            })
          },
        }),
        insert: (row: Inserted) => ({
          select: () => ({
            single: () => {
              const failure = failures.shift()
              if (failure) return Promise.resolve({ data: null, error: { code: failure, message: failure } })
              inserts.push(row)
              taken.push(row.slug)
              return Promise.resolve({ data: { id: `id-${inserts.length}`, slug: row.slug }, error: null })
            },
          }),
        }),
      }
    },
  }
  return db as any
}

const VENUE = {
  name: 'Sunrise Community Courts',
  address: '123 Main St',
  city: 'Henderson',
  state: 'NV',
  zip_code: '89052',
  country: 'US',
  google_place_id: 'ChIJexample',
  coordinateSource: 'google_geocoding' as const,
  lat: 36.0,
  lng: -115.0,
}

const EMPTY_DETAIL = coerceVenueDetail({}).detail

describe('the release fence', () => {
  it('NEVER sets verified_by', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0]).not.toHaveProperty('verified_by')
  })

  it('leaves metro_area NULL so metro-scoped publish runs cannot see the row', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].metro_area).toBeNull()
  })

  it('writes status draft', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].status).toBe('draft')
  })

  it("writes verification_status 'unverified' and nothing stronger", async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].verification_status).toBe('unverified')
    for (const forbidden of ['source_verified', 'listed', 'human_verified']) {
      expect(db.inserts[0].verification_status).not.toBe(forbidden)
    }
  })
})

describe('provenance and ADR-12 address source', () => {
  it("stamps address_source 'organizer' when there is an address", async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].address_source).toBe('organizer')
    expect(db.inserts[0].address_verified_at).toBeTruthy()
  })

  it('leaves address_source NULL when no address was given', async () => {
    const db = fakeDb()
    await createFacilityListing(db, { ...VENUE, address: null }, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].address_source).toBeNull()
    expect(db.inserts[0].address_verified_at).toBeNull()
  })

  it('records who submitted it and the place_id in provenance', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-42')
    expect(db.inserts[0].provenance.user_submission.submitted_by).toBe('user-42')
    expect(db.inserts[0].provenance.user_submission.place_id).toBe('ChIJexample')
  })

  it('omits the coordinate node entirely when there is no coordinate', async () => {
    // location_precision is GENERATED from provenance.coordinate.precision. NULL there means "no
    // coordinate node", which the publish gate treats differently from 'low'.
    const db = fakeDb()
    const { lat, lng, ...noCoords } = VENUE
    await createFacilityListing(
      db,
      { ...noCoords, coordinateSource: null },
      EMPTY_DETAIL,
      'user-1'
    )
    expect(db.inserts[0].provenance).not.toHaveProperty('coordinate')
    expect(db.inserts[0]).not.toHaveProperty('lat')
  })

  it('tags the batch so the write is rollback-able and not mislabelled as OSM', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].source).toBe(USER_SUBMISSION_SOURCE)
  })
})

describe('slug derivation and collisions', () => {
  it('uses the directory convention <name>-<city>-<state>', async () => {
    const db = fakeDb()
    const out = await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(out.slug).toBe('sunrise-community-courts-henderson-nv')
  })

  it('suffixes when the base is taken', async () => {
    const db = fakeDb({ takenSlugs: ['sunrise-community-courts-henderson-nv'] })
    const out = await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(out.slug).toBe('sunrise-community-courts-henderson-nv-2')
  })

  it('retries on a unique violation and takes the next rung', async () => {
    // The race: two submissions read the same free slug, one wins, the loser must recover.
    const db = fakeDb({
      takenSlugs: ['sunrise-community-courts-henderson-nv'],
      failInsertsWith: ['23505'],
    })
    const out = await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(out.slug).toMatch(/^sunrise-community-courts-henderson-nv-\d+$/)
  })

  it('falls back to a random tail when the retry also races', async () => {
    const db = fakeDb({ failInsertsWith: ['23505', '23505'] })
    const out = await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(out.slug).toMatch(/^sunrise-community-courts-henderson-nv-[a-z0-9]{8}$/)
  })

  it('throws on a non-unique-violation insert error rather than looping', async () => {
    const db = fakeDb({ failInsertsWith: ['23502'] })
    await expect(createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')).rejects.toThrow(
      /insert failed/
    )
  })

  it('throws rather than treating a failed slug read as "nothing is taken"', async () => {
    const db = {
      from: () => ({
        select: () => ({
          like: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }),
        }),
      }),
    } as any
    await expect(createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')).rejects.toThrow(
      /slug availability read failed/
    )
  })

  it('resolves & in a venue name to "and", matching every published row', async () => {
    const db = fakeDb()
    const out = await createFacilityListing(
      db,
      { ...VENUE, name: 'Parks & Rec Center' },
      EMPTY_DETAIL,
      'user-1'
    )
    expect(out.slug).toBe('parks-and-rec-center-henderson-nv')
  })
})

describe('country and state normalization', () => {
  // The bug this prevents: facility_listings_country_chk is char_length(country) = 2, the Country
  // input carries autoComplete="country-name", and a browser autofills it with "United States".
  // That raises 23514 — NOT 23505 — so insertWithSlugRetry does not retry, the route's catch saves
  // the location with a NULL bridge, and every optional field the user filled in is gone with no
  // error shown to them.
  it('coerces an autofilled country name to a 2-letter code', async () => {
    const db = fakeDb()
    await createFacilityListing(db, { ...VENUE, country: 'United States' }, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].country).toBe('US')
  })

  it('never writes a country value that would violate the CHECK', async () => {
    for (const input of ['United States', 'USA', 'U.S.', 'Canada', 'Freedonia', '', null]) {
      const db = fakeDb()
      await createFacilityListing(db, { ...VENUE, country: input as any }, EMPTY_DETAIL, 'user-1')
      const written = db.inserts[0].country
      expect(written === null || String(written).length === 2, `${input} -> ${written}`).toBe(true)
    }
  })

  it('coerces a full state name to its code, in the column AND the slug', async () => {
    const db = fakeDb()
    const out = await createFacilityListing(db, { ...VENUE, state: 'Nevada' }, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].state).toBe('NV')
    // The slug is the half that would silently split the namespace against 2,365 live rows.
    expect(out.slug).toBe('sunrise-community-courts-henderson-nv')
    expect(out.slug).not.toContain('nevada')
  })

  it('drops an unmappable state rather than minting a divergent slug', async () => {
    const db = fakeDb()
    const out = await createFacilityListing(db, { ...VENUE, state: 'Ontario' }, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].state).toBeNull()
    expect(out.slug).toBe('sunrise-community-courts-henderson')
    expect(out.slug).not.toContain('ontario')
  })

  it('leaves an already-correct 2-letter state untouched', async () => {
    const db = fakeDb()
    const out = await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0].state).toBe('NV')
    expect(out.slug).toBe('sunrise-community-courts-henderson-nv')
  })
})

describe('optional detail', () => {
  it('omits access_type when skipped so the column default applies', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    expect(db.inserts[0]).not.toHaveProperty('access_type')
  })

  it('writes access_type when the user answered', async () => {
    const db = fakeDb()
    const { detail } = coerceVenueDetail({ access_type: 'hoa' })
    await createFacilityListing(db, VENUE, detail, 'user-1')
    expect(db.inserts[0].access_type).toBe('hoa')
  })

  it('writes explicit NULLs for every other unanswered field', async () => {
    const db = fakeDb()
    await createFacilityListing(db, VENUE, EMPTY_DETAIL, 'user-1')
    for (const key of ['fee_type', 'surface', 'restrooms', 'parking', 'public_notes']) {
      expect(db.inserts[0][key], key).toBeNull()
    }
  })

  it('carries answered detail through onto the row', async () => {
    const db = fakeDb()
    const { detail } = coerceVenueDetail({
      court_count: 8,
      surface: 'concrete',
      restrooms: 'yes',
      lighting: 'no',
      website: 'example.com',
    })
    await createFacilityListing(db, VENUE, detail, 'user-1')
    expect(db.inserts[0].court_count).toBe(8)
    expect(db.inserts[0].surface).toBe('concrete')
    expect(db.inserts[0].restrooms).toBe(true)
    expect(db.inserts[0].lighting).toBe(false)
    expect(db.inserts[0].website).toBe('https://example.com/')
  })
})
