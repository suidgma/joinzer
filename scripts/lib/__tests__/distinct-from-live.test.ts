/**
 * `distinct_from_live` — the third proximity allow-list.
 *
 * `reconciles` matches a neighbour by osm_id; `also_at_site` looks one up by osm_id AND asserts it
 * is still status='draft'. A PUBLISHED row that came from our own research has osm_id NULL, so
 * neither can name it — and Tampa's Bryan Glazer Family JCC was deferred out of its batch for
 * exactly that reason, 148 m from published Vila Brothers Park with reconcile_radius_m at 200.
 *
 * These tests pin the validations that keep this an adjudication rather than a silencer, and in
 * particular the one that is new: `distinguishers` is a closed vocabulary whose two exactly-
 * comparable members are VERIFIED against live data, so a false claim aborts.
 */
import { describe, expect, it } from 'vitest'
import { parseDistinctFromLive, verifyDistinctFromLive, DISTINGUISHERS, DISTINCT_NEIGHBOUR_COLUMNS } from '../distinct-from-live.mjs'

type Row = Record<string, any>
const parse = (e: unknown, ctx: Row = {}) =>
  parseDistinctFromLive(e as any, ctx as any) as Map<string, Row>
const verify = (entry: Row, ctx: Row) =>
  verifyDistinctFromLive(entry as any, ctx as any) as { ok: boolean; failures: string[]; verified: string[]; declared: string[] }

const VILA_ID = '708a03f5-a551-4aae-8959-9c0af3b65c97'
const KEY = 'tampa-addendum-2-bryan-glazer-family-jcc'

const entry = (over: Row = {}) => ({
  candidate_key: KEY,
  listing_id: VILA_ID,
  slug: 'vila-brothers-park-tampa-fl',
  verdict: 'two_venues',
  distinguishers: ['different_street', 'different_zip', 'different_operator', 'different_access_type', 'different_court_type'],
  evidence_url: 'https://www.shannaandbryanglazerjcc.com/multi-sports-court',
  adjudicated_by: 'court-verifier',
  adjudicated_on: '2026-08-06',
  ...over,
})

const ctx = (over: Row = {}) => ({ configPath: 'scripts/metros/test.json', artifactKeys: new Set([KEY]), reconciles: [], ...over })

/** The live rows, verbatim: the JCC as researched, Vila Brothers as published. */
const GLAZER = { zip: '33606', access_type: 'membership' }
const VILA = { id: VILA_ID, slug: 'vila-brothers-park-tampa-fl', zip: '33609', access_type: 'public', address: '700 N Armenia Ave' }

describe('parseDistinctFromLive — mandatory shape', () => {
  it('parses a well-formed entry, keyed by the neighbour listing_id', () => {
    const m = parse([entry()], ctx())
    expect(m.size).toBe(1)
    expect(m.get(VILA_ID)!.candidate_key).toBe(KEY)
  })

  it('accepts an absent key as an empty map', () => {
    expect(parse(undefined, ctx()).size).toBe(0)
    expect(parse([], ctx()).size).toBe(0)
  })

  it.each(['candidate_key', 'listing_id', 'slug', 'verdict', 'evidence_url', 'adjudicated_on'])(
    'refuses an entry missing "%s"', (k) => {
      expect(() => parse([entry({ [k]: undefined })], ctx())).toThrow(new RegExp(`missing "${k}"`))
    },
  )

  // A one-venue finding is a reconcile or exclude decision. Allow-listing it publishes a duplicate,
  // which is the opposite of the fix — the same closed vocabulary same_site_pairs enforces.
  it.each(['one_venue', 'duplicate', 'same_site_dormant', 'probably_fine'])(
    'refuses verdict "%s" — only two_venues may be allow-listed', (v) => {
      expect(() => parse([entry({ verdict: v })], ctx())).toThrow(/Only 'two_venues'/)
    },
  )

  it('refuses a candidate_key the artifact does not contain', () => {
    expect(() => parse([entry()], ctx({ artifactKeys: new Set(['someone-else']) }))).toThrow(/stale config/)
  })

  // Two contradictory verdicts about one physical identity; whichever ran second would silently win.
  it('refuses an entry that also names this candidate\'s reconcile target', () => {
    const reconciles = [{ candidate_key: KEY, listing_id: VILA_ID, osm_id: 'way/1' }]
    expect(() => parse([entry()], ctx({ reconciles }))).toThrow(/cannot be both reconciled onto and distinct from/)
  })

  it('refuses two entries claiming the same neighbour', () => {
    expect(() => parse([entry(), entry({ candidate_key: KEY })], ctx())).toThrow(/One neighbour, one adjudication/)
  })
})

