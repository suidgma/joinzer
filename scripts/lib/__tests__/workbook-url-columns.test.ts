/**
 * TWO URL COLUMNS, TWO FACTS — the `website` / `source_url` collision resolver.
 *
 * A research workbook can carry both a dedicated website column and a `source_url` citation column
 * on its primary tab. COLUMN_ALIASES canonicalizes both onto `website`, so they landed on one key,
 * the LATER sheet column won, and the earlier one was destroyed — including the case where a blank
 * cell overwrote a real URL. Ogden's two columns genuinely differ on 14 of 31 rows.
 *
 * Owner ruling 2026-08-01: both facts survive. The dedicated website column wins `website`; the
 * citation column maps to `name_source_url`. NEITHER CROSS-FILLS THE OTHER.
 *
 * The no-cross-fill rule is unobservable in today's corpus — no row in ogden, new-haven or provo
 * has one of the two cells blank — so these tests are the only thing pinning it. That is the point:
 * the next workbook generation is where it fires.
 *
 * `workbook-extract.mjs` is plain ESM, so tsc widens its exports to `object`; one local alias plus a
 * typed wrapper at the boundary keeps `tsc --noEmit` green without loosening the gate.
 */
import { describe, expect, it } from 'vitest'
import { extractWorkbook } from '../workbook-extract.mjs'

type Row = Record<string, any>

const SITE = 'https://www.ogdencity.gov/'
const CITATION = 'https://www.ogdencity.gov/3261/Adult-Indoor-Pickleball'
const AGG = 'https://playtimescheduler.com/region/ogden-ut'

const config = { metro: 'unit-test', batch: 'unit-test', metro_area: 'Testville', states: ['UT'], workbook: { header_row: 1 } }
const extract = extractWorkbook as unknown as (a: Row) => Promise<{ venues: Row[] } & Row>
const run = async (t: Row, c: Row = config) => extract({ tabs: t, config: c, geocode: false, log: () => {} })

/** Generation A primary tab with an arbitrary set of URL columns, in the order given. */
function tabs(urlCols: string[], urlVals: (string | null)[]) {
  const base = ['research_key', 'name', 'address', 'city', 'state', 'zip', 'access_type', 'fee_type', 'research_status']
  const vals = ['v1', 'Test Park', '1 Main St', 'Testville', 'UT', '84401', 'public', 'free', 'verified']
  return { 'Import Ready': [[...base, ...urlCols], [...vals, ...urlVals.map((v) => v ?? '')]] }
}

describe('website / source_url column collision', () => {
  it('splits the collision: the dedicated website column wins `website`, the citation feeds name_source_url', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [SITE, CITATION]))
    const v = doc.venues[0]
    expect(v.website).toBe(SITE)
    expect(v.name.source_url).toBe(CITATION)
    // The citation is also what the evidence fallbacks rest on — it is the specific evidence page,
    // and the org home page would be a weaker claim about where the fact came from.
    expect(v.access_type.source_url).toBe(CITATION)
    expect(v.fee_type.source_url).toBe(CITATION)
    expect(v.address.source_url).toBe(CITATION)
  })

  it('records the split in workbook_adapter, naming both columns', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [SITE, CITATION]))
    expect(doc.workbook_adapter.url_column_split).toMatchObject({
      website_column: 'website_url',
      citation_column: 'source_url',
    })
  })

  /**
   * THE DEFECT ITSELF. Before the resolver, `source_url` was aliased onto `website` and won by
   * being the later column, so a blank citation cell wrote '' over a real website.
   */
  it('a BLANK citation cell no longer overwrites a real website', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [SITE, null]))
    expect(doc.venues[0].website).toBe(SITE)
  })

  it('does not cross-fill: a blank citation leaves name_source_url null rather than borrowing the website', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [SITE, null]))
    const v = doc.venues[0]
    expect(v.name.source_url).toBeNull()
    expect(v.access_type.source_url).toBeNull()
    expect(v.website).toBe(SITE)
  })

  it('does not cross-fill the other direction either: a blank website leaves `website` null', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [null, CITATION]))
    const v = doc.venues[0]
    expect(v.website).toBeNull()
    expect(v.name.source_url).toBe(CITATION)
  })

  /**
   * THE REGRESSION THAT MATTERS MOST. madison (48 rows), melbourne (15), syracuse (15) and
   * winston-salem (24) carry `source_url` as their ONLY URL column, where it means the website.
   * The resolver reads URL_COLUMN_ROLE only when >=2 headers collide, so those 102 venues are
   * unaffected by construction — this test is the assertion of that, not the reason for it.
   */
  it('leaves a single source_url column meaning `website`, exactly as before', async () => {
    const doc = await run(tabs(['source_url'], [CITATION]))
    const v = doc.venues[0]
    expect(v.website).toBe(CITATION)
    expect(v.name.source_url).toBe(CITATION)
    expect(v.access_type.source_url).toBe(CITATION)
    expect('workbook_adapter' in doc).toBe(false)
  })

  it('leaves a single dedicated website column alone too', async () => {
    const doc = await run(tabs(['website'], [SITE]))
    expect(doc.venues[0].website).toBe(SITE)
    expect(doc.venues[0].name.source_url).toBe(SITE)
  })
})

