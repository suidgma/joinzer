import Link from 'next/link'
import Image from 'next/image'

export default function RoleSelectorSection() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-white">
      <div className="w-full max-w-4xl mx-auto">

        {/* Minimal logo — replaces the full nav */}
        <div className="flex justify-center mb-10 md:mb-12">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="Joinzer" width={36} height={36} className="object-contain" />
            <span className="font-heading font-bold text-brand-dark text-xl">Joinzer</span>
          </Link>
        </div>

        <div className="text-center mb-10 md:mb-12">
          <h1 className="font-heading text-3xl md:text-4xl font-extrabold text-brand-dark leading-tight">
            Las Vegas pickleball, all in one place
          </h1>
          <p className="text-brand-muted text-sm md:text-base mt-3 max-w-xl mx-auto leading-relaxed">
            Open play, leagues, and tournaments — find a game or run your own.
          </p>
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mt-6">
            Who are you here as?
          </p>
        </div>

        {/* Organizer card is first in DOM = left on desktop, top on mobile (supply side priority) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Organizer — primary, dark-filled */}
          <Link
            href="/organizers"
            className="group flex flex-col justify-between rounded-2xl bg-brand-dark p-8 min-h-[340px] shadow-xl hover:shadow-2xl transition-shadow"
          >
            <div>
              <span className="inline-block text-xs font-semibold text-brand uppercase tracking-widest mb-4">
                Organizer
              </span>
              <h2 className="font-heading text-2xl md:text-3xl font-extrabold text-white leading-tight mb-4">
                Run leagues, open play, and tournaments
              </h2>
              <p className="text-white/70 text-sm leading-relaxed mb-6">
                Brackets, registrations, payments, and day-of tools in one place. Built for leagues, clinics, tournaments, and organized play.
              </p>
              <div className="flex flex-wrap gap-2">
                {['Open Play', 'Leagues', 'Tournaments', 'Clinics'].map((tag) => (
                  <span key={tag} className="text-xs font-medium text-white/60 bg-white/10 rounded-full px-3 py-1">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-8 flex items-center justify-between">
              <span className="inline-block bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl text-sm group-hover:bg-brand-hover transition-colors">
                Explore Organizer Tools
              </span>
              <span className="text-brand/70 text-xl group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>

          {/* Player — secondary, outlined */}
          <Link
            href="/for-players"
            className="group flex flex-col justify-between rounded-2xl bg-white border-2 border-brand-border p-8 min-h-[340px] hover:border-brand hover:shadow-md transition-all"
          >
            <div>
              <span className="inline-block text-xs font-semibold text-brand-active uppercase tracking-widest mb-4">
                Player
              </span>
              <h2 className="font-heading text-2xl md:text-3xl font-extrabold text-brand-dark leading-tight mb-4">
                Find and join local pickleball
              </h2>
              <p className="text-brand-muted text-sm leading-relaxed mb-6">
                Discover open sessions, join local play, and connect with players near you. Free to join.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {['60+ venues', 'Free to join', 'No app download'].map((item) => (
                  <div key={item} className="flex items-center gap-1.5 text-xs text-brand-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-8 flex items-center justify-between">
              <span className="inline-block bg-brand-soft text-brand-dark font-semibold px-6 py-3 rounded-xl text-sm border border-brand-border group-hover:bg-brand group-hover:border-brand transition-colors">
                Find Local Games
              </span>
              <span className="text-brand-muted/70 text-xl group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>

        </div>

        <p className="text-center text-sm text-brand-muted mt-8">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-active font-medium hover:underline">
            Sign in
          </Link>
        </p>

      </div>
    </section>
  )
}