describe('parseDistinctFromLive — the closed distinguisher vocabulary', () => {
  it('requires a non-empty distinguishers array', () => {
    expect(() => parse([entry({ distinguishers: undefined })], ctx())).toThrow(/non-empty "distinguishers"/)
    expect(() => parse([entry({ distinguishers: [] })], ctx())).toThrow(/non-empty "distinguishers"/)
    expect(() => parse([entry({ distinguishers: 'different zips' })], ctx())).toThrow(/non-empty "distinguishers"/)
  })

  // PROSE IN A MACHINE-COMPARABLE POSITION is how this codebase has been bitten before:
  // expected_publish.hold takes machine reasons because rationale prose there produced seven false
  // failures on a correct Jacksonville split.
  it('refuses free prose in place of a vocabulary member', () => {
    expect(() => parse([entry({ distinguishers: ['they are on different streets'] })], ctx()))
      .toThrow(/not in the closed vocabulary/)
  })

  it('refuses a repeated distinguisher', () => {
    expect(() => parse([entry({ distinguishers: ['different_zip', 'different_zip'] })], ctx())).toThrow(/repeats a distinguisher/)
  })

  it('exposes exactly the columns the verified distinguishers need', () => {
    const needed = Object.entries(DISTINGUISHERS).filter(([, s]: [string, any]) => s.verified).map(([k]) => k)
    expect(needed.sort()).toEqual(['different_access_type', 'different_zip'])
    // A widening here must not be silently left out of the envelope query — the same reasoning as
    // RECONCILE_TARGET_COLUMNS being derived from PRESERVE_ON_RECONCILE.
    expect(DISTINCT_NEIGHBOUR_COLUMNS).toContain('zip')
    expect(DISTINCT_NEIGHBOUR_COLUMNS).toContain('access_type')
  })
})

describe('verifyDistinctFromLive — checked against the live row', () => {
  it('settles the real Tampa case, verifying both checkable claims', () => {
    const r = verify(entry(), { venue: GLAZER, neighbour: VILA })
    expect(r.ok).toBe(true)
    expect(r.verified).toEqual(['different_zip: 33606 vs 33609', 'different_access_type: membership vs public'])
    // The rest rest on the adjudicator's evidence, and the run says so rather than implying proof.
    expect(r.declared).toEqual(['different_street', 'different_operator', 'different_court_type'])
  })

  it('FAILS a different_zip claim when the zips are in fact identical', () => {
    const r = verify(entry({ distinguishers: ['different_zip'] }), { venue: { zip: '33609' }, neighbour: VILA })
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/both rows are 33609/)
  })

  it('FAILS a different_access_type claim when both are the same', () => {
    const r = verify(entry({ distinguishers: ['different_access_type'] }), { venue: { access_type: 'public' }, neighbour: VILA })
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/both rows are "public"/)
  })

  // A claim cannot be true of data that is absent. Passing it would let a null quietly satisfy a
  // check — the isAbsent lesson, in a different column.
  it('FAILS a checkable claim when either side has no value', () => {
    expect(verify(entry({ distinguishers: ['different_zip'] }), { venue: { zip: null }, neighbour: VILA }).ok).toBe(false)
    expect(verify(entry({ distinguishers: ['different_zip'] }), { venue: GLAZER, neighbour: { ...VILA, zip: null } }).ok).toBe(false)
  })

  it('compares zips as trimmed strings, so 33606 and " 33606 " are not "different"', () => {
    const r = verify(entry({ distinguishers: ['different_zip'] }), { venue: { zip: ' 33606 ' }, neighbour: { ...VILA, zip: '33606' } })
    expect(r.ok).toBe(false)
  })

  // The adjudication was made about a row with a particular slug. A re-slug may be a rename, a
  // merge, or a different row occupying that id — none of which the adjudicator saw.
  it('FAILS when the live neighbour has been re-slugged since adjudication', () => {
    const r = verify(entry(), { venue: GLAZER, neighbour: { ...VILA, slug: 'vila-brothers-park-west-tampa-fl' } })
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/Re-adjudicate; do NOT just update the slug/)
  })

  it('accumulates every failure rather than stopping at the first', () => {
    const r = verify(entry(), { venue: { zip: '33609', access_type: 'public' }, neighbour: { ...VILA, slug: 'moved' } })
    expect(r.failures).toHaveLength(3)
  })

  // different_street is DECLARED, never verified: comparing address strings can only be permissive
  // in the direction of accepting a claim, and a check that can rubber-stamp a false claim is worse
  // than an honest declaration because it reads as proof.
  it('never machine-verifies different_street, even when both addresses are identical', () => {
    const r = verify(entry({ distinguishers: ['different_street'] }), { venue: GLAZER, neighbour: VILA })
    expect(r.ok).toBe(true)
    expect(r.declared).toEqual(['different_street'])
    expect(r.verified).toEqual([])
  })
})
