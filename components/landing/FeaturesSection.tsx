const features = [
  {
    icon: '📍',
    title: 'Local sessions, all in one feed',
    description: 'See every upcoming game in your area — sorted, searchable, and always up to date.',
  },
  {
    icon: '⚡',
    title: 'Instant join or waitlist',
    description: 'One tap to join. If a session fills up, you\'re automatically added to the waitlist and promoted when a spot opens.',
  },
  {
    icon: '🏟️',
    title: 'Court details at a glance',
    description: 'See the number of courts, total capacity, and session duration before you commit to a game.',
  },
  {
    icon: '💬',
    title: 'Built-in group chat',
    description: 'Every session has a real-time chat. Coordinate, confirm, and connect with your group before you hit the court.',
  },
  {
    icon: '👑',
    title: 'Captain tools',
    description: 'Session creators get full control — manage the roster, reassign captain duties, or cancel if plans change.',
  },
  {
    icon: '🎯',
    title: 'DUPR-aware',
    description: 'Add your DUPR rating or a self-estimated level so other players know who they\'re playing with.',
  },
]

export default function FeaturesSection() {
  return (
    <section id="features" className="py-20 md:py-28 bg-white">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-14">
          <p className="text-brand-active text-sm font-semibold uppercase tracking-widest mb-3">Everything you need</p>
          <h2 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark">
            Built for real pickleball players
          </h2>
          <p className="mt-3 text-brand-muted text-base max-w-lg mx-auto">
            No bloat, no complexity. Just the tools that make organizing a game easy.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-brand-border p-6 bg-brand-page hover:bg-white hover:shadow-md hover:border-brand transition-all duration-200"
            >
              <div className="text-3xl mb-4">{feature.icon}</div>
              <h3 className="font-heading font-bold text-brand-dark text-base mb-2">{feature.title}</h3>
              <p className="text-brand-muted text-sm leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
