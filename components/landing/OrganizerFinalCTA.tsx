const DEMO_URL = 'https://calendly.com/martysuidgeest/30-minute-zoom-with-marty'

export default function OrganizerFinalCTA() {
  return (
    <section className="py-14 md:py-24 bg-brand-dark">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <h2 className="font-heading text-xl sm:text-2xl font-extrabold text-white mb-4">
          Ready to run your next event with less chaos?
        </h2>

        <p className="text-white/70 text-sm sm:text-base max-w-md mx-auto mb-8">
          See how Joinzer fits your tournaments, leagues, or clinics. Book a quick Zoom and we&apos;ll walk you through the platform for your format.
        </p>

        <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mb-4">
          <a
            href="/login?mode=signup&intent=organize"
            className="w-full sm:w-auto bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm shadow-sm text-center"
          >
            Start free — create your first event
          </a>
          <a
            href={DEMO_URL}
            className="w-full sm:w-auto bg-white/10 text-white font-semibold px-8 py-4 rounded-xl hover:bg-white/20 transition-colors text-sm text-center ring-1 ring-white/20"
          >
            Schedule a Demo
          </a>
        </div>

        <p className="text-white/40 text-xs">
          Free to start, no commitment — or book a Calendly walkthrough.
        </p>
      </div>
    </section>
  )
}
