import Link from 'next/link'
import Image from 'next/image'

export default function FinalCTA() {
  return (
    <section className="py-20 md:py-28 bg-brand-dark relative overflow-hidden">
      {/* Subtle radial accent */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 80% 50%, #428609 0%, transparent 60%)' }}
      />

      <div className="relative max-w-3xl mx-auto px-4 text-center">
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
            <Image src="/logo.png" alt="" width={52} height={52} className="object-contain" />
          </div>
        </div>

        <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-5">
          Ready to play?
          <br />
          <span className="text-brand">Join Joinzer today.</span>
        </h2>

        <p className="text-white/70 text-base md:text-lg max-w-xl mx-auto mb-10">
          Create your free account in seconds. Find a game, build your community, and get on the court.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/login"
            className="bg-brand text-brand-dark font-semibold px-8 py-3.5 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm shadow-lg shadow-brand/30"
          >
            Create your free account
          </Link>
          <Link
            href="/login"
            className="bg-white/10 text-white font-semibold px-8 py-3.5 rounded-xl border border-white/20 hover:bg-white/20 transition-colors text-sm"
          >
            Sign in
          </Link>
        </div>

        <p className="mt-6 text-white/40 text-xs">No credit card. No app download. Just pickleball.</p>
      </div>
    </section>
  )
}
