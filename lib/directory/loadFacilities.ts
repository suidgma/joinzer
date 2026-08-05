import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { metroSlug, type MetroSummary } from './metros'

// Court directory data changes on the order of weeks (organizer-driven publish/unpublish runs), so
// every read below is cached for this long. This is the fix for the 2026-07-29 Hobby-limit outage:
// crawler traffic was re-querying Postgres on every request (facility_listings is deny-all RLS, so
// every read here already went through the service role — see below). One constant, shared with the
// `revalidate` export on app/courts/page.tsx and app/courts/[slug]/page.tsx, so the ISR pages and the
// cached reads that feed the still-searchParams-driven /courts/in/[metro] page go stale in step.
export const DIRECTORY_CACHE_SECONDS = 60 * 60 * 6 // 6 hours

// facility_listings is deny-all RLS, so the directory reads via the service role and renders ONLY
// status='published' rows — that filter IS the publish gate / trust boundary. All columns here are
// non-PII (it's court data), so public rendering is safe.
//
// RENDER-RESTRICTED COLUMNS — do not add these to any select below without a deliberate decision:
//   provenance, website, name_source_url — these carry research source URLs, some of them tier-4
//   aggregator hosts (Pickleheads, 55places, …). ADR-14 permits aggregators as a private research
//   input but bars displaying or republishing them on Joinzer pages. scripts/import-reno-merged.mjs
//   asserts that no aggregator URL reaches website/name_source_url on a PUBLISHED row, but
//   `provenance` carries them by design (it is the evidence trail) — so provenance must never be
//   rendered.
//
// public_notes IS rendered, on /courts/[slug] only, and only through lib/directory/publicNotes.ts
// `visitorNotes()`. It is not render-restricted — measured 2026-08-01, all 530 published values
// carry zero URLs and zero aggregator hostnames, so ADR-14 is not in play — but it is not raw-safe
// either: scripts/lib/workbook-extract.mjs concatenates unmappable enum values onto the end of the
// operator's prose as `field: raw` pairs. Render it through the filter or not at all.
//
// ODbL: rows whose coordinate came from OSM carry provenance.coordinate.licence = 'ODbL…'. Any page
// rendering them must show OpenStreetMap attribution — components/features/directory/
// OsmAttribution.tsx is mounted on /courts, /courts/[slug] and /courts/in/[metro]. Don't remove it.
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/**
 * PostgREST's server-side row cap. An unbounded select stops here and returns NO error and NO
 * indication that anything was withheld — the caller gets exactly this many rows and cannot tell a
 * complete result from a truncated one.
 *
 * THIS IS NOT HYPOTHETICAL. On 2026-08-05 the directory crossed 1000 published rows and every
 * site-wide read below silently truncated: /sitemap.xml served exactly 1000 facility URLs against
 * 1084 published (84 venues invisible to search engines), and loadPublishedMetros aggregated over
 * that same truncated window, so two whole metros — Boise and El Paso — vanished from the metro
 * list and their /courts/in/<slug> pages hard-404'd while the rows sat published in the database.
 * The publish scripts had carried a `>= 1000` guard since the ADR-17 work; the app read path never
 * got one, so the bug was invisible until the corpus grew past the cap.
 */
export const POSTGREST_PAGE_SIZE = 1000

/** Runaway guard. 50 pages = 50,000 rows, far beyond any plausible directory, so tripping this
 *  means the cursor is broken rather than the corpus large. Throws instead of looping forever. */
const MAX_PAGES = 50

type PageResult = { data: unknown; error: { message: string } | null }

/**
 * Reads every row of a query by paging with `.range()` until a page comes back SHORT.
 *
 * The termination rule is the whole point: a FULL page means "there may be more", so it asks again.
 * A loader that issued one request and trusted the row count is exactly what failed above, and it
 * failed silently — so this also stops discarding `error`. Every caller below used to destructure
 * `{ data }` alone, which turned any database failure into an empty array and a silently empty
 * directory. Both failure modes now throw: the next person gets an exception, not an undercount.
 *
 * CALLERS MUST ORDER BY SOMETHING UNIQUE. Pagination over an unstable order can repeat rows on one
 * page and skip them on the next, which would be a subtler version of the same bug. Every call site
 * below ends its ordering with `slug` (unique, not null).
 */
