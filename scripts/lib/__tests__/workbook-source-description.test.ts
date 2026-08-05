/**
 * `workbook.source_description` — the artifact's own account of where its grid came from.
 *
 * The property that matters most is the NEGATIVE one: a config that does not set it must produce the
 * byte-identical string the 29 workbook-derived artifacts already carry. That is what makes this
 * change a no-op on every existing metro by construction rather than by a diff someone remembers to
 * run, so it is asserted first and asserted literally.
 *
 * `workbook-extract.mjs` is plain ESM, so tsc widens its exports to `object`; one local alias plus a
 * typed wrapper at the boundary keeps `tsc --noEmit` green without loosening the gate.
 */
import { describe, expect, it } from 'vitest'
import { describeSource, extractWorkbook } from '../workbook-extract.mjs'

type Cfg = Record<string, any>
type Gen = Record<string, any>
const describeSrc = describeSource as (config: Cfg, gen: Gen) => string

const GEN_A: Gen = { primary_tab: 'Import Ready', venues_tab: 'Venues', evidence_tab: 'Evidence' }
const SUFFIX = 'Import Ready + Venues + Evidence tabs, extracted by scripts/lib/workbook-extract.mjs'

describe('describeSource — unchanged when the config says nothing', () => {
  it('reproduces the pre-existing string for a workbook-derived metro', () => {
    expect(describeSrc({ spreadsheet_id: '1t_iahq' }, GEN_A)).toBe(`Google Sheet 1t_iahq — ${SUFFIX}`)
  })

  it('reproduces the pre-existing fallback when there is no spreadsheet_id either', () => {
    expect(describeSrc({}, GEN_A)).toBe(`Google Sheet (supplied export) — ${SUFFIX}`)
  })

  it('renders only the tabs a generation actually has', () => {
    // Generation C has no venues tab; the joined list must collapse rather than emit an empty slot.
    const genC: Gen = { primary_tab: 'Import Candidates', venues_tab: null, evidence_tab: 'Field Evidence' }
    expect(describeSrc({ spreadsheet_id: 'x' }, genC)).toBe(
      'Google Sheet x — Import Candidates + Field Evidence tabs, extracted by scripts/lib/workbook-extract.mjs',
    )
  })
})

describe('describeSource — the override', () => {
  it('replaces the origin phrase and keeps the tab list and the extractor attribution', () => {
    const cfg: Cfg = { spreadsheet_id: 'ignored', workbook: { source_description: 'Source-led web research, 2026-08-05' } }
    expect(describeSrc(cfg, GEN_A)).toBe(`Source-led web research, 2026-08-05 — ${SUFFIX}`)
  })

  it('never says "Google Sheet" once overridden, even with a spreadsheet_id present', () => {
    const cfg: Cfg = { spreadsheet_id: 'abc', workbook: { source_description: 'Hand-authored grid' } }
    expect(describeSrc(cfg, GEN_A)).not.toContain('Google Sheet')
    expect(describeSrc(cfg, GEN_A)).not.toContain('abc')
  })

  it('trims, so a stray newline in JSON cannot break the sentence', () => {
    const cfg: Cfg = { workbook: { source_description: '  Source-led web research  ' } }
    expect(describeSrc(cfg, GEN_A)).toBe(`Source-led web research — ${SUFFIX}`)
  })
})

describe('describeSource — validation aborts rather than coercing', () => {
  // A blank or non-string value would yield a provenance sentence beginning with nothing, which is
  // worse than the wrong claim the override exists to replace.
  const bad: [unknown, string][] = [['', 'empty string'], ['   ', 'whitespace'], [42, 'number'], [{}, 'object'], [[], 'array']]
  it.each(bad)('rejects %p (%s)', (value, _label) => {
    expect(() => describeSrc({ workbook: { source_description: value } }, GEN_A)).toThrow(/non-empty string/)
  })
})

describe('the override reaches doc.source through the real extractor', () => {
  const tabs = {
    'Import Ready': [
      ['research_key', 'name', 'address', 'city', 'state', 'zip', 'website', 'access_type', 'fee_type', 'research_status'],
      ['v1', 'Test Park', '1 Main St', 'Testville', 'PA', '17050', 'https://parks.example.gov/v', 'public', 'free', 'verified'],
    ],
  }

  const run = async (workbook: Cfg) => {
    const doc = (await (extractWorkbook as any)({
      tabs,
      config: { metro: 'unit-test', batch: 'unit-test', metro_area: 'Testville', states: ['PA'], spreadsheet_id: 'SHEET-1', workbook },
      geocode: false,
      log: () => {},
    })) as { source: string }
    return doc.source
  }

  it('emits the Google Sheet string when nothing overrides it', async () => {
    expect(await run({ header_row: 1 })).toContain('Google Sheet SHEET-1')
  })

  it('emits the supplied description instead', async () => {
    const src = await run({ header_row: 1, source_description: 'Source-led web research (no workbook)' })
    expect(src).toContain('Source-led web research (no workbook)')
    expect(src).not.toContain('Google Sheet')
  })
})
