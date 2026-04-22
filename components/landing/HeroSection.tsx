import Link from 'next/link'
import Image from 'next/image'

export default function HeroSection() {
  return (
    <section className="bg-white py-12 md:py-24 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center gap-8 md:gap-16">

          {/* Text + CTAs — always first on mobile */}
          <div className="flex-1 text-center md:text-left order-1">
            <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">
              Local pickleball made easier
            </p>

            <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-brand-dark leading-tight mb-4">
              Find and join local{' '}
              <span className="text-brand">pickleball sessions</span>
            </h1>

            <p className="text-brand-muted text-base md:text-lg leading-relaxed max-w-lg mx-auto md:mx-0 mb-6">
              Joinzer helps you discover nearby pickleball games, connect with players, and get on the court faster.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <Link
                href="/login"
                className="w-full sm:w-auto bg-brand text-brand-dark font-semibold px-7 py-4 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm text-center shadow-sm"
              >
                Create Free Account
              </Link>
              <Link
                href="/events"
                className="w-full sm:w-auto text-brand-dark font-semibold px-7 py-4 rounded-xl border border-brand-border hover:bg-brand-soft transition-colors text-sm text-center"
              >
                Find Local Games
              </Link>
            </div>

            <p className="text-sm text-brand-muted">
              Already have an account?{' '}
              <Link href="/login" className="text-brand-active font-medium hover:underline">
                Sign in
              </Link>
            </p>
            <p className="mt-2 text-xs text-brand-muted">Free to join. Easy to get started.</p>
          </div>

          {/* Mascot visual — shows below text on mobile */}
          <div className="flex-shrink-0 relative order-2 w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto md:mx-0">
            <div className="absolute inset-0 rounded-3xl overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-bg.jpg.png"
                alt=""
                aria-hidden="true"
                className="w-full h-full object-cover blur-sm opacity-20"
              />
            </div>
            <div className="relative flex items-center justify-center py-8 px-6">
              <div className="relative w-48 h-48 sm:w-56 sm:h-56 md:w-80 md:h-80">
                <div className="absolute inset-0 rounded-full bg-brand-soft/60 border border-brand-border scale-110" />
                <Image
                  src="/logo.png"
                  alt="Joinzer mascot"
                  fill
                  className="object-contain relative z-10 drop-shadow-xl p-4"
                  priority
                />
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
