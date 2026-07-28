import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import OsmAttribution from '@/components/features/directory/OsmAttribution'
import FacetPanel, { ActiveFilters } from '@/components/features/directory/FacetPanel'
import FacilityRows from '@/components/features/directory/FacilityRows'
import { loadPublishedMetros, loadPublishedFacilitiesByMetro } from '@/lib/directory/loadFacilities'
import { findMetro, metroLabel } from '@/lib/directory/metros'
import {
  facetsFor, parseSelection, parseSort, applySelection, buildFacetViews, sortFacilities,
  groupByCity, hasFilters, hrefFor, citySlug,
} from '@/lib/directory/facets'

// Route is /courts/in/[metro], not /courts/[metro] — see lib/directory/metros.ts for why the
// namespace is kept separate from facility slugs. Middleware already allowlists all of /courts.
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ metro: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const BASE = 'https://www.joinzer.com'

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { metro: slug } = await params
  const metro = findMetro(await loadPublishedMetros(), slug)
  if (!metro) return { title: 'Pickleball Courts — Joinzer' }

  const where = metroLabel(metro)
  const facilities = await loadPublishedFacilitiesByMetro(metro.metro_area)
  const cities = [...new Set(facilities.map((f) => f.city).filter(Boolean))].slice(0, 3).join(', ')

  const params_ = await searchParams
  const facets = facetsFor(facilities)
  const filtered = hasFilters(parseSelection(params_, facets)) || parseSort(params_) !== 'default'

  return {
    title: `Pickleball Courts in ${where} — ${metro.count} Places to Play | Joinzer`,
    description:
      `${metro.count} pickleball courts and facilities across ${cities || where}. ` +
      'Access, fees, indoor or outdoor, and directions.',
    alternates: { canonical: `/courts/in/${metro.slug}` },
    openGraph: {
      title: `Pickleball Courts in ${where} | Joinzer`,
      description: `${metro.count} pickleball courts and facilities in the ${metro.metro_area} area.`,
      type: 'website',
    },
    // Faceted navigation is a crawl trap: every filter combination is a distinct URL. The clean
    // metro page is the indexable one; filtered views are noindex,follow so link equity still flows
    // through to facility pages. Self-canonical throughout — a cross-URL canonical combined with
    // noindex is a conflicting signal. Filtered URLs are also kept out of the sitemap.
    robots: filtered ? { index: false, follow: true } : undefined,
  }
}

