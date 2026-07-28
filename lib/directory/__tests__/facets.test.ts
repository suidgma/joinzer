import { describe, test, expect } from 'vitest'
import type { FacilityListItem } from '../loadFacilities'
import {
  STATIC_FACETS, facetsFor, buildCityFacet, parseSelection, parseSort, toQueryString, toggle,
  hrefFor, applySelection, buildFacetViews, sortFacilities, groupByCity, hasFilters, countFilters,
  citySlug, type FacetDef,
} from '../facets'
import { metroSlug, findMetro, metroLabel, type MetroSummary } from '../metros'

function facility(overrides: Partial<FacilityListItem> = {}): FacilityListItem {
  return {
    name: 'Test Courts', slug: 'test-courts',
    city: 'Phoenix', state: 'AZ',
    access_type: 'public', indoor: false,
    fee_type: 'free', reservation_policy: 'drop_in',
    court_count: 4, metro_area: 'Phoenix',
    ...overrides,
  }
}

// The production shape that makes the honesty rule non-trivial: both kinds of absence present.
const SAMPLE: FacilityListItem[] = [
  facility({ slug: 'a', name: 'Alpha', fee_type: 'free', access_type: 'public', indoor: false, reservation_policy: 'drop_in', city: 'Phoenix', court_count: 8 }),
  facility({ slug: 'b', name: 'Bravo', fee_type: 'fee', access_type: 'private', indoor: true, reservation_policy: 'reservation_required', city: 'Mesa', court_count: 2 }),
  facility({ slug: 'c', name: 'Charlie', fee_type: 'membership', access_type: 'hoa', indoor: false, reservation_policy: 'none', city: 'Mesa', court_count: null }),
  // researched-but-undetermined across the board
  facility({ slug: 'd', name: 'Delta', fee_type: 'unknown', access_type: 'unknown', indoor: null, reservation_policy: 'unknown', city: 'Tempe', court_count: null }),
  // not-yet-researched across the board
  facility({ slug: 'e', name: 'Echo', fee_type: null, access_type: null, indoor: null, reservation_policy: null, city: 'Tempe', court_count: 6 }),
]

const FACETS = facetsFor(SAMPLE)
const facetByKey = (key: string): FacetDef => FACETS.find((f) => f.key === key)!

describe('inclusive-only: absence is never a negative', () => {
  test("no option ever matches a row whose value is NULL or 'unknown'", () => {
    for (const facet of FACETS) {
      for (const option of facet.options) {
        for (const row of SAMPLE) {
          if (!option.match(row)) continue
          // If an option matched, the row must hold an affirmative value for that facet.
          expect(facet.known(row), `${facet.key}/${option.value} matched a row it cannot claim`).toBe(true)
        }
      }
    }
  })

  test("'unknown' never appears as a selectable value in any facet definition", () => {
    for (const facet of FACETS) {
      expect(facet.options.map((o) => o.value)).not.toContain('unknown')
    }
  })

  test("'unknown' never appears in a rendered chip, even when its column dominates", () => {
    // 62 of 176 Phoenix rows are reservation_policy='unknown' in production — the worst case.
    const heavy = [
      ...Array.from({ length: 62 }, (_, i) => facility({ slug: `u${i}`, reservation_policy: 'unknown' })),
      facility({ slug: 'x', reservation_policy: 'drop_in' }),
      facility({ slug: 'y', reservation_policy: 'reservation_required' }),
    ]
    const views = buildFacetViews(heavy, {}, facetsFor(heavy))
    const play = views.find((v) => v.key === 'play')
    expect(play).toBeDefined()
    expect(play!.options.map((o) => o.value)).toEqual(['drop-in', 'reservation-required'])
    // Coverage tells the truth about the other 62 instead of hiding them.
    expect(play!.knownCount).toBe(2)
    expect(play!.totalCount).toBe(64)
  })

  test('no filter selection can ever return a row lacking an affirmative value', () => {
    for (const facet of FACETS) {
      for (const option of facet.options) {
        const result = applySelection(SAMPLE, { [facet.key]: [option.value] }, FACETS)
        for (const row of result) {
          expect(facet.known(row)).toBe(true)
        }
        // Delta ('unknown' everywhere) and Echo (NULL everywhere) are never returned by
        // fee/access/setting/play filters.
        if (facet.key !== 'city') {
          expect(result.map((r) => r.slug)).not.toContain('d')
          expect(result.map((r) => r.slug)).not.toContain('e')
        }
      }
    }
  })

  test('selecting every option of a facet still excludes unknown/null rows', () => {
    const fee = facetByKey('fee')
    const all = applySelection(SAMPLE, { fee: fee.options.map((o) => o.value) }, FACETS)
    expect(all.map((r) => r.slug).sort()).toEqual(['a', 'b', 'c'])
  })

  test('indoor=false is an affirmative fact, but null is in neither bucket', () => {
    const outdoor = applySelection(SAMPLE, { setting: ['outdoor'] }, FACETS)
    expect(outdoor.map((r) => r.slug).sort()).toEqual(['a', 'c'])
    const indoor = applySelection(SAMPLE, { setting: ['indoor'] }, FACETS)
    expect(indoor.map((r) => r.slug)).toEqual(['b'])
    const both = applySelection(SAMPLE, { setting: ['indoor', 'outdoor'] }, FACETS)
    // d and e have indoor === null and appear in neither, nor in the union.
    expect(both.map((r) => r.slug).sort()).toEqual(['a', 'b', 'c'])
  })

  test('there is no negative option anywhere (no "no lights" / "not indoor" style bucket)', () => {
    // Guards the rule structurally: every option must be satisfiable by some affirmative row and
    // must reject a row whose facet value is absent.
    const absent = facility({ fee_type: null, access_type: null, indoor: null, reservation_policy: null, city: null })
    for (const facet of FACETS) {
      for (const option of facet.options) {
        expect(option.match(absent), `${facet.key}/${option.value} matched an all-absent row`).toBe(false)
      }
    }
  })
})