async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult>
): Promise<T[]> {
  const rows: T[] = []
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const from = pageIndex * POSTGREST_PAGE_SIZE
    const { data, error } = await page(from, from + POSTGREST_PAGE_SIZE - 1)
    if (error) throw new Error(`${label}: database read failed — ${error.message}`)
    const batch = (data as T[] | null) ?? []
    rows.push(...batch)
    if (batch.length < POSTGREST_PAGE_SIZE) return rows
  }
  throw new Error(
    `${label}: exceeded ${MAX_PAGES} pages (${MAX_PAGES * POSTGREST_PAGE_SIZE} rows) — refusing to ` +
      `return a possibly-truncated directory. The pagination cursor is almost certainly broken.`
  )
}

export type Enrichment = {
  description?: string
  amenities?: string[]
  whatToKnow?: string[]
  nearby?: string
  faqs?: { q: string; a: string }[]
}

export type FacilityDetail = {
  name: string; slug: string
  city: string | null; state: string | null; zip: string | null; address: string | null
  lat: number | null; lng: number | null
  court_count: number | null; access_type: string | null
  indoor: boolean | null; lighting: boolean | null; surface: string | null
  google_place_id: string | null
  metro_area: string | null
  enrichment: Enrichment | null
  public_notes: string | null
  /** 'high' | 'medium' | 'low' | null. A GENERATED column derived from
   *  provenance.coordinate.precision — see migration 20260804000001. It exists so this loader can
   *  answer "is this pin approximate?" WITHOUT selecting `provenance`, which carries the tier-4
   *  research URLs the render-restricted list below keeps off the client. */
  location_precision: string | null
}

export const loadPublishedFacility = unstable_cache(
  async (slug: string): Promise<FacilityDetail | null> => {
    const { data } = await admin()
      .from('facility_listings')
      .select('name, slug, city, state, zip, address, lat, lng, court_count, access_type, indoor, lighting, surface, google_place_id, metro_area, enrichment, public_notes, location_precision')
      .eq('slug', slug).eq('status', 'published').maybeSingle()
    return (data as FacilityDetail | null) ?? null
  },
  ['directory-facility'],
  { revalidate: DIRECTORY_CACHE_SECONDS, tags: ['directory'] }
)

// Columns the list surfaces render. fee_type / reservation_policy / court_count / metro_area were
// added for the metro landing pages + facet filters; all four are venue facts, none is in the
// render-restricted set above.
//
// IMPORTANT for filtering: fee_type, reservation_policy and access_type all use 'unknown' as a
// STORED value meaning "researched but undetermined" (NULL means "not yet researched" — see
// migration 20260724000002). Neither is a fact. lib/directory/facets.ts enforces that both are
// excluded from every filter bucket; don't reintroduce them as selectable values here or there.
//
// location_precision is a GENERATED column (migration 20260804000001) carrying
// provenance.coordinate.precision. It is selected here so a list row can mark an approximate pin
// before the reader clicks through — telling them only on the detail page would let a metro page
// imply a precision it does not have. It is NOT a facet and must never become one: it describes our
// confidence in our own data, not a property of the venue, so it has no place among filters that
// answer "what is this place like". See lib/directory/facets.ts.
const LIST_COLUMNS =
  'name, slug, city, state, access_type, indoor, fee_type, reservation_policy, court_count, metro_area, location_precision'

export type FacilityListItem = {
  name: string; slug: string
  city: string | null; state: string | null
  access_type: string | null; indoor: boolean | null
  fee_type: string | null; reservation_policy: string | null
  court_count: number | null; metro_area: string | null
  location_precision: string | null
}

export const loadPublishedFacilities = unstable_cache(
  async (): Promise<FacilityListItem[]> =>
    fetchAllRows<FacilityListItem>('loadPublishedFacilities', (from, to) =>
      admin()
        .from('facility_listings')
        .select(LIST_COLUMNS)
        .eq('status', 'published')
        // `slug` is the unique tiebreak pagination needs — city is nullable and names collide, so
        // city+name alone is not a total order and pages could overlap or skip.
        .order('city', { nullsFirst: false }).order('name').order('slug')
        .range(from, to)
    ),
  ['directory-facilities'],
  { revalidate: DIRECTORY_CACHE_SECONDS, tags: ['directory'] }
)

