import type { MetadataRoute } from 'next'
import { loadPublishedSlugs, loadPublishedMetros } from '@/lib/directory/loadFacilities'
import { getSiteUrl } from '@/lib/utils/site-url'

// Dynamic so it reflects newly-published courts without a rebuild (pages are force-dynamic too).
export const dynamic = 'force-dynamic'

// One source for the host, shared with metadataBase, robots.ts and the directory JSON-LD. This
// file used to hold its own hardcoded copy — it happened to be right while metadataBase was
// wrong, which is precisely how the two drifted apart without anyone noticing.
const BASE = getSiteUrl()

// The site had no sitemap before this. Covers the key public pages + every published court page
// (the directory's SEO surface). Runs server-side; reads published slugs via the service role.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/organizers`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/for-players`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/browse`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/courts`, changeFrequency: 'weekly', priority: 0.7 },
  ]

  // Metro landing pages, derived from the published metro_area values — a newly published metro
  // appears here with no deploy. Only the clean metro URL is listed; filtered views (?fee=…) are
  // noindex and deliberately absent, since faceted permutations are a crawl trap.
  let metros: MetadataRoute.Sitemap = []
  try {
    const rows = await loadPublishedMetros()
    metros = rows.map((m) => ({
      url: `${BASE}/courts/in/${m.slug}`,
      changeFrequency: 'weekly',
      priority: 0.8,
    }))
  } catch {
    // Fall through — a metro read failure must not cost us the facility URLs below.
  }

  let courts: MetadataRoute.Sitemap = []
  try {
    const rows = await loadPublishedSlugs()
    courts = rows.map((r) => ({
      url: `${BASE}/courts/${r.slug}`,
      lastModified: r.updated_at ? new Date(r.updated_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.5,
    }))
  } catch {
    // If the DB read fails at build/request time, still serve the static portion.
  }

  return [...staticPages, ...metros, ...courts]
}