describe('reservation policy merge (owner ruling)', () => {
  test("drop-in covers both 'drop_in' and 'none'", () => {
    const result = applySelection(SAMPLE, { play: ['drop-in'] }, FACETS)
    expect(result.map((r) => r.slug).sort()).toEqual(['a', 'c'])
  })

  test('recommended and required stay 1:1 with their stored values', () => {
    expect(applySelection(SAMPLE, { play: ['reservation-required'] }, FACETS).map((r) => r.slug)).toEqual(['b'])
    expect(applySelection(SAMPLE, { play: ['reservation-recommended'] }, FACETS)).toEqual([])
  })
})

describe('filter combination semantics', () => {
  test('OR within a facet', () => {
    const result = applySelection(SAMPLE, { fee: ['free', 'fee'] }, FACETS)
    expect(result.map((r) => r.slug).sort()).toEqual(['a', 'b'])
  })

  test('AND across facets', () => {
    expect(applySelection(SAMPLE, { fee: ['free'], setting: ['outdoor'] }, FACETS).map((r) => r.slug)).toEqual(['a'])
    expect(applySelection(SAMPLE, { fee: ['free'], setting: ['indoor'] }, FACETS)).toEqual([])
  })

  test('empty selection returns everything', () => {
    expect(applySelection(SAMPLE, {}, FACETS)).toHaveLength(SAMPLE.length)
  })
})

describe('facet counts', () => {
  test('counts equal a naive reference implementation', () => {
    const views = buildFacetViews(SAMPLE, {}, FACETS)
    for (const view of views) {
      const facet = facetByKey(view.key)
      for (const option of view.options) {
        const def = facet.options.find((o) => o.value === option.value)!
        expect(option.count).toBe(SAMPLE.filter((f) => def.match(f)).length)
      }
    }
  })

  test('a count is exactly what clicking it returns (other facets applied, own facet excluded)', () => {
    const selection = { setting: ['outdoor'] }
    const views = buildFacetViews(SAMPLE, selection, FACETS)
    const fee = views.find((v) => v.key === 'fee')!
    for (const option of fee.options) {
      const clicked = applySelection(SAMPLE, { ...selection, fee: [option.value] }, FACETS)
      expect(clicked).toHaveLength(option.count)
    }
  })

  test('coverage counts use known(), not a null check', () => {
    const views = buildFacetViews(SAMPLE, {}, FACETS)
    const fee = views.find((v) => v.key === 'fee')!
    // 5 rows: 3 affirmative, 1 'unknown', 1 NULL. A null check alone would wrongly say 4.
    expect(fee.knownCount).toBe(3)
    expect(fee.totalCount).toBe(5)
  })

  test('a facet with fewer than two non-zero options is dropped entirely', () => {
    const uniform = [facility({ slug: 'p' }), facility({ slug: 'q' })] // all free/public/outdoor/drop_in/Phoenix
    const views = buildFacetViews(uniform, {}, facetsFor(uniform))
    expect(views.map((v) => v.key)).toEqual([])
  })

  test('thin-coverage metro keeps facets that still discriminate', () => {
    // Reno shape: fee_type 48% filled, but the filled rows span three values.
    const reno = [
      facility({ slug: 'r1', fee_type: 'free', city: 'Reno' }),
      facility({ slug: 'r2', fee_type: 'fee', city: 'Sparks' }),
      facility({ slug: 'r3', fee_type: null, city: 'Reno' }),
      facility({ slug: 'r4', fee_type: null, city: 'Reno' }),
    ]
    const views = buildFacetViews(reno, {}, facetsFor(reno))
    const fee = views.find((v) => v.key === 'fee')!
    expect(fee.options.map((o) => o.value)).toEqual(['free', 'fee'])
    expect(fee.knownCount).toBe(2)
    expect(fee.totalCount).toBe(4)
  })
})

