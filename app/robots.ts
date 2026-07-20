import type { MetadataRoute } from 'next'

// The site had no robots rules before. Allow crawling of public content, keep API + authed app
// surfaces out, and advertise the sitemap for discovery.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: 'https://www.joinzer.com/sitemap.xml',
  }
}
