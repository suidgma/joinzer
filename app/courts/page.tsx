import type { Metadata } from 'next'
import Link from 'next/link'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import OsmAttribution from '@/components/features/directory/OsmAttribution'
import FacilityRows from '@/components/features/directory/FacilityRows'
import { loadPublishedMetros, loadPublishedFacilitiesWithoutMetro } from '@/lib/directory/loadFacilities'
import { metroLabel } from '@/lib/directory/metros'

// No searchParams, no dynamic segment, and nothing in this tree reads cookies()/headers() (LandingNav
// is a client component). Genuinely static — ISR instead of force-dynamic cuts this from a
// per-request Function Invocation to a cached page regenerated at most every 6 hours.
//
// Must be a literal, not an import of DIRECTORY_CACHE_SECONDS (lib/directory/loadFacilities.ts) —
// Next statically parses route segment config exports at build time without executing the module, so
// an imported identifier fails the build ("Invalid segment configuration export detected"). Keep this
// number in sync with DIRECTORY_CACHE_SECONDS by hand.
export const revalidate = 21600 // 6 hours

export const metadata: Metadata = {
  title: 'Pickleball Court Directory | Joinzer',
  description: 'Find pickleball courts and facilities by metro — locations, access, fees, and directions.',
  alternates: { canonical: '/courts' },
}

// Metro hub. Previously this rendered all 205 published rows in one flat list, which mixed metros
// together and gave search engines a single undifferentiated page. Facilities now live under their
// metro (/courts/in/[metro]) — every facility is one click from its metro page and two from here,
// and the sitemap still lists all of them directly.
export default async function CourtsIndexPage() {
  const [metros, orphans] = await Promise.all([
    loadPublishedMetros(),
    // Zero rows today. Rendered anyway so a published row lacking metro_area can never fall out of
    // the index — the one way this hub restructure could silently orphan a page.
    loadPublishedFacilitiesWithoutMetro(),
  ])

  const total = metros.reduce((n, m) => n + m.count, 0) + orphans.length

  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 md:py-14">
        <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">Court directory</p>
        <h1 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark leading-tight mb-3">Pickleball courts</h1>
        <p className="text-brand-muted text-base mb-10">
          {total > 0
            ? `${total} ${total === 1 ? 'facility' : 'facilities'} — locations, amenities, and directions.`
            : 'Courts are being added — check back soon.'}
        </p>

        {metros.length > 0 && (
          <section className="mb-10">
            <h2 className="font-heading text-lg font-bold text-brand-dark mb-3 pb-2 border-b border-brand-border">Browse by metro</h2>
            <ul className="divide-y divide-brand-border">
              {metros.map((metro) => (
                <li key={metro.slug}>
                  <Link href={`/courts/in/${metro.slug}`} className="flex items-center justify-between gap-3 py-4 group">
                    <span className="text-base font-semibold text-brand-dark group-hover:text-brand-active transition-colors">
                      Pickleball courts in {metroLabel(metro)}
                    </span>
                    <span className="shrink-0 text-xs text-brand-muted">
                      {metro.count} {metro.count === 1 ? 'facility' : 'facilities'} →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {orphans.length > 0 && (
          <section className="mb-8">
            <h2 className="font-heading text-lg font-bold text-brand-dark mb-3 pb-2 border-b border-brand-border">Other</h2>
            <FacilityRows facilities={orphans} />
          </section>
        )}

        <div className="border-t border-brand-border pt-5 mt-6">
          <OsmAttribution />
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
