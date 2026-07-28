import type { FacilityListItem } from './loadFacilities'
import { metroSlug } from './metros'

// FACET FILTERING — THE RULE THIS FILE EXISTS TO ENFORCE
//
// Filters are INCLUSIVE-ONLY. Absence is never a negative.
//
// Every option below is an affirmative equality test against a value a row actually holds. There is
// no `!== x`, no `== null`, no `OR IS NULL` anywhere in this file, and there must never be. Selecting
// "Free" claims 51 rows are free; it claims nothing about the other 125. A hypothetical "No lights"
// option would claim 133 rows have no lights when we simply have not researched them — which is why
// lighting (35% filled) and surface (7%) have no facet at all.
//
// Two distinct kinds of absence, BOTH excluded from every bucket:
//   NULL       — not yet researched
//   'unknown'  — researched but undetermined (a STORED value; see migration 20260724000002)
// 'unknown' is the trap: it makes count(non-null) look like coverage. Measured against production
// 2026-07-28, reservation_policy is 92% non-null but only 61% usable site-wide (62 Phoenix rows are
// 'unknown'), and fee_type is 93% non-null but 85% usable. Coverage below is computed with `known`,
// never with a null check alone.
//
// `indoor` is the one place a boolean false IS an affirmative fact: 145 rows are researched-outdoor,
// not merely not-indoor. So Indoor/Outdoor are both honest options, and NULL (19 rows) is in neither.

export type FacetKey = 'fee' | 'access' | 'setting' | 'play' | 'city'

export type FacetOption = {
  value: string
  label: string
  /** Affirmative match. Must test equality against a real stored value — never absence. */
  match: (f: FacilityListItem) => boolean
}

export type FacetDef = {
  key: FacetKey
  label: string
  options: FacetOption[]
  /** Rows where this facet is researched AND determined. Drives the honest coverage line. */
  known: (f: FacilityListItem) => boolean
}

/** Static facets. City is per-metro and built by buildCityFacet(). */
export const STATIC_FACETS: FacetDef[] = [
  {
    key: 'fee',
    label: 'Cost',
    options: [
      { value: 'free', label: 'Free', match: (f) => f.fee_type === 'free' },
      { value: 'fee', label: 'Pay to play', match: (f) => f.fee_type === 'fee' },
      { value: 'membership', label: 'Membership', match: (f) => f.fee_type === 'membership' },
    ],
    known: (f) => f.fee_type != null && f.fee_type !== 'unknown',
  },
  {
    key: 'access',
    label: 'Access',
    options: [
      { value: 'public', label: 'Public', match: (f) => f.access_type === 'public' },
      { value: 'private', label: 'Private', match: (f) => f.access_type === 'private' },
      { value: 'membership', label: 'Membership', match: (f) => f.access_type === 'membership' },
      { value: 'hoa', label: 'HOA', match: (f) => f.access_type === 'hoa' },
      { value: 'school', label: 'School', match: (f) => f.access_type === 'school' },
    ],
    known: (f) => f.access_type != null && f.access_type !== 'unknown',
  },
  {
    key: 'setting',
    label: 'Setting',
    options: [
      { value: 'indoor', label: 'Indoor', match: (f) => f.indoor === true },
      { value: 'outdoor', label: 'Outdoor', match: (f) => f.indoor === false },
    ],
    known: (f) => f.indoor != null,
  },
  {
    key: 'play',
    label: 'Getting on court',
    options: [
      {
        value: 'drop-in',
        label: 'Drop-in play',
        // 'none' = no reservation system exists, 'drop_in' = drop-in play supported. Both mean you
        // can show up and play, so they merge into one option (owner ruling, 2026-07-28). This is
        // the only value merge in the file — every other option is 1:1 with a stored value.
        match: (f) => f.reservation_policy === 'drop_in' || f.reservation_policy === 'none',
      },
      {
        value: 'reservation-recommended',
        label: 'Reservation recommended',
        match: (f) => f.reservation_policy === 'reservation_recommended',
      },
      {
        value: 'reservation-required',
        label: 'Reservation required',
        match: (f) => f.reservation_policy === 'reservation_required',
      },
    ],
    known: (f) => f.reservation_policy != null && f.reservation_policy !== 'unknown',
  },
]

/** City options come from the rows in view, so a new metro's cities need no code change. */
export function buildCityFacet(facilities: FacilityListItem[]): FacetDef {
  const cities = [...new Set(facilities.map((f) => f.city).filter((c): c is string => !!c))]
    .sort((a, b) => a.localeCompare(b))
  return {
    key: 'city',
    label: 'City',
    options: cities.map((city) => ({
      value: citySlug(city),
      label: city,
      match: (f: FacilityListItem) => f.city === city,
    })),
    known: (f) => f.city != null,
  }
}

/** Same algorithm as metro slugs — one implementation, so 'Sun City West' slugs identically both places. */
export const citySlug = metroSlug

export function facetsFor(facilities: FacilityListItem[]): FacetDef[] {
  return [...STATIC_FACETS, buildCityFacet(facilities)]
}

// ---------- selection + URL ----------

export type Selection = Partial<Record<FacetKey, string[]>>

export type SortKey = 'default' | 'courts'

/**
 * Parse ?fee=free,fee&access=public&sort=courts. Values are validated against the facet definitions,
 * so anything unrecognized is dropped — the param space stays bounded and there is no injection
 * surface (nothing here reaches SQL; filtering is in-memory).
 */
export function parseSelection(
  searchParams: Record<string, string | string[] | undefined>,
  facets: FacetDef[]
): Selection {
  const selection: Selection = {}
  for (const facet of facets) {
    const raw = searchParams[facet.key]
    const value = Array.isArray(raw) ? raw.join(',') : raw
    if (!value) continue
    const allowed = new Set(facet.options.map((o) => o.value))
    const picked = value.split(',').map((v) => v.trim().toLowerCase()).filter((v) => allowed.has(v))
    const deduped = [...new Set(picked)]
    if (deduped.length > 0) selection[facet.key] = deduped
  }
  return selection
}

