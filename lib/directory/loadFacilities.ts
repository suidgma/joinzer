import { createClient } from '@supabase/supabase-js'

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
// OsmAttribution.tsx is mounted on both /courts and /courts/[slug]. Don't remove it.
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

export type FacilityListItem = { name: string; slug: string; city: string | null; state: string | null; access_type: string | null; indoor: boolean | null }

export async function loadPublishedFacilities(): Promise<FacilityListItem[]> {
  const { data } = await admin()
    .from('facility_listings')
    .select('name, slug, city, state, access_type, indoor')
    .eq('status', 'published').order('city', { nullsFirst: false }).order('name')
  return (data as FacilityListItem[] | null) ?? []
}

export async function loadPublishedSlugs(): Promise<{ slug: string; updated_at: string | null }[]> {
  const { data } = await admin().from('facility_listings').select('slug, updated_at').eq('status', 'published')
  return (data as { slug: string; updated_at: string | null }[] | null) ?? []
}
