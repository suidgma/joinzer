import type { Metadata } from 'next'
import Link from 'next/link'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import OsmAttribution from '@/components/features/directory/OsmAttribution'
import { loadPublishedFacilities } from '@/lib/directory/loadFacilities'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Pickleball Court Directory | Joinzer',
  description: 'Find pickleball courts and facilities — locations, amenities, and directions.',
  alternates: { canonical: '/courts' },
}

const ACCESS_LABEL: Record<string, string> = {
  public: 'Public', private: 'Private', membership: 'Membership', school: 'School', hoa: 'HOA', unknown: '',
}

export default async function CourtsIndexPage() {
  const facilities = await loadPublishedFacilities()

  // Group by city (nulls last) for a scannable index.
  const groups = new Map<string, typeof facilities>()
  for (const f of facilities) {
    const key = f.city || 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }
  const cities = [...groups.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))

  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 md:py-14">
        <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">Court directory</p>
        <h1 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark leading-tight mb-3">Pickleball courts</h1>
        <p className="text-brand-muted text-base mb-10">
          {facilities.length > 0
            ? `${facilities.length} ${facilities.length === 1 ? 'facility' : 'facilities'} — locations, amenities, and directions.`
            : 'Courts are being added — check back soon.'}
        </p>

        {cities.map((city) => (
          <section key={city} className="mb-8">
            <h2 className="font-heading text-lg font-bold text-brand-dark mb-3 pb-2 border-b border-brand-border">{city}</h2>
            <ul className="divide-y divide-brand-border">
              {groups.get(city)!.map((f) => (
                <li key={f.slug}>
                  <Link href={`/courts/${f.slug}`} className="flex items-center justify-between gap-3 py-3 group">
                    <span className="text-sm font-semibold text-brand-dark group-hover:text-brand-active transition-colors">{f.name}</span>
                    <span className="shrink-0 text-xs text-brand-muted">
                      {[f.indoor === true ? 'Indoor' : f.indoor === false ? 'Outdoor' : null, ACCESS_LABEL[f.access_type ?? ''] || null].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="border-t border-brand-border pt-5 mt-6">
          <OsmAttribution />
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
