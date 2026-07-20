import { createClient } from '@supabase/supabase-js'

// facility_listings is deny-all RLS, so the directory reads via the service role and renders ONLY
// status='published' rows — that filter IS the publish gate / trust boundary. All columns here are
// non-PII (it's court data), so public rendering is safe.
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
