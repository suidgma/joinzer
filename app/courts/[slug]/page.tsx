import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'
import OsmAttribution from '@/components/features/directory/OsmAttribution'
import { loadPublishedFacility } from '@/lib/directory/loadFacilities'
import { mapsUrl } from '@/lib/directory/mapsUrl'

export const dynamic = 'force-dynamic'

const ACCESS_LABEL: Record<string, string> = {
  public: 'Public', private: 'Private', membership: 'Membership', school: 'School', hoa: 'HOA', unknown: 'Access varies',
}

type Params = { params: Promise<{ slug: string }> }

function place(f: { city: string | null; state: string | null }) {
  return [f.city, f.state].filter(Boolean).join(', ')
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const f = await loadPublishedFacility(slug)
  if (!f) return { title: 'Pickleball Court — Joinzer' }
  const where = place(f)
  const title = `${f.name} — Pickleball${where ? ` in ${where}` : ''} | Joinzer`
  const description = (f.enrichment?.description || `${f.name}${where ? ` in ${where}` : ''} — a pickleball facility. Location, details, and directions on Joinzer.`).slice(0, 200)
  return {
    title,
    description,
    alternates: { canonical: `/courts/${slug}` },
    openGraph: { title, description, type: 'website' },
  }
}

function Facts({ f }: { f: Awaited<ReturnType<typeof loadPublishedFacility>> }) {
  if (!f) return null
  const facts: string[] = []
  if (f.access_type && ACCESS_LABEL[f.access_type]) facts.push(ACCESS_LABEL[f.access_type])
  if (f.indoor === true) facts.push('Indoor'); else if (f.indoor === false) facts.push('Outdoor')
  if (f.court_count) facts.push(`${f.court_count} court${f.court_count === 1 ? '' : 's'}`)
  if (f.surface) facts.push(`${f.surface[0].toUpperCase()}${f.surface.slice(1)} surface`)
  if (f.lighting === true) facts.push('Lighting')
  if (facts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {facts.map((t) => (
        <span key={t} className="text-xs font-semibold text-brand-active bg-brand-soft border border-brand-border rounded-full px-3 py-1">{t}</span>
      ))}
    </div>
  )
}

export default async function CourtPage({ params }: Params) {
  const { slug } = await params
  const f = await loadPublishedFacility(slug)
  if (!f) notFound()

  const where = place(f)
  const maps = mapsUrl(f.lat, f.lng, f.google_place_id)
  const e = f.enrichment ?? {}

  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 md:py-14">
        <nav className="text-xs text-brand-muted mb-5">
          <Link href="/courts" className="hover:text-brand-dark">Courts</Link>
          {where && <span> · {where}</span>}
        </nav>

        {/* Hero */}
        <header className="mb-6">
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-2">
            Pickleball{where ? ` · ${where}` : ''}
          </p>
          <h1 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark leading-tight text-balance mb-4">{f.name}</h1>
          <Facts f={f} />
          {f.address && <p className="text-sm text-brand-muted mt-4">{f.address}{f.zip ? `, ${f.zip}` : ''}</p>}
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-5 bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl hover:bg-brand-hover transition-colors text-sm">
              View on Google Maps →
            </a>
          )}
        </header>

        {e.description && <p className="text-brand-body text-base md:text-lg leading-relaxed mb-8">{e.description}</p>}

        {e.amenities && e.amenities.length > 0 && (
          <section className="mb-8">
            <h2 className="font-heading text-xl font-bold text-brand-dark mb-3">Amenities</h2>
            <ul className="grid sm:grid-cols-2 gap-2">
              {e.amenities.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-brand-body"><span className="text-brand-active mt-0.5">•</span>{a}</li>
              ))}
            </ul>
          </section>
        )}

        {e.whatToKnow && e.whatToKnow.length > 0 && (
          <section className="mb-8">
            <h2 className="font-heading text-xl font-bold text-brand-dark mb-3">What to know</h2>
            <ul className="space-y-2">
              {e.whatToKnow.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-brand-body"><span className="text-brand-active mt-0.5">•</span>{t}</li>
              ))}
            </ul>
          </section>
        )}

        {e.nearby && (
          <section className="mb-8">
            <h2 className="font-heading text-xl font-bold text-brand-dark mb-3">The area</h2>
            <p className="text-sm md:text-base text-brand-body leading-relaxed">{e.nearby}</p>
          </section>
        )}

        {e.faqs && e.faqs.length > 0 && (
          <section className="mb-8">
            <h2 className="font-heading text-xl font-bold text-brand-dark mb-3">FAQs</h2>
            <div className="space-y-4">
              {e.faqs.map((qa, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold text-brand-dark">{qa.q}</p>
                  <p className="text-sm text-brand-muted mt-0.5">{qa.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="border-t border-brand-border pt-5 mt-10 space-y-3">
          <OsmAttribution />
          <Link href="/courts" className="inline-block text-sm font-semibold text-brand-active hover:text-brand-dark">← All courts</Link>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
