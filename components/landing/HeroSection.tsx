import Link from 'next/link'
import Image from 'next/image'

const trustItems = [
  { label: '65+ courts listed' },
  { label: 'Free to join' },
  { label: '1 tap to join a session' },
]

export default function HeroSection() {
  return (
    <section className="bg-white pt-10 pb-0 md:pt-20 md:pb-0 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">

          {/* Left: text + CTAs */}
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

            <div className="flex flex-col sm:flex-row gap-3 mb-5">
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

            <p className="text-sm text-brand-muted mb-6">
              Already have an account?{' '}
              <Link href="/login" className="text-brand-active font-medium hover:underline">
                Sign in
              </Link>
            </p>

            {/* Trust strip */}
            <div className="flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-2">
              {trustItems.map((item, i) => (
                <div key={item.label} className="flex items-center gap-1.5 text-xs text-brand-muted">
                  {i > 0 && <span className="hidden sm:inline text-brand-border mr-4">·</span>}
                  <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block" />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          {/* Right: hero visual — stronger, more deliberate */}
          <div className="flex-shrink-0 relative order-2 w-full max-w-xs sm:max-w-sm md:max-w-lg mx-auto md:mx-0">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-brand-border/60 bg-gradient-to-br from-brand-soft via-white to-brand-soft/40">
              {/* Background image — more visible */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-bg.jpg.png"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover opacity-35 blur-[2px]"
              />
              {/* Subtle green-tinted overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-brand/10 via-transparent to-brand-dark/5" />

              {/* Mascot — larger, no washed-out circle */}
              <div className="relative flex items-center justify-center py-10 px-8">
                <div className="relative w-56 h-56 sm:w-64 sm:h-64 md:w-96 md:h-96">
                  <Image
                    src="/logo.png"
                    alt="Joinzer mascot"
                    fill
                    className="object-contain drop-shadow-2xl"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
