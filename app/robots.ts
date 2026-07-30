import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/utils/site-url'

// The site had no robots rules before. Allow crawling of public content, keep API + authed app
// surfaces out, and advertise the sitemap for discovery.
//
// The sitemap URL resolves from the same source as metadataBase and app/sitemap.ts, so the host
// we advertise and the host we declare canonical cannot disagree.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        // Faceted-nav crawl trap (root cause of the 2026-07-29 Hobby-limit outage): the metro pages
        // at /courts/in/[metro] combine 4 static facets + a per-metro city facet + a sort toggle into
        // a combinatorial query-string space, and every filtered page links to further combinations
        // via its own facet panel — a crawler recursively discovers the whole permutation space. Those
        // URLs already carry `noindex, follow` (see the metro page's generateMetadata), but noindex
        // doesn't stop crawling — a crawler has to fetch the page to see the tag. This Disallow stops
        // it at the door. Scoped by the literal "?": it matches only a /courts/in/<metro> URL carrying
        // a query string, so the canonical unfiltered metro pages and every /courts/[slug] facility
        // page (neither ever appears with a "?") stay fully crawlable — see courts-crawler.spec.ts for
        // the assertion that pins both directions.
        '/courts/in/*?*',
      ],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  }
}
