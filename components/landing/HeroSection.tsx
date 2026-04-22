import Link from 'next/link'
import Image from 'next/image'

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-white">
      {/* Subtle background tint blob */}
      <div
        aria-hidden
        className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full opacity-30 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #CBE487 0%, transparent 70%)', transform: 'translate(30%, -30%)' }}
      />

      <div className="relative max-w-6xl mx-auto px-4 py-20 md:py-28 flex flex-col md:flex-row items-center gap-12 md:gap-16">
        {/* Text side */}
        <div className="flex-1 text-center md:text-left">
          <div className="inline-flex items-center gap-2 bg-brand-soft border border-brand-border rounded-full px-3 py-1 text-xs font-semibold text-brand-active mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-active inline-block" />
            Las Vegas pickleball community
          </div>

          <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-extrabold text-brand-dark leading-tight mb-5">
            Find your next<br />
            <span className="text-brand">pickleball game.</span>
          </h1>

          <p className="text-brand-muted text-lg leading-relaxed max-w-lg mx-auto md:mx-0 mb-8">
            Discover local sessions, join a game that fits your schedule, or create your own. Joinzer connects Las Vegas pickleball players — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
            <Link
              href="/login"
              className="bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm text-center shadow-sm"
            >
              Create your free account
            </Link>
            <Link
              href="/login"
              className="bg-white text-brand-dark font-semibold px-6 py-3 rounded-xl border border-brand-border hover:border-brand hover:bg-brand-soft transition-colors text-sm text-center"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-4 text-xs text-brand-muted">No app download required. Free to use.</p>
        </div>

        {/* Logo / mascot side */}
        <div className="flex-shrink-0 flex items-center justify-center">
          <div className="relative w-72 h-72 md:w-96 md:h-96">
            {/* Decorative ring */}
            <div className="absolute inset-0 rounded-full bg-brand-soft border border-brand-border scale-110" />
            {/* Subtle inner ring */}
            <div className="absolute inset-4 rounded-full bg-white/60" />
            <Image
              src="/logo.png"
              alt="Joinzer mascot"
              fill
              className="object-contain relative z-10 drop-shadow-lg p-6"
              priority
            />
          </div>
        </div>
      </div>
    </section>
  )
}
