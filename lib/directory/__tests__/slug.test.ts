/**
 * Parity between lib/directory/slug.ts (app) and scripts/lib/workbook-extract.mjs (importer).
 *
 * The importer's implementation is the DEFINITION OF RECORD — every slug already in
 * facility_listings was produced by it. This suite imports it directly and asserts the app copy
 * agrees, so the two cannot drift. It deliberately does NOT assert hand-written expected strings
 * for the corpus: that would pin the app copy to whatever someone typed here, which is exactly
 * the failure mode a hand-rolled slugify causes.
 *
 * IF A CORPUS CASE DISAGREES, FIX lib/directory/slug.ts — never the corpus. A slugify that drops
 * `&` or mangles initials has produced a false published-row mismatch in this project before.
 */
import { describe, expect, it } from 'vitest'
import {
  slugify,
  directorySlug,
  nextAvailableSlug,
  randomSlugTail,
  MAX_SLUG_SUFFIX,
} from '../slug'
import {
  slugify as mjsSlugify,
  directorySlug as mjsDirectorySlug,
} from '../../../scripts/lib/workbook-extract.mjs'

/** Cases chosen for the transforms that are easy to get wrong, not for coverage of easy ones. */
const NAME_CORPUS = [
  // the ampersand rule — must become "and", not vanish
  'Parks & Rec Center',
  'Smith & Sons Athletic Club',
  '&',
  'A&B',
  // initials and periods
  'J.W. Marriott Courts',
  'St. Mary’s Park',
  'Rt. 12 Pickle',
  // accents and non-ASCII — NFKD + combining-mark strip
  'Peña Blanca Park',
  'Café Courts',
  'Œuvre Center',
  'Ångström Field',
  // punctuation runs and edge whitespace
  '  Leading and trailing  ',
  'Double--Hyphen',
  'Slash/Separated',
  "O'Brien Recreation",
  'Courts (North)',
  'Courts #3',
  '100% Pickleball',
  'A—B (em dash)',
  // degenerate inputs
  '',
  '   ',
  '---',
  '!!!',
  '12',
  '901',
  // realistic venue names
  'Pickleball 901',
  'Sun City Festival Pickleball Complex',
  'Hayes-Taylor Memorial YMCA',
  'Wa-Ke Hatchee Recreation Center',
  'Bur-Mil Park',
]

const LOCATION_CORPUS = [
  { name: 'Parks & Rec Center', city: 'Las Vegas', state: 'NV' },
  { name: 'Sunset Park', city: 'North Las Vegas', state: 'NV' },
  { name: 'Peña Blanca Park', city: 'Española', state: 'NM' },
  { name: 'J.W. Marriott Courts', city: 'Summerlin', state: 'NV' },
  { name: 'Courts', city: '', state: 'AZ' },
  { name: 'Courts', city: 'Mesa', state: '' },
  { name: 'Courts', city: null, state: null },
  { name: '', city: 'Phoenix', state: 'AZ' },
  { name: 'Rt. 12 Pickle', city: 'Worcester', state: 'MA' },
  { name: 'Bur-Mil Park', city: 'Greensboro', state: 'nc' },
]

describe('slugify parity with scripts/lib/workbook-extract.mjs', () => {
  it.each(NAME_CORPUS)('agrees on %j', (input) => {
    expect(slugify(input)).toBe(mjsSlugify(input))
  })

  it('agrees on null and undefined', () => {
    expect(slugify(null)).toBe(mjsSlugify(null))
    expect(slugify(undefined)).toBe(mjsSlugify(undefined))
  })

  it('resolves the ampersand to "and" rather than dropping it', () => {
    // Pinned explicitly because losing it is silent: the slug stays plausible and stops matching
    // the published row.
    expect(slugify('Parks & Rec')).toBe('parks-and-rec')
  })

  it('folds accents to ASCII instead of hyphenating them', () => {
    expect(slugify('Peña')).toBe('pena')
  })

  it('keeps initials joined rather than splitting on the periods', () => {
    expect(slugify('J.W. Marriott')).toBe('j-w-marriott')
  })
})

describe('directorySlug parity with scripts/lib/workbook-extract.mjs', () => {
  it.each(LOCATION_CORPUS)('agrees on %j', (loc) => {
    expect(directorySlug(loc)).toBe(mjsDirectorySlug(loc))
  })

  it('produces <name>-<city>-<state>', () => {
    expect(directorySlug({ name: 'Sunset Park', city: 'Las Vegas', state: 'NV' }))
      .toBe('sunset-park-las-vegas-nv')
  })

  it('drops empty segments instead of leaving double hyphens', () => {
    expect(directorySlug({ name: 'Sunset Park', city: '', state: 'NV' }))
      .toBe('sunset-park-nv')
  })
})

describe('nextAvailableSlug', () => {
  it('returns the base when it is free', () => {
    expect(nextAvailableSlug('sunset-park-nv', new Set())).toBe('sunset-park-nv')
  })

  it('starts the ladder at 2, matching the importer', () => {
    expect(nextAvailableSlug('sunset-park-nv', new Set(['sunset-park-nv'])))
      .toBe('sunset-park-nv-2')
  })

  it('walks past a contiguous run of taken suffixes', () => {
    const taken = new Set(['sunset-park-nv', 'sunset-park-nv-2', 'sunset-park-nv-3'])
    expect(nextAvailableSlug('sunset-park-nv', taken)).toBe('sunset-park-nv-4')
  })

  it('fills a gap in the middle of the ladder rather than appending at the end', () => {
    const taken = new Set(['sunset-park-nv', 'sunset-park-nv-2', 'sunset-park-nv-4'])
    expect(nextAvailableSlug('sunset-park-nv', taken)).toBe('sunset-park-nv-3')
  })

  it('falls back to a random tail once the whole ladder is exhausted', () => {
    const taken = new Set(['base'])
    for (let i = 2; i <= MAX_SLUG_SUFFIX; i++) taken.add(`base-${i}`)
    const out = nextAvailableSlug('base', taken)
    expect(out).toMatch(/^base-[a-z0-9]{8}$/)
    expect(taken.has(out)).toBe(false)
  })

  it('throws on an empty base rather than minting a slug of pure suffix', () => {
    // An empty base would produce "-2", which is a valid unique string and a meaningless URL.
    expect(() => nextAvailableSlug('', new Set())).toThrow(/empty/)
  })
})

describe('randomSlugTail', () => {
  it('is always 8 lowercase alphanumerics', () => {
    for (let i = 0; i < 200; i++) expect(randomSlugTail()).toMatch(/^[a-z0-9]{8}$/)
  })

  it('does not collide across a large sample', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => randomSlugTail()))
    expect(seen.size).toBeGreaterThan(1990)
  })
})
