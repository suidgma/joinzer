const steps = [
  {
    number: '01',
    icon: '🔍',
    title: 'Discover local sessions',
    description: 'Browse upcoming pickleball games near you. Filter by date, court count, or skill level.',
  },
  {
    number: '02',
    icon: '✅',
    title: 'Join a game',
    description: 'Tap to join any open session. If it\'s full, hop on the waitlist and get promoted automatically.',
  },
  {
    number: '03',
    icon: '🏓',
    title: 'Create your own',
    description: 'Set a time, pick a court, and invite the community. You\'re the captain — run it your way.',
  },
  {
    number: '04',
    icon: '🤝',
    title: 'Play and connect',
    description: 'Chat with your group before the game, meet new players, and grow your local network.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-28 bg-brand-page">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-14">
          <p className="text-brand-active text-sm font-semibold uppercase tracking-widest mb-3">Simple by design</p>
          <h2 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark">
            How Joinzer works
          </h2>
          <p className="mt-3 text-brand-muted text-base max-w-lg mx-auto">
            From zero to on the court in four easy steps.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step) => (
            <div
              key={step.number}
              className="bg-white rounded-2xl border border-brand-border p-6 flex flex-col gap-4 shadow-sm hover:shadow-md hover:border-brand transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl">{step.icon}</span>
                <span className="font-heading text-3xl font-extrabold text-brand-border">{step.number}</span>
              </div>
              <div>
                <h3 className="font-heading font-bold text-brand-dark text-base mb-1.5">{step.title}</h3>
                <p className="text-brand-muted text-sm leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