export default async function MetroCourtsPage({ params, searchParams }: Props) {
  const { metro: slug } = await params
  const metro = findMetro(await loadPublishedMetros(), slug)
  if (!metro) notFound()

  const params_ = await searchParams
  const all = await loadPublishedFacilitiesByMetro(metro.metro_area)
  const facets = facetsFor(all)
  const selection = parseSelection(params_, facets)
  const sort = parseSort(params_)

  const basePath = `/courts/in/${metro.slug}`
  const views = buildFacetViews(all, selection, facets)
  const matched = applySelection(all, selection, facets)
  const { known, unconfirmed } = sortFacilities(matched, sort)
  const filtering = hasFilters(selection)
  const where = metroLabel(metro)

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Pickleball courts', item: `${BASE}/courts` },
      { '@type': 'ListItem', position: 2, name: where, item: `${BASE}${basePath}` },
    ],
  }

  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 md:py-14">
        <nav className="text-xs text-brand-muted mb-5">
          <Link href="/courts" className="hover:text-brand-dark">Courts</Link>
          <span> · {where}</span>
        </nav>

        <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">Court directory</p>
        <h1 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark leading-tight mb-3">
          Pickleball courts in {metro.metro_area}
        </h1>
        <p className="text-brand-muted text-base mb-8">
          {metro.count} {metro.count === 1 ? 'facility' : 'facilities'} in the {where} area — locations, access, and directions.
        </p>

        <FacetPanel basePath={basePath} views={views} selection={selection} facets={facets} sort={sort} />
        <ActiveFilters basePath={basePath} views={views} selection={selection} facets={facets} sort={sort} />

        {/* Results header states only what is true of the matched rows. It never characterizes the
            rows that did NOT match — those are excluded for lack of a confirmed value as often as
            for holding a different one. */}
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <p className="text-sm font-semibold text-brand-dark">
            {filtering
              ? `${matched.length} of ${all.length} ${all.length === 1 ? 'facility' : 'facilities'} match`
              : `${all.length} ${all.length === 1 ? 'facility' : 'facilities'}`}
          </p>
          {matched.length > 1 && (
            <div className="inline-flex rounded-full border border-brand-border bg-white p-0.5 text-xs font-semibold">
              <Link
                href={hrefFor(basePath, selection, facets, 'default')}
                aria-current={sort === 'default' ? 'page' : undefined}
                className={`px-3 py-1 rounded-full transition-colors ${sort === 'default' ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'}`}
              >
                By city
              </Link>
              <Link
                href={hrefFor(basePath, selection, facets, 'courts')}
                aria-current={sort === 'courts' ? 'page' : undefined}
                className={`px-3 py-1 rounded-full transition-colors ${sort === 'courts' ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'}`}
              >
                Most courts
              </Link>
            </div>
          )}
        </div>

        {matched.length === 0 ? (
          // Empty-state copy must not imply a negative. "No courts match these filters" is a
          // statement about the filter set; "there are no free courts here" would be a claim about
          // rows we may simply not have researched.
          <div className="border border-brand-border rounded-xl bg-brand-soft/40 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-brand-dark mb-1">No courts match these filters.</p>
            <p className="text-sm text-brand-muted mb-4">
              Some details aren&apos;t confirmed for every facility yet, so a filter can narrow the list further than you expect.
            </p>
            <Link href={basePath} className="text-sm font-semibold text-brand-active hover:text-brand-dark underline underline-offset-2">
              Clear filters
            </Link>
          </div>
        ) : sort === 'courts' ? (
          <>
            <FacilityRows facilities={known} showCourtCount />
            {unconfirmed.length > 0 && (
              <section className="mt-8">
                <h2 className="font-heading text-lg font-bold text-brand-dark mb-1 pb-2 border-b border-brand-border">
                  Court count not confirmed
                </h2>
                <p className="text-xs text-brand-muted mt-2 mb-1">
                  {/* Template literal, not JSX interpolation + trailing text: a text node that
                      follows an expression and is the element's last child loses its leading space
                      to JSX whitespace trimming ("2 facilitieswe haven't…"). */}
                  {`${unconfirmed.length} ${unconfirmed.length === 1 ? 'facility' : 'facilities'} we haven't confirmed a count for yet.`}
                </p>
                <FacilityRows facilities={unconfirmed} />
              </section>
            )}
          </>
        ) : (
          <>
            {groupByCity(matched).length > 1 && (
              <nav aria-label="Jump to city" className="flex flex-wrap gap-x-3 gap-y-1 mb-6 pb-5 border-b border-brand-border">
                {groupByCity(matched).map((group) => (
                  <a key={group.city} href={`#${citySlug(group.city)}`} className="text-xs text-brand-active hover:text-brand-dark">
                    {group.city} <span className="text-brand-muted">({group.facilities.length})</span>
                  </a>
                ))}
              </nav>
            )}
            {groupByCity(matched).map((group) => (
              <section key={group.city} id={citySlug(group.city)} className="mb-8 scroll-mt-4">
                <h2 className="font-heading text-lg font-bold text-brand-dark mb-3 pb-2 border-b border-brand-border">{group.city}</h2>
                <FacilityRows facilities={group.facilities} />
              </section>
            ))}
          </>
        )}

        <div className="border-t border-brand-border pt-5 mt-6 space-y-3">
          <OsmAttribution />
          <Link href="/courts" className="inline-block text-sm font-semibold text-brand-active hover:text-brand-dark">← All metros</Link>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
