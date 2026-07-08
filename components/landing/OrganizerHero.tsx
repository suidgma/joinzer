const DEMO_URL = 'https://calendly.com/martysuidgeest/30-minute-zoom-with-marty'

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
          Joinzer is built for the people running pickleball — from weekly leagues to tournament day. Replace spreadsheets, scattered communication, and manual coordination with one organized system.
        </p>

        <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mb-4">
          <a
            href="/login?mode=signup&intent=organize"
            className="w-full sm:w-auto bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover transition-colors text-sm text-center shadow-sm"
          >
            Start free — create your first event
          </a>
          <a
            href={DEMO_URL}
            className="w-full sm:w-auto bg-brand-dark text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-dark/90 transition-colors text-sm text-center shadow-sm"
          >
            Schedule a Demo
          </a>
        </div>

        <p className="text-xs text-brand-muted">
          Free to start — set up a league or tournament in minutes. Or grab a time on Calendly for a walkthrough.
        </p>
      </div>
    </section>
  )
}
