import { describe, it, expect } from 'vitest'
// Relative import, not '@/' — vitest has no alias config in this repo, and an aliased runtime
// import fails to resolve (see lib/email/unsubscribe.ts's own comment for the same constraint).
import {
  mergeOntoTarget,
  isAbsent,
  PRESERVE_ON_RECONCILE,
  RECONCILE_TARGET_COLUMNS,
  preservedSummary,
} from '../reconcile-merge.mjs'

const NOW = '2026-07-31T21:00:00.000Z'
const REC = { osm_id: 'node/3249667564', listing_id: '2d9aa2ad-11c2-4591-8139-dffe2d9f1f40' }

// reconcile-merge.mjs is plain ESM with no .d.ts, so tsc widens its return to `object`. Typing the
// boundary here keeps `tsc --noEmit` green without adding a build step or weakening the gate.
type Row = Record<string, any>
const merge = (inc: Row, tgt: Row | null) =>
  mergeOntoTarget(inc, tgt, REC, NOW) as { fields: Row; preserved: Row; targetSeen: boolean }

// A minimal listingFields()-shaped object. Only the keys a given test cares about need real values.
const incoming = (over: Record<string, unknown> = {}) => ({
  name: 'Erie Canal Pickleball Center',
  slug: 'erie-canal-pickleball-center-dewitt-ny',
  source: 'syracuse-2026-07-31',
  status: 'draft',
  lat: 43.0551638,
  lng: -76.0746923,
  address: null,
  address_source: 'official_page',
  address_verified_at: null,
  city: 'DeWitt',
  state: 'NY',
  zip: null,
  country: 'US',
  metro_area: 'Syracuse',
  court_count: 9,
  access_type: 'public',
  fee_type: null,
  reservation_policy: null,
  reservation_url: null,
  indoor: true,
  lighting: null,
  surface: null,
  court_configuration: null,
  line_type: null,
  net_setup: null,
  website: 'https://www.eriecanalpickleball.com/',
  phone: null,
  public_notes: null,
  google_place_id: null,
  name_source_url: 'https://www.eriecanalpickleball.com/',
  verification_status: 'source_verified',
  verified_at: null,
  verified_by: null,
  enrichment: null,
  enriched_at: null,
  enrichment_version: null,
  location_id: null,
  provenance: { odbl: 'Coordinate is OSM-derived via Nominatim (ODbL 1.0).', osm_reconcile: { osm_id: REC.osm_id } },
  ...over,
})

const target = (over: Record<string, unknown> = {}) => ({
  id: REC.listing_id,
  osm_id: REC.osm_id,
  status: 'draft',
  name: 'Erie Canal Pickleball Center',
  slug: 'erie-canal-pickleball-center-syracuse-ny',
  access_type: 'unknown',
  address: '3179 Erie Boulevard East',
  address_source: null,
  address_verified_at: null,
  city: 'Syracuse',
  state: 'NY',
  zip: '13214',
  court_count: null,
  fee_type: null,
  reservation_policy: null,
  reservation_url: null,
  indoor: null,
  lighting: null,
  surface: null,
  court_configuration: null,
  line_type: null,
  net_setup: null,
  website: null,
  phone: null,
  public_notes: null,
  google_place_id: null,
  location_id: null,
  ...over,
})

describe('isAbsent', () => {
  it('treats null, undefined and empty string as absent', () => {
    expect(isAbsent(null)).toBe(true)
    expect(isAbsent(undefined)).toBe(true)
    expect(isAbsent('')).toBe(true)
  })

  // The whole point. `false` and `0` are researched facts, not gaps.
  it('does NOT treat false or 0 as absent', () => {
    expect(isAbsent(false)).toBe(false)
    expect(isAbsent(0)).toBe(false)
  })
})

