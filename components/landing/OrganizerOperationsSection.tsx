const nowPoints = [
  'Tracking registrations across texts, emails, and DMs',
  'Chasing payments from confirmed players',
  'Building brackets and schedules by hand',
  'Coordinating partners, waitlists, and last-minute subs',
  'Sending event-day updates across multiple group chats',
]

const joinzerPoints = [
  'Registrations, payments, scheduling, and communication in one place',
  'One organizer dashboard',
  'Built-in registrations and payments',
  'Brackets, scheduling, and updates in one workflow',
  'Fewer tools, fewer mistakes, less chasing people',
]

export default function OrganizerOperationsSection() {
  return (
    <section className="py-14 md:py-24 bg-brand-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="text-center mb-10 md:mb-14">
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark">
            Before and after Joinzer
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* NOW — problem state */}
          <div className="bg-white rounded-2xl border border-brand-border p-7 flex flex-col gap-5">
            <div>
              <p className="text-xs font-bold text-brand-muted uppercase tracking-widest mb-3">Now</p>
              <p className="text-sm text-brand-body leading-relaxed">
                Most organizers are still piecing events together across spreadsheets, texts, payment tools, and group chats.
              </p>
            </div>
            <ul className="space-y-3">
              {nowPoints.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-brand-body">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-brand-border flex items-center justify-center shrink-0 text-brand-muted text-[9px] font-bold leading-none">
                    ✕
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* WITH JOINZER — solution state */}
          <div className="bg-brand-dark rounded-2xl p-7 flex flex-col gap-5">
            <div>
              <p className="text-xs font-bold text-brand/80 uppercase tracking-widest mb-3">With Joinzer</p>
              <p className="text-sm text-white/70 leading-relaxed">
                One place for the tools organizers need.
              </p>
            </div>
            <ul className="space-y-3">
              {joinzerPoints.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-white/90">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-brand/20 flex items-center justify-center shrink-0 text-brand text-[9px] font-bold leading-none">
                    ✓
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </section>
  )
}
