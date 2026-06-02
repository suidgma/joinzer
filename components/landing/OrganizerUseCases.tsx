const useCases = [
  {
    icon: '🎾',
    title: 'Open Play',
    description: 'Recurring drop-in sessions with cap management, automated waitlists, and one-tap player joins.',
  },
  {
    icon: '🔄',
    title: 'Round Robins',
    description: 'Automated court rotation and match scheduling. Keeps casual events competitive without manual tracking.',
  },
  {
    icon: '🏅',
    title: 'Leagues',
    description: 'Seasonal play with persistent rosters, weekly sessions, standings, and a sub pool for absent players.',
  },
  {
    icon: '📋',
    title: 'Clinics',
    description: 'Structured instruction events with registration limits, skill-range targeting, and player communication.',
  },
  {
    icon: '🏆',
    title: 'Tournaments',
    description: 'Full tournament management: divisions, registrations, brackets, QR check-in, and live scoring.',
  },
  {
    icon: '🏟️',
    title: 'Facilities',
    description: 'Court operators running multiple formats across multiple programs — all under one organizer account.',
  },
]

export default function OrganizerUseCases() {
  return (
    <section className="py-14 md:py-24 bg-brand-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">
            What you can run
          </p>
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark">
            Built for every format
          </h2>
          <p className="mt-3 text-brand-muted text-sm sm:text-base max-w-xl mx-auto">
            Whether you run a casual weekly drill or a full tournament bracket, Joinzer has the tooling for it.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {useCases.map((uc) => (
            <div
              key={uc.title}
              className="bg-white rounded-2xl border border-brand-border p-6 flex flex-col gap-3"
            >
              <span className="text-2xl">{uc.icon}</span>
              <h3 className="font-heading font-bold text-brand-dark text-base">{uc.title}</h3>
              <p className="text-brand-muted text-sm leading-relaxed">{uc.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
