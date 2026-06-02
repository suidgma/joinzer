import Link from 'next/link'
import Image from 'next/image'

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Nav */}
      <header className="border-b border-gray-100 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 w-fit">
          <Image src="/logo.png" alt="Joinzer" width={28} height={28} className="object-contain" />
          <span className="font-heading font-bold text-brand-dark">Joinzer</span>
        </Link>
      </header>

      <div className="max-w-xl mx-auto px-6 py-14">

        {/* Founder photo + name */}
        <div className="flex flex-col items-center text-center mb-10">
          <Image
            src="/marty.jpeg"
            alt="Marty Suidgeest"
            width={200}
            height={200}
            className="rounded-full object-cover w-44 h-44 border-4 border-brand shadow-lg mb-4"
          />
          <p className="font-heading text-lg font-bold text-brand-dark">Marty Suidgeest</p>
          <p className="text-sm text-brand-muted">Founder, Joinzer</p>
        </div>

        {/* Heading */}
        <h1 className="font-heading text-2xl font-extrabold text-brand-dark mb-6 text-center">
          About Joinzer
        </h1>

        {/* Body */}
        <div className="space-y-5 text-brand-body text-base leading-relaxed">
          <p>
            Marty Suidgeest created Joinzer after running into a frustrating problem familiar to many pickleball players: sometimes you&apos;re ready to play, but you can&apos;t find the right mix of available players — especially people around your same skill level.
          </p>
          <p>
            What started as a better way to help players find games quickly soon revealed a bigger need. Local pickleball was often being coordinated through scattered group texts, Facebook posts, spreadsheets, and last-minute messages — not just for players, but also for the organizers trying to run sessions, leagues, and tournaments smoothly.
          </p>
          <p>
            Joinzer was built to bring local pickleball into one place. For players, that means discovering games, joining sessions, and connecting more easily. For organizers, it means better tools to publish events, manage participation, and run local play with less friction.
          </p>
          <p>
            Starting in Las Vegas, Joinzer is designed to support the full local pickleball ecosystem — from casual games to organized leagues and tournaments.
          </p>
          <p className="font-medium text-brand-dark">
            It&apos;s free to use. No app download required. Just pickleball.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-10 text-center">
          <Link
            href="/"
            className="inline-block bg-brand text-brand-dark font-semibold px-8 py-3 rounded-xl text-sm hover:bg-brand-hover transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
