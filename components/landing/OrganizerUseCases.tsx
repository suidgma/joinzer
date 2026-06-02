const useCases = [
  {
    icon: '🎾',
    title: 'Open Play',
    description: 'Recurring drop-in sessions with caps, waitlists, and one-tap player joins.',
  },
  {
    icon: '🔄',
    title: 'Round Robins',
    description: 'Automated court rotation and match scheduling for organized, repeatable competitive play.',
  },
  {
    icon: '🏅',
    title: 'Leagues',
    description: 'Season-long play with persistent rosters, weekly matchups, standings, and sub management.',
  },
  {
    icon: '📋',
    title: 'Clinics',
    description: 'Structured sessions with registration limits, skill targeting, and player communication.',
  },
  {
    icon: '🏆',
    title: 'Tournaments',
    description: 'Divisions, brackets, registrations, check-in, live scoring, and event-day control.',
  },
  {
    icon: '🏟️',
    title: 'Facilities',
    description: 'One organizer account for operators running multiple formats, programs, and events.',
  },
]

export default function OrganizerUseCases() {
  return (
    <section className="py-14 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">
            Organizer types
          </p>
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark">
            Built for every type of organizer
          </h2>
          <p className="mt-3 text-brand-muted text-sm sm:text-base max-w-2xl mx-auto">
            Whether you run weekly open play, seasonal leagues, clinics, or full tournament brackets, Joinzer is built around your workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {useCases.map((uc) => (
            <div
              key={uc.title}
              className="bg-brand-page rounded-2xl border border-brand-border p-6 flex flex-col gap-3"
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