/** Rows for one metro landing page. metro_area matched exactly (it is the stored display value). */
export const loadPublishedFacilitiesByMetro = unstable_cache(
  async (metroArea: string): Promise<FacilityListItem[]> => {
    const { data } = await admin()
      .from('facility_listings')
      .select(LIST_COLUMNS)
      .eq('status', 'published').eq('metro_area', metroArea)
      .order('city', { nullsFirst: false }).order('name')
    return (data as FacilityListItem[] | null) ?? []
  },
  ['directory-facilities-by-metro'],
  { revalidate: DIRECTORY_CACHE_SECONDS, tags: ['directory'] }
)

/**
 * Published rows with no metro. Zero today, but /courts renders them in an "Other" section so a
 * future published row can never be orphaned from the index just for lacking a metro_area.
 */
export const loadPublishedFacilitiesWithoutMetro = unstable_cache(
  async (): Promise<FacilityListItem[]> => {
    const { data } = await admin()
      .from('facility_listings')
      .select(LIST_COLUMNS)
      .eq('status', 'published').is('metro_area', null)
      .order('city', { nullsFirst: false }).order('name')
    return (data as FacilityListItem[] | null) ?? []
  },
  ['directory-facilities-without-metro'],
  { revalidate: DIRECTORY_CACHE_SECONDS, tags: ['directory'] }
)

/**
 * Distinct published metros, aggregated in JS (205 rows site-wide — a GROUP BY round trip buys
 * nothing at this scale). Drives the /courts hub, the metro routes and the sitemap from one
 * source, so publishing a new metro_area makes all three appear with no deploy.
 *
 * ...but only after the 'directory' tag is revalidated. This value gates /courts/in/[metro]:
 * findMetro() misses on a stale snapshot and the page calls notFound(), so a metro published inside
 * the 6h window hard-404s while the hub already links to it (2026-07-30). Publishes must POST to
 * /api/revalidate-directory — scripts/lib/revalidate-directory.mjs does this automatically.
 *
 * These entries are also NOT shared across routes: on 2026-07-31 this same function was serving
 * /sitemap.xml a 5-metro snapshot and /courts/in/[metro] a 3-metro snapshot at the same instant.
 * Do not reason about "the" cache entry — invalidate by tag, which clears all of them.
 */
export const loadPublishedMetros = unstable_cache(
  async (): Promise<MetroSummary[]> => {
    const rows = await fetchAllRows<{ metro_area: string; state: string | null }>(
      'loadPublishedMetros',
      (from, to) =>
        admin()
          .from('facility_listings')
          .select('metro_area, state')
          .eq('status', 'published').not('metro_area', 'is', null)
          .order('slug')
          .range(from, to)
    )
    const byMetro = new Map<string, { states: Map<string, number>; count: number }>()
    for (const row of rows) {
      let entry = byMetro.get(row.metro_area)
      if (!entry) { entry = { states: new Map(), count: 0 }; byMetro.set(row.metro_area, entry) }
      entry.count += 1
      if (row.state) entry.states.set(row.state, (entry.states.get(row.state) ?? 0) + 1)
    }

    return [...byMetro.entries()]
      .map(([metro_area, entry]) => ({
        metro_area,
        // Modal state — metros are single-state today, but one straddling a border (a Kansas City)
        // shouldn't get an arbitrary label.
        state: [...entry.states.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        slug: metroSlug(metro_area),
        count: entry.count,
      }))
      .sort((a, b) => b.count - a.count || a.metro_area.localeCompare(b.metro_area))
  },
  ['directory-metros'],
  { revalidate: DIRECTORY_CACHE_SECONDS, tags: ['directory'] }
)

export const loadPublishedSlugs = unstable_cache(
  async (): Promise<{ slug: string; updated_at: string | null }[]> =>
    fetchAllRows<{ slug: string; updated_at: string | null }>('loadPublishedSlugs', (from, to) =>
      admin()
        .from('facility_listings')
        .select('slug, updated_at')
        .eq('status', 'published')
        .order('slug')
        .range(from, to)
    ),
  ['directory-slugs'],
  { revalidate: DIRECTORY_CACHE_SECONDS, tags: ['directory'] }
)
