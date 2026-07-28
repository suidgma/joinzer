import { createClient } from '@supabase/supabase-js'
import { metroSlug, type MetroSummary } from './metros'

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
//   rendered. (public_notes is operator-sourced and safe; it simply isn't surfaced yet.)
//
// ODbL: rows whose coordinate came from OSM carry provenance.coordinate.licence = 'ODbL…'. Any page
// rendering them must show OpenStreetMap attribution — components/features/directory/
// OsmAttribution.tsx is mounted on /courts, /courts/[slug] and /courts/in/[metro]. Don't remove it.
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
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
}

export async function loadPublishedFacility(slug: string): Promise<FacilityDetail | null> {
  const { data } = await admin()
    .from('facility_listings')
    .select('name, slug, city, state, zip, address, lat, lng, court_count, access_type, indoor, lighting, surface, google_place_id, metro_area, enrichment')
    .eq('slug', slug).eq('status', 'published').maybeSingle()
  return (data as FacilityDetail | null) ?? null
}

// Columns the list surfaces render. fee_type / reservation_policy / court_count / metro_area were
// added for the metro landing pages + facet filters; all four are venue facts, none is in the
// render-restricted set above.
//
// IMPORTANT for filtering: fee_type, reservation_policy and access_type all use 'unknown' as a
// STORED value meaning "researched but undetermined" (NULL means "not yet researched" — see
// migration 20260724000002). Neither is a fact. lib/directory/facets.ts enforces that both are
// excluded from every filter bucket; don't reintroduce them as selectable values here or there.
const LIST_COLUMNS =
  'name, slug, city, state, access_type, indoor, fee_type, reservation_policy, court_count, metro_area'

export type FacilityListItem = {
  name: string; slug: string
  city: string | null; state: string | null
  access_type: string | null; indoor: boolean | null
  fee_type: string | null; reservation_policy: string | null
  court_count: number | null; metro_area: string | null
}

export async function loadPublishedFacilities(): Promise<FacilityListItem[]> {
  const { data } = await admin()
    .from('facility_listings')
    .select(LIST_COLUMNS)
    .eq('status', 'published').order('city', { nullsFirst: false }).order('name')
  return (data as FacilityListItem[] | null) ?? []
}

/** Rows for one metro landing page. metro_area matched exactly (it is the stored display value). */
export async function loadPublishedFacilitiesByMetro(metroArea: string): Promise<FacilityListItem[]> {
  const { data } = await admin()
    .from('facility_listings')
    .select(LIST_COLUMNS)
    .eq('status', 'published').eq('metro_area', metroArea)
    .order('city', { nullsFirst: false }).order('name')
  return (data as FacilityListItem[] | null) ?? []
}

/**
 * Published rows with no metro. Zero today, but /courts renders them in an "Other" section so a
 * future published row can never be orphaned from the index just for lacking a metro_area.
 */
export async function loadPublishedFacilitiesWithoutMetro(): Promise<FacilityListItem[]> {
  const { data } = await admin()
    .from('facility_listings')
    .select(LIST_COLUMNS)
    .eq('status', 'published').is('metro_area', null)
    .order('city', { nullsFirst: false }).order('name')
  return (data as FacilityListItem[] | null) ?? []
}

/**
 * Distinct published metros, aggregated in JS (205 rows site-wide — a GROUP BY round trip buys
 * nothing at this scale). Drives the /courts hub, the metro routes and the sitemap from one
 * source, so publishing a new metro_area makes all three appear with no deploy.
 */
export async function loadPublishedMetros(): Promise<MetroSummary[]> {
  const { data } = await admin()
    .from('facility_listings')
    .select('metro_area, state')
    .eq('status', 'published').not('metro_area', 'is', null)

  const rows = (data as { metro_area: string; state: string | null }[] | null) ?? []
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
}

export async function loadPublishedSlugs(): Promise<{ slug: string; updated_at: string | null }[]> {
  const { data } = await admin().from('facility_listings').select('slug, updated_at').eq('status', 'published')
  return (data as { slug: string; updated_at: string | null }[] | null) ?? []
}
