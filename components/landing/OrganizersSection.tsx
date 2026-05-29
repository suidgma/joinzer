import Link from 'next/link'

// Marketing-page section that pitches Joinzer to organizers (league owners,
// tournament directors). The rest of the homepage is player-facing; this is
// the only place organizers see a story written for them.
//
// Placement: after CompeteSection (which markets leagues/tournaments to
// players) and before TrustSection. Light bg to contrast the dark
// CompeteSection above.
//
// Feature bullets reflect what's actually shipped — not aspirational. Keep
// it accurate; an organizer that books a call and finds gaps drops faster
// than one who never books at all.

const features = [
  {
    icon: '🎾',
    title: 'Brackets + scheduler',
    description:
      'Round-robin, pool play, single + double elimination. Fixed or rotating partners. Court and time assignment in one click.',
  },
  {
    icon: '💳',
    title: 'Built-in payments',
    description:
      'Stripe Connect routes registration fees straight to your account. Discount codes. Refunds with reverse-transfer when you need them.',
  },
  {
    icon: '⚡',
    title: 'Day-of tooling',
    description:
      'Live scoring, QR check-in, match reschedule, waitlist auto-promote. Designed for the chaos of tournament day, not the calm of a planning session.',
  },
  {
    icon: '📋',
    title: 'Rosters + comms',
    description:
      'CSV import, partner invites, organizer-to-bracket announcements, sub-request flow. The chasing-people work, automated.',
  },
]

export default function OrganizersSection() {
  return (
    <section id="for-organizers" className="py-14 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="text-center mb-12 md:mb-16">
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">
            For Organizers
          </p>
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark mb-4">
            Run your league or tournament on Joinzer
          </h2>
          <p className="text-brand-muted text-base max-w-2xl mx-auto leading-relaxed">
            Built end-to-end for the people running events — not just the players showing up. Spend less time on spreadsheets and group chats, and more time on the court.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-12 max-w-5xl mx-auto">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-brand-page border border-brand-border rounded-2xl p-6"
            >
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-heading font-bold text-brand-dark text-base mb-2">
                {f.title}
              </h3>
              <p className="text-brand-body text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex justify-center">
          <Link
            href="/login"
            className="w-full sm:w-auto text-center bg-brand text-brand-dark font-semibold px-7 py-4 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm shadow-sm"
          >
            Run your event on Joinzer
          </Link>
        </div>

      </div>
    </section>
  )
}
