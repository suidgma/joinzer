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

        <div className="flex flex-col sm:flex-row gap-8 items-start mb-8">
          <div className="flex-shrink-0 mx-auto sm:mx-0">
            <Image
              src="/marty.jpg"
              alt="Marty Suidgeest"
              width={160}
              height={160}
              className="rounded-full object-cover w-40 h-40 border-4 border-brand shadow-md"
            />
          </div>
          <div className="space-y-5 text-brand-body text-base leading-relaxed">
            <p>
              Marty Suidgeest created Joinzer after running into a frustrating problem familiar to many pickleball players: sometimes you&apos;re ready to play, but you can&apos;t find three other available players — especially players around your same skill level.
            </p>
            <p>
              Instead of relying on scattered group texts, Facebook posts, and last-minute messages, Marty built Joinzer to give local pickleballers a simpler way to find games, connect with compatible players, and organize sessions with ease.
            </p>
          </div>
        </div>

        <div className="space-y-5 text-brand-body text-base leading-relaxed">
          <p>
            Starting in Las Vegas, Joinzer was designed to bring everything into one place: upcoming sessions, easy joining, automatic waitlists, built-in group chat, and useful tools for session organizers.
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