export function parseSort(searchParams: Record<string, string | string[] | undefined>): SortKey {
  const raw = searchParams.sort
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'courts' ? 'courts' : 'default'
}

export function hasFilters(selection: Selection): boolean {
  return Object.values(selection).some((v) => v && v.length > 0)
}

export function countFilters(selection: Selection): number {
  return Object.values(selection).reduce((n, v) => n + (v?.length ?? 0), 0)
}

/** Serialize selection (+ optional sort) back to a query string. Stable key order = stable URLs. */
export function toQueryString(selection: Selection, facets: FacetDef[], sort: SortKey = 'default'): string {
  const params = new URLSearchParams()
  for (const facet of facets) {
    const picked = selection[facet.key]
    if (!picked || picked.length === 0) continue
    // Preserve definition order rather than click order, so the same filter set is one URL.
    const ordered = facet.options.filter((o) => picked.includes(o.value)).map((o) => o.value)
    params.set(facet.key, ordered.join(','))
  }
  if (sort === 'courts') params.set('sort', 'courts')
  return params.toString()
}

/** Selection with one option toggled — the href behind every chip. */
export function toggle(selection: Selection, key: FacetKey, value: string): Selection {
  const current = selection[key] ?? []
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  const updated: Selection = { ...selection }
  if (next.length === 0) delete updated[key]
  else updated[key] = next
  return updated
}

export function hrefFor(basePath: string, selection: Selection, facets: FacetDef[], sort: SortKey = 'default'): string {
  const qs = toQueryString(selection, facets, sort)
  return qs ? `${basePath}?${qs}` : basePath
}

// ---------- filtering + counting ----------

function matchesFacet(facility: FacilityListItem, facet: FacetDef, picked: string[]): boolean {
  // OR within a facet, AND across facets.
  return facet.options.some((o) => picked.includes(o.value) && o.match(facility))
}

export function applySelection(
  facilities: FacilityListItem[],
  selection: Selection,
  facets: FacetDef[],
  opts: { except?: FacetKey } = {}
): FacilityListItem[] {
  return facilities.filter((facility) =>
    facets.every((facet) => {
      if (facet.key === opts.except) return true
      const picked = selection[facet.key]
      if (!picked || picked.length === 0) return true
      return matchesFacet(facility, facet, picked)
    })
  )
}

export type FacetOptionView = { value: string; label: string; count: number; selected: boolean }

export type FacetView = {
  key: FacetKey
  label: string
  options: FacetOptionView[]
  /** Rows in this metro with an affirmative value for this facet. */
  knownCount: number
  /** Rows in this metro, period. knownCount < totalCount ⇒ render the coverage line. */
  totalCount: number
}

/**
 * Build the rendered facet state.
 *
 * Counts are computed against rows filtered by all OTHER facets, so a count is exactly what you get
 * if you click it — never a promise the page can't keep.
 *
 * A facet with fewer than two options that have a non-zero count is dropped: a control that can only
 * ever return one bucket is noise. This is data-driven, so a metro with thin coverage (Reno's
 * fee_type is 48% filled vs Phoenix's 100%) adapts on its own, with no per-metro code.
 */
export function buildFacetViews(
  facilities: FacilityListItem[],
  selection: Selection,
  facets: FacetDef[]
): FacetView[] {
  const views: FacetView[] = []
  for (const facet of facets) {
    const base = applySelection(facilities, selection, facets, { except: facet.key })
    const options = facet.options.map((option) => ({
      value: option.value,
      label: option.label,
      count: base.filter((f) => option.match(f)).length,
      selected: (selection[facet.key] ?? []).includes(option.value),
    }))
    const usable = options.filter((o) => o.count > 0 || o.selected)
    if (usable.filter((o) => o.count > 0).length < 2) continue
    views.push({
      key: facet.key,
      label: facet.label,
      options: usable,
      knownCount: facilities.filter((f) => facet.known(f)).length,
      totalCount: facilities.length,
    })
  }
  return views
}

// ---------- sorting ----------

export type SortedFacilities = {
  known: FacilityListItem[]
  /** Only populated for sort=courts — rendered under an explicit "not confirmed" heading. */
  unconfirmed: FacilityListItem[]
}

/**
 * court_count is 67% filled site-wide (63% in Phoenix), so it is a SORT, not a facet: a range filter
 * would silently hide a third of Phoenix behind a control that looks comprehensive. Sorting keeps
 * every row on the page — rows without a confirmed count move to a labeled section instead of
 * vanishing or being implied to have zero courts.
 */
export function sortFacilities(facilities: FacilityListItem[], sort: SortKey): SortedFacilities {
  if (sort !== 'courts') return { known: facilities, unconfirmed: [] }
  const known = facilities.filter((f) => f.court_count != null)
  const unconfirmed = facilities.filter((f) => f.court_count == null)
  known.sort((a, b) => (b.court_count ?? 0) - (a.court_count ?? 0) || a.name.localeCompare(b.name))
  unconfirmed.sort((a, b) => a.name.localeCompare(b.name))
  return { known, unconfirmed }
}

/** Group by city for the default view. Cities alphabetical, "Other" last. */
export function groupByCity(facilities: FacilityListItem[]): { city: string; facilities: FacilityListItem[] }[] {
  const groups = new Map<string, FacilityListItem[]>()
  for (const facility of facilities) {
    const key = facility.city || 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(facility)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : a[0].localeCompare(b[0])))
    .map(([city, list]) => ({ city, facilities: list }))
}