describe('URL params', () => {
  test('round-trips a selection', () => {
    const selection = { fee: ['free', 'membership'], setting: ['outdoor'] }
    const qs = toQueryString(selection, FACETS)
    const params = Object.fromEntries(new URLSearchParams(qs))
    expect(parseSelection(params, FACETS)).toEqual(selection)
  })

  test('drops unrecognized values and unknown facet keys', () => {
    const parsed = parseSelection(
      { fee: 'free,bogus,unknown', access: 'nonsense', nope: 'x', setting: '' },
      FACETS
    )
    expect(parsed).toEqual({ fee: ['free'] })
  })

  test("'unknown' is rejected as a URL value even though it is a real column value", () => {
    expect(parseSelection({ fee: 'unknown' }, FACETS)).toEqual({})
    expect(parseSelection({ access: 'unknown' }, FACETS)).toEqual({})
    expect(parseSelection({ play: 'unknown' }, FACETS)).toEqual({})
  })

  test('is case-insensitive and de-duplicates', () => {
    expect(parseSelection({ fee: 'FREE,free,Free' }, FACETS)).toEqual({ fee: ['free'] })
  })

  test('tolerates array-valued params (repeated query keys)', () => {
    expect(parseSelection({ fee: ['free', 'fee'] }, FACETS)).toEqual({ fee: ['free', 'fee'] })
  })

  test('same filter set yields one canonical URL regardless of click order', () => {
    const a = toQueryString({ fee: ['membership', 'free'] }, FACETS)
    const b = toQueryString({ fee: ['free', 'membership'] }, FACETS)
    expect(a).toBe(b)
  })

  test('toggle adds then removes, and clears the key when empty', () => {
    let selection = toggle({}, 'fee', 'free')
    expect(selection).toEqual({ fee: ['free'] })
    selection = toggle(selection, 'fee', 'fee')
    expect(selection.fee).toEqual(['free', 'fee'])
    selection = toggle(selection, 'fee', 'free')
    expect(selection.fee).toEqual(['fee'])
    selection = toggle(selection, 'fee', 'fee')
    expect(selection.fee).toBeUndefined()
  })

  test('hrefFor omits the query string entirely when nothing is selected', () => {
    expect(hrefFor('/courts/in/phoenix', {}, FACETS)).toBe('/courts/in/phoenix')
    expect(hrefFor('/courts/in/phoenix', { fee: ['free'] }, FACETS)).toBe('/courts/in/phoenix?fee=free')
  })

  test('sort is parsed and serialized, defaulting safely', () => {
    expect(parseSort({})).toBe('default')
    expect(parseSort({ sort: 'courts' })).toBe('courts')
    expect(parseSort({ sort: 'nonsense' })).toBe('default')
    expect(hrefFor('/courts/in/phoenix', {}, FACETS, 'courts')).toBe('/courts/in/phoenix?sort=courts')
  })

  test('hasFilters / countFilters ignore sort', () => {
    expect(hasFilters({})).toBe(false)
    expect(hasFilters({ fee: ['free'] })).toBe(true)
    expect(countFilters({ fee: ['free', 'fee'], setting: ['indoor'] })).toBe(3)
  })
})

