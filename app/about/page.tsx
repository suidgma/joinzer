import Link from 'next/link'
import Image from 'next/image'

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Simple nav */}
      <header className="border-b border-gray-100 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-16">
        <h1 className="font-heading text-3xl font-extrabold text-brand-dark mb-6">About Joinzer</h1>

        <div className="space-y-5 text-brand-body text-base leading-relaxed">
          <p>
            Joinzer is a mobile-first coordination platform built for pickleball players who want a simpler way to find, join, and organize local sessions.
          </p>
          <p>
            We started with Las Vegas — one of the fastest-growing pickleball communities in the country — because we saw how much time players were wasting trying to coordinate through group texts, Facebook groups, and word of mouth.
          </p>
          <p>
            Joinzer brings it all into one place: a clean feed of upcoming sessions, one-tap joining, automatic waitlist management, built-in group chat, and the tools captains need to run a session smoothly.
          </p>
          <p>
            It&apos;s free to use. No app download required. Just pickleball.
          </p>
        </div>

        <div className="mt-10">
          <Link
            href="/"
            className="inline-block bg-brand text-brand-dark font-semibold px-6 py-3 rounded-xl text-sm hover:bg-brand-hover transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
