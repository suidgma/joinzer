/**
 * The field-source_url rule, exercised end-to-end through extractWorkbook rather than against the
 * private helper — the helper is one line; what matters is that the two field nodes it feeds stop
 * inheriting `primaryUrl`, and that every OTHER node still does.
 *
 * `workbook-extract.mjs` is plain ESM, so tsc widens its exports to `object`; one local alias plus a
 * typed wrapper at the boundary keeps `tsc --noEmit` green without loosening the gate.
 */
import { describe, expect, it } from 'vitest'
import { extractWorkbook } from '../workbook-extract.mjs'

type Row = Record<string, any>

const PRIMARY = 'https://parks.example.gov/venues'
const FIELD_EVIDENCE = 'https://parks.example.gov/lighting-survey'

/** Generation A: Import Ready (primary) + Venues + Evidence. */
function tabs({ lighting, indoor, evidence = [] as string[][] }: { lighting: string; indoor: string; evidence?: string[][] }) {
  return {
    'Import Ready': [
      ['research_key', 'name', 'address', 'city', 'state', 'zip', 'website', 'access_type', 'fee_type', 'indoor', 'lighting', 'court_count', 'research_status'],
      ['v1', 'Test Park', '1 Main St', 'Testville', 'PA', '17050', PRIMARY, 'public', 'free', indoor, lighting, '2', 'verified'],
    ],
    Venues: [['research_key', 'name'], ['v1', 'Test Park']],
    Evidence: [['research_key', 'field_name', 'source_url', 'source_tier', 'confidence'], ...evidence],
  }
}

const config = { metro: 'unit-test', batch: 'unit-test', metro_area: 'Testville', states: ['PA'], workbook: { header_row: 1 } }

// workbook-extract.mjs is untyped ESM, so tsc reads `cachePath` as a required param. Cast at the
// boundary — the same pattern the township test uses.
const extract = extractWorkbook as unknown as (a: Row) => Promise<{ venues: Row[] } & Row>

const run = async (t: Row) => extract({ tabs: t, config, geocode: false, log: () => {} })

