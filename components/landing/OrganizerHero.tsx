import Link from 'next/link'

const DEMO_MAILTO = 'mailto:support@joinzer.com?subject=Organizer%20Demo%20Request'

export default function OrganizerHero() {
  return (
    <section className="bg-white pt-12 pb-14 md:pt-20 md:pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-4">
          For organizers
        </p>

        <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-brand-dark leading-tight mb-6">
          Run your pickleball events<br className="hidden sm:block" />
          <span className="text-brand"> without the chaos.</span>
        </h1>

        <p className="text-brand-muted text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-8">
          Joinzer is built end-to-end for the people running events — not just the players showing up. Replace spreadsheets, group texts, and manual tracking with tools designed for tournament day.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
          <a
            href={DEMO_MAILTO}
            className="w-full sm:w-auto bg-brand-dark text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-dark/90 transition-colors text-sm text-center shadow-sm"
          >
            Request a Demo
          </a>
          <Link
            href="/browse/leagues"
            className="w-full sm:w-auto text-brand-dark font-semibold px-8 py-4 rounded-xl border border-brand-border hover:bg-brand-soft transition-colors text-sm text-center"
          >
            Browse Active Leagues
          </Link>
        </div>

        <p className="text-xs text-brand-muted">
          No commitment. We&apos;ll follow up within 24 hours.
        </p>
      </div>
    </section>
  )
}