describe('collision guards — every failure aborts, none silences', () => {
  it('aborts when a colliding header has no declared role', async () => {
    // `provenance_url` is a citation; a hypothetical unknown spelling aliased onto website is not.
    const cfg = { ...config, workbook: { header_row: 1, aliases: { mystery_link: 'website' } } }
    await expect(run(tabs(['website', 'mystery_link'], [SITE, CITATION]), cfg))
      .rejects.toThrow(/no declared role in URL_COLUMN_ROLE/)
  })

  it('aborts when two WEBSITE-role columns collide (no citation to split off)', async () => {
    await expect(run(tabs(['website', 'website_url'], [SITE, SITE])))
      .rejects.toThrow(/2 website column\(s\).*0 citation column\(s\)/)
  })

  it('aborts when two CITATION-role columns collide', async () => {
    await expect(run(tabs(['source_url', 'provenance_url'], [CITATION, CITATION])))
      .rejects.toThrow(/0 website column\(s\).*2 citation column\(s\)/)
  })

  it('aborts rather than clobbering a tab that already has its own name_source_url column', async () => {
    await expect(run(tabs(['website_url', 'source_url', 'name_source_url'], [SITE, CITATION, CITATION])))
      .rejects.toThrow(/already has its own "name_source_url" column/)
  })
})

describe('ADR-14 sees both columns', () => {
  it('keeps the aggregator-only downgrade when BOTH columns hold the same aggregator (the ogden shape)', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [AGG, AGG]))
    const v = doc.venues[0]
    expect(v.research_status).toBe('probable')
    // Stripped from the user-facing column, retained as the citation where ADR-14's scan can see it.
    expect(v.website).toBeNull()
    expect(v.name.source_url).toBe(AGG)
  })

  /**
   * The safety direction of scanning both: `allUrls` can only ever GAIN entries, so the one
   * reachable flip is aggregator-only -> mixed, which PROMOTES a row. It can never newly downgrade.
   */
  it('a real website alongside an aggregator citation lifts the row out of aggregator-only', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [SITE, AGG]))
    const v = doc.venues[0]
    expect(v.research_status).toBe('verified')
    expect(v.website).toBe(SITE)
    // ...and the aggregator is on name_source_url, which is exactly the column the importer's
    // ADR-14 preflight tests on a row that would publish. The guard must be able to see it.
    expect(v.name.source_url).toBe(AGG)
  })

  it('still strips an aggregator website when the citation is a controlling-entity page', async () => {
    const doc = await run(tabs(['website_url', 'source_url'], [AGG, CITATION]))
    const v = doc.venues[0]
    expect(v.website).toBeNull()
    expect(v.name.source_url).toBe(CITATION)
    expect(v.research_status).toBe('verified')
  })
})

describe('the resolver is scoped to the tab it parses', () => {
  it('does not fire on an Evidence tab, whose source_url is pinned to itself', async () => {
    const withEvidence = {
      'Import Ready': [
        ['research_key', 'name', 'address', 'city', 'state', 'zip', 'website_url', 'source_url', 'access_type', 'fee_type', 'research_status'],
        ['v1', 'Test Park', '1 Main St', 'Testville', 'UT', '84401', SITE, CITATION, 'public', 'free', 'verified'],
      ],
      Evidence: [
        ['research_key', 'field_name', 'accepted_value', 'source_url', 'source_tier', 'confidence'],
        ['v1', 'fee_type', 'free', 'https://parks.example.gov/fees', 'tier1', 'high'],
      ],
    }
    const doc = await run(withEvidence)
    const v = doc.venues[0]
    expect(doc.evidence_rows).toMatchObject({ rows: 1, venues_covered: 1 })
    // The evidence tab's own citation still reaches the field it cites...
    expect(v.fee_type.source_url).toBe('https://parks.example.gov/fees')
    // ...and the primary tab's split is unaffected by it.
    expect(v.website).toBe(SITE)
    expect(v.name.source_url).toBe(CITATION)
  })
})