describe('indoor / lighting no longer inherit primaryUrl', () => {
  it('asserts NO source_url when the workbook stated a value but no field-specific evidence exists', async () => {
    const doc = await run(tabs({ indoor: 'FALSE', lighting: 'TRUE' }))
    const v = doc.venues[0]
    expect(v.indoor.value).toBe(false)
    expect(v.lighting.value).toBe(true)
    expect(v.indoor.source_url).toBeNull()
    expect(v.lighting.source_url).toBeNull()
  })

  it('asserts NO source_url when the field has no value at all', async () => {
    const doc = await run(tabs({ indoor: '', lighting: '' }))
    const v = doc.venues[0]
    expect(v.indoor.value).toBeNull()
    expect(v.lighting.value).toBeNull()
    expect(v.indoor.source_url).toBeNull()
    expect(v.lighting.source_url).toBeNull()
  })

  /**
   * FIXED 2026-08-01. This test previously PINNED the defect; it now asserts the fix.
   *
   * The defect had two independent layers, and only fixing both makes an Evidence-tab URL reachable:
   *   1. header detection scored an Evidence tab's header row 1 (only `research_key` is in
   *      KNOWN_HEADERS) against a threshold of 4, so the tab parsed to ZERO rows — silently;
   *   2. COLUMN_ALIASES renames `source_url -> website`, so even with rows, `urlOf(e)` read a
   *      property that no longer existed.
   * Fixing (2) alone is a provable no-op. The evidence tab now parses with its own marker set and
   * with `source_url` pinned to itself; the PRIMARY-tab alias is untouched (see the next test).
   */
  it('reads an Evidence-tab source_url onto the field it cites', async () => {
    const doc = await run(tabs({
      indoor: 'FALSE',
      lighting: 'TRUE',
      evidence: [['v1', 'lighting', FIELD_EVIDENCE, 'tier1', 'high']],
    }))
    expect(doc.venues[0].lighting.source_url).toBe(FIELD_EVIDENCE)
    // indoor cited nothing of its own, so it still asserts nothing — the rule above is unchanged.
    expect(doc.venues[0].indoor.source_url).toBeNull()
  })

  it('detects an Evidence header row whose columns are all citation columns, with no header_row hint', async () => {
    // Only `research_key` is a venue-field name here; the other five are citation columns. Under the
    // venue-field marker set this scores 1 and the tab yields nothing.
    const doc = await run(tabs({
      indoor: 'TRUE',
      lighting: 'TRUE',
      evidence: [
        ['v1', 'court_count', FIELD_EVIDENCE, 'tier1', 'high'],
        ['v1', 'indoor_outdoor', FIELD_EVIDENCE, 'tier2', 'medium'],
      ],
    }))
    const v = doc.venues[0]
    expect(doc.evidence_rows).toEqual({ rows: 2, venues_covered: 1, tab: 'Evidence' })
    expect(v.court_count.source_url).toBe(FIELD_EVIDENCE)
    expect(v.court_count.source_tier).toBe('tier1')
    expect(v.indoor.source_url).toBe(FIELD_EVIDENCE)
    expect(v.indoor.confidence).toBe('medium')
  })

  it('omits evidence_rows entirely when the tab yielded nothing — 28 metros must gain no key', async () => {
    const doc = await run(tabs({ indoor: 'FALSE', lighting: 'TRUE' }))
    expect('evidence_rows' in doc).toBe(false)
  })

  /**
   * The alias is SCOPED, not removed. `source_url` is the only URL column madison, melbourne,
   * syracuse and winston-salem have (102 venues), so on a PRIMARY tab it must still resolve to
   * `website` — which is what feeds `primaryUrl`, the user-facing `website` column and the
   * `|| primaryUrl` fallbacks.
   */
  it('keeps source_url -> website on the PRIMARY tab, where it is the only URL column', async () => {
    const primaryUsesSourceUrl = {
      'Import Ready': [
        ['research_key', 'name', 'address', 'city', 'state', 'zip', 'source_url', 'access_type', 'fee_type', 'research_status'],
        ['v1', 'Test Park', '1 Main St', 'Testville', 'PA', '17050', PRIMARY, 'public', 'free', 'verified'],
      ],
      Venues: [['research_key', 'name'], ['v1', 'Test Park']],
      Evidence: [['research_key', 'field_name', 'source_url', 'source_tier', 'confidence']],
    }
    const doc = await run(primaryUsesSourceUrl)
    const v = doc.venues[0]
    expect(v.website).toBe(PRIMARY)
    expect(v.name.source_url).toBe(PRIMARY)
    expect(v.access_type.source_url).toBe(PRIMARY)
  })

  /**
   * The reason this matters beyond provenance polish: `name.source_url` becomes the
   * `name_source_url` COLUMN on facility_listings, and the ADR-14 aggregator scan in
   * --stage=publish tests that column. Before the fix it could only ever hold `primaryUrl`, so the
   * scan was structurally unable to see a field-specific aggregator citation.
   */
  it('lets a field-specific AGGREGATOR citation reach name.source_url, where ADR-14 can see it', async () => {
    const AGG = 'https://www.pickleheads.com/courts/test-park'
    const doc = await run(tabs({
      indoor: 'FALSE',
      lighting: 'TRUE',
      evidence: [['v1', 'venue_identity', AGG, 'tier4', 'low']],
    }))
    expect(doc.venues[0].name.source_url).toBe(AGG)
    // ...and the aggregator-only rule does NOT fire, because primaryUrl is a controlling-entity page.
    expect(doc.venues[0].research_status).toBe('verified')
  })

  it('leaves every OTHER field node inheriting primaryUrl exactly as before — this fix is scoped', async () => {
    const doc = await run(tabs({ indoor: 'FALSE', lighting: 'TRUE' }))
    const v = doc.venues[0]
    expect(v.name.source_url).toBe(PRIMARY)
    expect(v.address.source_url).toBe(PRIMARY)
    expect(v.access_type.source_url).toBe(PRIMARY)
    expect(v.fee_type.source_url).toBe(PRIMARY)
    expect(v.reservation_policy.source_url).toBe(PRIMARY)
  })

  it('a venue_facts override can still set a real source_url on indoor — the one live attribution survives', async () => {
    const withOverride = {
      ...config,
      venue_facts: {
        v1: {
          source_url: FIELD_EVIDENCE,
          confidence: 'high',
          adjudicated_by: 'unit-test',
          adjudicated_on: '2026-07-31',
          fields: { indoor: {} },
        },
      },
    }
    const doc = await extract({ tabs: tabs({ indoor: 'FALSE', lighting: 'TRUE' }), config: withOverride, geocode: false, log: () => {} })
    expect(doc.venues[0].indoor.value).toBe(false)
    expect(doc.venues[0].indoor.source_url).toBe(FIELD_EVIDENCE)
    // lighting was not overridden, so it still asserts nothing
    expect(doc.venues[0].lighting.source_url).toBeNull()
  })

  it('court_count keeps the behaviour this rule was modelled on (no primaryUrl fallback)', async () => {
    const doc = await run(tabs({ indoor: 'FALSE', lighting: 'TRUE' }))
    expect(doc.venues[0].court_count.value).toBe(2)
    expect(doc.venues[0].court_count.source_url ?? null).toBeNull()
  })
})
