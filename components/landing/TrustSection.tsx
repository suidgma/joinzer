import Link from 'next/link'

const points = [
  'Discover nearby places to play',
  'Make session planning easier',
  'Connect with players in your area',
]

export default function TrustSection() {
  return (
    <section id="community" className="py-14 md:py-24 bg-brand-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center gap-10 md:gap-16">

          {/* Image — above text on mobile */}
          <div className="w-full md:flex-shrink-0 md:max-w-lg order-1">
            <div className="rounded-2xl overflow-hidden shadow-md aspect-[4/3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/community.jpg.png"
                alt="Local pickleball courts with players"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Text + CTA */}
          <div className="flex-1 order-2">
            <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark mb-4">
              Built for real courts and real local play
            </h2>

            <p className="text-brand-muted text-sm sm:text-base leading-relaxed mb-6">
              Joinzer is designed to make local pickleball more accessible — whether you&apos;re looking for a casual session, a nearby court, or new players to meet.
            </p>

            <ul className="space-y-3 mb-8">
              {points.map((point) => (
                <li key={point} className="flex items-center gap-3 text-sm text-brand-body">
                  <span className="w-5 h-5 rounded-full bg-brand-soft border border-brand flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-brand-active" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                  {point}
                </li>
              ))}
            </ul>

            <Link
              href="/events"
              className="inline-block w-full sm:w-auto text-center bg-brand text-brand-dark font-semibold px-7 py-4 rounded-xl hover:bg-brand-hover transition-colors text-sm"
            >
              Explore Local Games
            </Link>
          </div>

        </div>
      </div>
    </section>
  )
}
