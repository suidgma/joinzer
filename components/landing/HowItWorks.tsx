const steps = [
  {
    number: 1,
    title: 'Find a session',
    description: 'Browse local pickleball games near you by location, time, and session details.',
  },
  {
    number: 2,
    title: 'Check the details',
    description: 'See the court, schedule, and important information before you join.',
  },
  {
    number: 3,
    title: 'Join and play',
    description: 'Connect with local players and jump into sessions that fit your schedule.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-14 md:py-24 bg-brand-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 md:mb-14">
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark">
            How Joinzer works
          </h2>
          <p className="mt-3 text-brand-muted text-sm sm:text-base max-w-xl mx-auto">
            From finding a game to getting on the court, the process is simple.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
          {steps.map((step) => (
            <div
              key={step.number}
              className="bg-white rounded-2xl border border-brand-border p-6 flex flex-col gap-4 shadow-sm"
            >
              <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center shrink-0">
                <span className="font-heading font-extrabold text-brand-dark text-sm">{step.number}</span>
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
