import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/utils/site-url'

// The site had no robots rules before. Allow crawling of public content, keep API + authed app
// surfaces out, and advertise the sitemap for discovery.
//
// The sitemap URL resolves from the same source as metadataBase and app/sitemap.ts, so the host
// we advertise and the host we declare canonical cannot disagree.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  }
}
