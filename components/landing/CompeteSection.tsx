import Link from 'next/link'

const features = [
  {
    icon: '🏆',
    title: 'Leagues',
    description: 'Register for local round-robin leagues, track standings, and get notified when sub spots open up.',
  },
  {
    icon: '🎯',
    title: 'Tournaments',
    description: 'Browse and register for local tournaments across all skill levels and event categories.',
  },
  {
    icon: '📊',
    title: 'Standings',
    description: 'Win/loss records calculated automatically as match results are entered after each session.',
  },
  {
    icon: '🔄',
    title: 'Sub System',
    description: "Can't make a league session? Mark yourself available to sub. Managers see who's ready to fill in.",
  },
]

export default function CompeteSection() {
  return (
    <section className="py-14 md:py-24 bg-[#012D0B]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-brand text-sm font-semibold uppercase tracking-widest mb-3">Competitive Play</p>
          <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-white mb-4">
            Leagues & Tournaments, all in one place
          </h2>
          <p className="text-gray-300 text-base max-w-xl mx-auto">
            Joinzer is now the home for organized pickleball in Las Vegas — from weekly round-robins to full tournaments.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
          {features.map((f) => (
            <div key={f.title} className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-heading font-bold text-white text-base mb-2">{f.title}</h3>
              <p className="text-gray-300 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/compete"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover transition-colors"
          >
            Browse Leagues & Tournaments
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-white/20 text-white font-semibold text-sm hover:bg-white/10 transition-colors"
          >
            Create a free account
          </Link>
        </div>
      </div>
    </section>
  )
}