describe('mergeOntoTarget — the Syracuse case', () => {
  it('keeps the target address and zip when the research row has neither', () => {
    const { fields, preserved } = merge(incoming(), target())
    expect(fields.address).toBe('3179 Erie Boulevard East')
    expect(fields.zip).toBe('13214')
    expect(Object.keys(preserved).sort()).toEqual(['address', 'zip'])
    expect(preserved.address.origin).toBe('osm_listing')
    expect(preserved.address.osm_id).toBe(REC.osm_id)
    expect(preserved.address.preserved_at).toBe(NOW)
  })

  it('lets the research row win where it HAS a value — city is corrected, not preserved', () => {
    const { fields, preserved } = merge(incoming(), target())
    expect(fields.city).toBe('DeWitt')          // research row corrects Syracuse -> DeWitt
    expect(preserved.city).toBeUndefined()
  })
})

describe('mergeOntoTarget — ADR-12 address provenance', () => {
  it('forces address_source to osm on a preserved address, overriding the research value', () => {
    const { fields } = merge(incoming({ address_source: 'official_page' }), target())
    expect(fields.address_source).toBe('osm')
  })

  it('does NOT stamp address_verified_at for an address it did not verify', () => {
    const { fields } = merge(incoming(), target({ address_verified_at: null }))
    expect(fields.address_verified_at).toBeNull()
  })

  it('carries the target address_verified_at through when the target has one', () => {
    const stamped = '2026-01-02T03:04:05.000Z'
    const { fields } = merge(incoming(), target({ address_verified_at: stamped }))
    expect(fields.address_verified_at).toBe(stamped)
  })

  it('leaves the research address_source alone when the address was NOT preserved', () => {
    const { fields, preserved } = merge(
      incoming({ address: '100 Research St', address_source: 'official_page' }), target())
    expect(fields.address).toBe('100 Research St')
    expect(fields.address_source).toBe('official_page')
    expect(preserved.address).toBeUndefined()
  })

  it('extends the ODbL marker only when an OSM address rides along', () => {
    const kept = merge(incoming(), target())
    expect(kept.fields.provenance.odbl).toMatch(/ADDRESS on this row is ALSO OSM-derived/)
    const notKept = merge(incoming({ address: '100 Research St' }), target())
    expect(notKept.fields.provenance.odbl).not.toMatch(/ADDRESS on this row is ALSO OSM-derived/)
  })
})

describe('mergeOntoTarget — booleans must not be corrupted', () => {
  // A researched `false` losing to a target `true` would be invisible to every count and split
  // table in the importer. This is the test to keep.
  it('keeps a researched indoor:false instead of the target true', () => {
    const { fields, preserved } = merge(
      incoming({ indoor: false }), target({ indoor: true }))
    expect(fields.indoor).toBe(false)
    expect(preserved.indoor).toBeUndefined()
  })

  it('keeps a researched lighting:false instead of the target true', () => {
    const { fields, preserved } = merge(
      incoming({ lighting: false }), target({ lighting: true }))
    expect(fields.lighting).toBe(false)
    expect(preserved.lighting).toBeUndefined()
  })

  it('preserves a target boolean when the research row is silent', () => {
    const { fields, preserved } = merge(
      incoming({ lighting: null }), target({ lighting: true }))
    expect(fields.lighting).toBe(true)
    expect(preserved.lighting.value).toBe(true)
  })

  it('preserves a target false — false is a fact, not a gap', () => {
    const { fields, preserved } = merge(
      incoming({ indoor: null }), target({ indoor: false }))
    expect(fields.indoor).toBe(false)
    expect(preserved.indoor.value).toBe(false)
  })
})