describe('city facet', () => {
  test('is built from the rows in view, so a new metro needs no code change', () => {
    const facet = buildCityFacet(SAMPLE)
    expect(facet.options.map((o) => o.label)).toEqual(['Mesa', 'Phoenix', 'Tempe'])
  })

  test('matches on the display name, not the slug', () => {
    const result = applySelection(SAMPLE, { city: ['mesa'] }, FACETS)
    expect(result.map((r) => r.slug).sort()).toEqual(['b', 'c'])
  })

  test('slugs multi-word cities consistently with metro slugs', () => {
    expect(citySlug('Sun City West')).toBe('sun-city-west')
    expect(citySlug('Incline Village')).toBe('incline-village')
  })

  test('rows with a null city produce no option and match nothing', () => {
    const rows = [facility({ slug: 'n', city: null }), facility({ slug: 'm', city: 'Mesa' })]
    const facet = buildCityFacet(rows)
    expect(facet.options.map((o) => o.label)).toEqual(['Mesa'])
    expect(facet.options.every((o) => !o.match(rows[0]))).toBe(true)
  })
})

describe('court count sort', () => {
  test('default sort leaves order untouched and has no unconfirmed bucket', () => {
    const { known, unconfirmed } = sortFacilities(SAMPLE, 'default')
    expect(known).toHaveLength(5)
    expect(unconfirmed).toHaveLength(0)
  })

  test('sort=courts orders known counts desc and separates unconfirmed rather than hiding them', () => {
    const { known, unconfirmed } = sortFacilities(SAMPLE, 'courts')
    expect(known.map((f) => f.slug)).toEqual(['a', 'e', 'b'])
    expect(unconfirmed.map((f) => f.slug).sort()).toEqual(['c', 'd'])
    // Nothing is dropped — the whole set is still on the page.
    expect(known.length + unconfirmed.length).toBe(SAMPLE.length)
  })

  test('a null court_count never sorts as zero', () => {
    const { known } = sortFacilities(SAMPLE, 'courts')
    expect(known.every((f) => f.court_count != null)).toBe(true)
  })
})

describe('grouping', () => {
  test('groups by city alphabetically with Other last', () => {
    const rows = [facility({ city: null, slug: 'z' }), facility({ city: 'Tempe', slug: 't' }), facility({ city: 'Mesa', slug: 'm' })]
    expect(groupByCity(rows).map((g) => g.city)).toEqual(['Mesa', 'Tempe', 'Other'])
  })
})

describe('metro slugs', () => {
  test('derives slugs from stored metro_area values', () => {
    expect(metroSlug('Phoenix')).toBe('phoenix')
    expect(metroSlug('Reno-Sparks')).toBe('reno-sparks')
    expect(metroSlug('Las Vegas')).toBe('las-vegas')
  })

  test('handles punctuation, spacing and diacritics without leaving stray separators', () => {
    expect(metroSlug('  Dallas–Fort Worth  ')).toBe('dallas-fort-worth')
    expect(metroSlug('St. Louis')).toBe('st-louis')
    expect(metroSlug('Peñasco')).toBe('penasco')
  })

  test('finds a metro case-insensitively and returns null for an unknown slug', () => {
    const metros: MetroSummary[] = [
      { metro_area: 'Phoenix', state: 'AZ', slug: 'phoenix', count: 176 },
      { metro_area: 'Reno-Sparks', state: 'NV', slug: 'reno-sparks', count: 29 },
    ]
    expect(findMetro(metros, 'reno-sparks')?.metro_area).toBe('Reno-Sparks')
    expect(findMetro(metros, 'RENO-SPARKS')?.metro_area).toBe('Reno-Sparks')
    expect(findMetro(metros, 'las-vegas')).toBeNull()
    expect(findMetro(metros, '')).toBeNull()
  })

  test('labels include state only when known', () => {
    expect(metroLabel({ metro_area: 'Phoenix', state: 'AZ' })).toBe('Phoenix, AZ')
    expect(metroLabel({ metro_area: 'Phoenix', state: null })).toBe('Phoenix')
  })
})

describe('facet definitions stay in sync with the DB CHECK constraints', () => {
  test('fee options are a subset of the fee_type CHECK vocabulary minus unknown', () => {
    const allowed = new Set(['free', 'fee', 'membership'])
    expect(STATIC_FACETS.find((f) => f.key === 'fee')!.options.every((o) => allowed.has(o.value))).toBe(true)
  })

  test('access options are a subset of the access_type CHECK vocabulary minus unknown', () => {
    const allowed = new Set(['public', 'private', 'membership', 'school', 'hoa'])
    expect(STATIC_FACETS.find((f) => f.key === 'access')!.options.every((o) => allowed.has(o.value))).toBe(true)
  })

  test('lighting and surface have no facet (35% and 7% filled)', () => {
    expect(STATIC_FACETS.map((f) => f.key)).not.toContain('lighting')
    expect(STATIC_FACETS.map((f) => f.key)).not.toContain('surface')
  })
})
