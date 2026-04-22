const testimonials = [
  {
    quote: "Finally an easy way to find open play without digging through Facebook groups or group texts.",
    name: "Alex R.",
    detail: "4.1 DUPR · Henderson",
  },
  {
    quote: "I created my first session in about 2 minutes. Had 8 players signed up by the next morning.",
    name: "Maria T.",
    detail: "Open play organizer · Summerlin",
  },
  {
    quote: "The waitlist feature is clutch. Got bumped up to a joined spot the morning of a game I almost missed.",
    name: "Derek N.",
    detail: "3.7 DUPR · North Las Vegas",
  },
]

const stats = [
  { value: '65+', label: 'Courts listed in Las Vegas' },
  { value: 'Free', label: 'Always free for players' },
  { value: '1 tap', label: 'To join any open session' },
]

export default function TrustSection() {
  return (
    <section className="py-20 md:py-28 bg-brand-page">
      <div className="max-w-6xl mx-auto px-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 md:gap-8 mb-20">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark">{stat.value}</p>
              <p className="text-brand-muted text-xs md:text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="text-center mb-12">
          <p className="text-brand-active text-sm font-semibold uppercase tracking-widest mb-3">Community first</p>
          <h2 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark">
            Built for Las Vegas pickleball players
          </h2>
          <p className="mt-3 text-brand-muted text-base max-w-lg mx-auto">
            Designed to make organizing games easier, so you spend less time coordinating and more time playing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="bg-white rounded-2xl border border-brand-border p-6 shadow-sm"
            >
              {/* Quote mark */}
              <div className="text-brand text-4xl font-serif leading-none mb-3">&ldquo;</div>
              <p className="text-brand-body text-sm leading-relaxed mb-5">{t.quote}</p>
              <div>
                <p className="font-heading font-semibold text-brand-dark text-sm">{t.name}</p>
                <p className="text-brand-muted text-xs mt-0.5">{t.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
