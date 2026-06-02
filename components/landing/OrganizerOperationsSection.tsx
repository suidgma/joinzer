const painPoints = [
  'Tracking registrations across texts, emails, and DMs',
  'Chasing payments from players you\'ve already confirmed',
  'Building brackets and schedules by hand',
  'Coordinating partners, waitlists, and last-minute subs',
  'Sending event-day updates through a dozen different group chats',
]

export default function OrganizerOperationsSection() {
  return (
    <section className="py-14 md:py-24 bg-brand-page">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* Left: pain → solution */}
          <div className="flex-1 lg:max-w-lg">
            <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-4">
              Sound familiar?
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark mb-4 leading-tight">
              One place for the moving parts
            </h2>
            <p className="text-brand-muted text-sm sm:text-base leading-relaxed mb-8">
              Most organizers piece together event management across multiple tools and channels. Joinzer brings registrations, payments, scheduling, and communication into one system.
            </p>

            <ul className="space-y-3 mb-8">
              {painPoints.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-brand-body">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-white border border-brand-border flex items-center justify-center shrink-0 text-brand-muted text-[10px] font-bold leading-none">
                    ✕
                  </span>
                  {point}
                </li>
              ))}
            </ul>

            <p className="text-sm font-semibold text-brand-dark">
              Joinzer handles all of this in one place.
            </p>
          </div>

          {/* Right: product mock UI — simplified event management view */}
          <div className="w-full lg:w-[420px] lg:shrink-0">
            <div className="bg-brand-dark rounded-2xl p-6 shadow-2xl">

              {/* Event header */}
              <div className="border-b border-white/10 pb-4 mb-5">
                <p className="text-white/40 text-xs uppercase tracking-widest mb-1.5">Active Event</p>
                <p className="font-heading font-bold text-white text-lg leading-snug">
                  LV Mixed Doubles Open
                </p>
                <p className="text-white/50 text-sm mt-0.5">Jun 14 · Henderson Pickleball</p>
              </div>

              {/* Registration progress */}
              <div className="mb-5">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-white/60">Registrations</span>
                  <span className="text-white font-semibold">28 / 32</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div className="bg-brand h-1.5 rounded-full" style={{ width: '87.5%' }} />
                </div>
                <p className="text-white/40 text-xs mt-1.5">4 spots remaining · 3 on waitlist</p>
              </div>

              {/* Payment status grid */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-brand font-bold text-xl leading-none mb-1">18</p>
                  <p className="text-white/50 text-xs">Paid</p>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-brand-yellow font-bold text-xl leading-none mb-1">6</p>
                  <p className="text-white/50 text-xs">Pending</p>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-white/50 font-bold text-xl leading-none mb-1">4</p>
                  <p className="text-white/50 text-xs">Waitlisted</p>
                </div>
              </div>

              {/* Player roster snippet */}
              <div className="space-y-2">
                {[
                  { name: 'J. Smith / M. Chen', status: 'paid' },
                  { name: 'R. Johnson / T. Lee', status: 'pending' },
                  { name: 'A. Davis / K. Park', status: 'paid' },
                  { name: 'S. Williams / B. Torres', status: 'waitlisted' },
                ].map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2"
                  >
                    <span className="text-white/80 text-xs">{row.name}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      row.status === 'paid'
                        ? 'bg-brand/20 text-brand'
                        : row.status === 'pending'
                        ? 'bg-brand-yellow/20 text-brand-yellow'
                        : 'bg-white/10 text-white/40'
                    }`}>
                      {row.status === 'paid'
                        ? '✓ Paid'
                        : row.status === 'pending'
                        ? '· Pending'
                        : '· Waitlisted'}
                    </span>
                  </div>
                ))}
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
