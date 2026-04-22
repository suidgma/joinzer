const benefits = [
  {
    title: 'Discover games faster',
    description: 'Stop relying on scattered texts, word of mouth, or last-minute coordination.',
  },
  {
    title: 'Play with more confidence',
    description: "Know where you're going and what session you're joining before you commit.",
  },
  {
    title: 'Meet more local players',
    description: 'Make it easier to find new games, new courts, and new connections.',
  },
  {
    title: 'Spend more time playing',
    description: 'Less friction, less confusion, more time on the court.',
  },
]

export default function FeaturesSection() {
  return (
    <section className="py-14 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center gap-10 md:gap-16">

          {/* Image — above text on mobile */}
          <div className="w-full md:flex-shrink-0 md:max-w-lg order-1 md:order-2">
            <div className="rounded-2xl overflow-hidden shadow-md aspect-[4/3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/benefits.jpg.png"
                alt="Players enjoying a pickleball game"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Value list — below image on mobile */}
          <div className="flex-1 order-2 md:order-1">
            <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark mb-8">
              Why players use Joinzer
            </h2>

            <div className="space-y-6">
              {benefits.map((item) => (
                <div key={item.title} className="flex gap-4">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-brand flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-brand-dark" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-brand-dark text-base mb-1">{item.title}</h3>
                    <p className="text-brand-muted text-sm leading-relaxed">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
