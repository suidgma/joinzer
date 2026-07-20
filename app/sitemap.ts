import type { MetadataRoute } from 'next'
import { loadPublishedSlugs } from '@/lib/directory/loadFacilities'

// Dynamic so it reflects newly-published courts without a rebuild (pages are force-dynamic too).
export const dynamic = 'force-dynamic'

const BASE = 'https://www.joinzer.com'

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

  return [...staticPages, ...courts]
}
