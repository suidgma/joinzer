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
              Find and join<br />Vegas area<br />
              <span className="text-brand text-2xl sm:text-3xl md:text-4xl lg:text-5xl">pickleball sessions</span>
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
            <div className="flex flex-wrap justify-center md:justify-start gap-x-5 gap-y-2">
              {trustItems.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5 text-xs text-brand-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand inline-block shrink-0" />
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          {/* Right: three-layer hero panel */}
          <div className="flex-shrink-0 relative order-2 w-full max-w-xs sm:max-w-sm md:max-w-lg mx-auto md:mx-0">
            <div
              className="relative rounded-3xl overflow-hidden shadow-2xl"
              style={{ border: '1.5px solid rgba(143,201,25,0.25)' }}
            >
              {/* Layer 1: blurred pickleball photo — atmosphere only */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/hero-bg.jpg.png"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover opacity-20"
                style={{ filter: 'blur(6px) saturate(0.7) brightness(0.9)' }}
              />

              {/* Layer 2: branded green gradient wash */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(238,246,227,0.85) 0%, rgba(255,255,255,0.6) 50%, rgba(143,201,25,0.12) 100%)',
                }}
              />

              {/* Layer 3: mascot with radial glow behind it */}
              <div className="relative flex items-end justify-center pt-8 pb-4 px-8">
                {/* Radial glow — anchors the mascot */}
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2"
                  style={{
                    width: '80%',
                    height: '60%',
                    background: 'radial-gradient(ellipse at center bottom, rgba(143,201,25,0.32) 0%, transparent 70%)',
                    pointerEvents: 'none',
                  }}
                />

                {/* Mascot — crisp, slightly lower/off-center for designed feel */}
                <div className="relative w-60 h-60 sm:w-72 sm:h-72 md:w-[26rem] md:h-[26rem] ml-4">
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