describe('mergeOntoTarget — fields that must keep overwriting', () => {
  it('never preserves access_type, even when the target holds a value and the incoming is unknown', () => {
    // listingFields coerces a null access_type to 'unknown', so this is the real worst case:
    // an incoming 'unknown' against a populated target. It must still overwrite.
    const { fields, preserved } = merge(
      incoming({ access_type: 'unknown' }), target({ access_type: 'membership' }))
    expect(fields.access_type).toBe('unknown')
    expect(preserved.access_type).toBeUndefined()
  })

  it('is structurally incapable of preserving reconcile-controlled fields', () => {
    for (const f of ['access_type', 'name', 'slug', 'source', 'status', 'metro_area',
      'verification_status', 'verified_at', 'verified_by', 'enrichment', 'enriched_at',
      'enrichment_version', 'lat', 'lng', 'country', 'name_source_url', 'provenance']) {
      expect(PRESERVE_ON_RECONCILE).not.toContain(f)
    }
  })

  it('does not overwrite name, slug, source or status from the target', () => {
    const { fields } = merge(incoming(), target())
    expect(fields.name).toBe('Erie Canal Pickleball Center')
    expect(fields.slug).toBe('erie-canal-pickleball-center-dewitt-ny')   // NOT the target's -syracuse- slug
    expect(fields.source).toBe('syracuse-2026-07-31')
    expect(fields.status).toBe('draft')
  })
})

describe('mergeOntoTarget — the two latent hardcoded nulls', () => {
  it('preserves reservation_url, which listingFields hardcodes to null', () => {
    const { fields, preserved } = merge(
      incoming(), target({ reservation_url: 'https://book.example/courts' }))
    expect(fields.reservation_url).toBe('https://book.example/courts')
    expect(preserved.reservation_url.value).toBe('https://book.example/courts')
  })

  it('preserves location_id, the ADR-13 bridge to the operational locations table', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    const { fields, preserved } = merge(incoming(), target({ location_id: id }))
    expect(fields.location_id).toBe(id)
    expect(preserved.location_id.value).toBe(id)
  })
})

describe('mergeOntoTarget — the record it leaves', () => {
  it('always writes preserved_fields, even when nothing was kept', () => {
    // "merge ran and kept nothing" must be distinguishable from "merge never ran".
    const nothingToKeep = target({ address: null, zip: null, city: null, state: null })
    const { preserved, fields } = merge(incoming(), nothingToKeep)
    expect(preserved).toEqual({})
    expect(fields.provenance.osm_reconcile.preserved_fields).toEqual({})
    expect(fields.provenance.osm_reconcile.merge_policy).toBe('incoming_wins_unless_null')
  })

  it('reports targetSeen:false and changes nothing when there is no target', () => {
    const inc = incoming()
    const { fields, preserved, targetSeen } = merge(inc, null)
    expect(targetSeen).toBe(false)
    expect(preserved).toEqual({})
    expect(fields.address).toBeNull()
  })

  it('does not mutate the object it was handed', () => {
    const inc = incoming()
    merge(inc, target())
    expect(inc.address).toBeNull()
    expect(inc.zip).toBeNull()
  })

  it('treats an empty string on the incoming row as absent', () => {
    const { fields, preserved } = merge(incoming({ website: '' }), target({ website: 'https://x.example' }))
    expect(fields.website).toBe('https://x.example')
    expect(preserved.website.value).toBe('https://x.example')
  })
})

describe('RECONCILE_TARGET_COLUMNS', () => {
  // A preserved field missing from the SELECT reads as `undefined`, which looks exactly like
  // "the target holds nothing" and would blank it — the bug this mechanism exists to prevent.
  it('fetches every preservable field', () => {
    const cols = RECONCILE_TARGET_COLUMNS.split(', ')
    for (const f of PRESERVE_ON_RECONCILE) expect(cols).toContain(f)
  })

  it('also fetches the columns preflight and ADR-12 need', () => {
    const cols = RECONCILE_TARGET_COLUMNS.split(', ')
    for (const f of ['id', 'osm_id', 'status', 'slug', 'access_type', 'address_verified_at']) {
      expect(cols).toContain(f)
    }
  })
})

describe('preservedSummary', () => {
  it('returns null when nothing was preserved, so callers can print a distinct message', () => {
    expect(preservedSummary({})).toBeNull()
  })

  it('renders field=value pairs', () => {
    const { preserved } = merge(incoming(), target())
    expect(preservedSummary(preserved)).toBe('address="3179 Erie Boulevard East"  zip="13214"')
  })
})
