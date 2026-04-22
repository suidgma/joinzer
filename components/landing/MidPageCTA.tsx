import Link from 'next/link'

export default function MidPageCTA() {
  return (
    <section className="relative overflow-hidden bg-brand-dark py-14 md:py-24">
      <div className="absolute inset-0 pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/accent-bg.jpg.png"
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover opacity-10"
        />
        <div className="absolute inset-0 bg-brand-dark/70" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-white leading-tight mb-4">
          Pickleball is better when it&apos;s easier to find your people
        </h2>

        <p className="text-white/70 text-sm sm:text-base max-w-xl mx-auto mb-8">
          Joinzer helps bring local sessions, players, and courts together in one place.
        </p>

        <Link
          href="/login"
          className="inline-block w-full sm:w-auto bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm"
        >
          Get Started
        </Link>
      </div>
    </section>
  )
}
