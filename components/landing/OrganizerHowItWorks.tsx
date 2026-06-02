const steps = [
  {
    number: 1,
    title: 'Create your event',
    description: 'Set up divisions, registration fee, skill requirements, and schedule. Takes minutes, not hours.',
  },
  {
    number: 2,
    title: 'Open registrations',
    description: 'Players register and pay through Joinzer. Partner invites, waitlists, and capacity limits are handled automatically.',
  },
  {
    number: 3,
    title: 'Manage it live',
    description: 'On the day: QR check-in, live scoring, court assignment, and match reschedule — all from your phone.',
  },
]

export default function OrganizerHowItWorks() {
  return (
    <section className="py-14 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">
            How it works
          </p>
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark">
            From setup to tournament day
          </h2>
          <p className="mt-3 text-brand-muted text-sm sm:text-base max-w-xl mx-auto">
            Joinzer handles the coordination so you can focus on running a great event.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 max-w-4xl mx-auto">
          {steps.map((step) => (
            <div
              key={step.number}
              className="bg-brand-page rounded-2xl border border-brand-border p-6 flex flex-col gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-brand-dark flex items-center justify-center shrink-0">
                <span className="font-heading font-extrabold text-white text-sm">{step.number}</span>
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
