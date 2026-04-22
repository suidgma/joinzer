import Link from 'next/link'
import Image from 'next/image'

export default function FinalCTA() {
  return (
    <section className="py-14 md:py-24 bg-white">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-full bg-brand-soft border border-brand-border flex items-center justify-center">
            <Image src="/logo.png" alt="" width={36} height={36} className="object-contain" />
          </div>
        </div>

        <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-brand-dark mb-3">
          Ready to get on the court?
        </h2>

        <p className="text-brand-muted text-sm sm:text-base max-w-md mx-auto mb-8">
          Create your free account and start discovering local pickleball sessions near you.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/login"
            className="w-full sm:w-auto bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover active:bg-brand-active transition-colors text-sm shadow-sm"
          >
            Create Free Account
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto text-brand-dark font-semibold px-8 py-4 rounded-xl border border-brand-border hover:bg-brand-soft transition-colors text-sm"
          >
            Sign In
          </Link>
        </div>
      </div>
    </section>
  )
}
