import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

// Guided "create your first event" screen for new organizers. Reached right after signup
// when they declared organize intent (see profile setup routing). Not gated beyond auth —
// it's a friendly fork into the existing create flows, with a "just here to play" escape.
export default async function GetStartedPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const options = [
    {
      href: '/leagues/create',
      emoji: '🏆',
      title: 'Create a League',
      desc: 'Recurring play over a season — round robin, box, ladder, team, or flex. Rosters, weekly matches, and standings that build over time.',
      cta: 'Set up a league',
    },
    {
      href: '/tournaments/create',
      emoji: '🎾',
      title: 'Create a Tournament',
      desc: 'A one-off event with divisions and brackets — single/double elimination or round robin. Registration, seeding, live scoring, and export.',
      cta: 'Set up a tournament',
    },
  ]

  const steps = [
    { n: '1', t: 'Set it up', d: 'Pick a format, dates, and location — a few minutes.' },
    { n: '2', t: 'Players register', d: 'Share the link; players sign up and pay (optional) online.' },
    { n: '3', t: 'Run it', d: 'Generate matches, enter scores, and standings update live.' },
  ]

  return (
    <main className="min-h-screen bg-brand-page">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <div className="text-center space-y-2">
          <p className="text-brand-active text-xs font-semibold uppercase tracking-widest">Welcome to Joinzer</p>
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-brand-dark">Let&apos;s set up your first event</h1>
          <p className="text-brand-muted text-sm max-w-xl mx-auto">
            Pick what you&apos;re running. You can always create the other kind later, and edit everything before you publish.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {options.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              className="group bg-brand-surface border border-brand-border rounded-2xl p-5 flex flex-col hover:border-brand-active hover:shadow-sm transition-all"
            >
              <span className="text-3xl mb-3">{o.emoji}</span>
              <h2 className="font-heading text-lg font-bold text-brand-dark mb-1">{o.title}</h2>
              <p className="text-sm text-brand-muted leading-relaxed flex-1">{o.desc}</p>
              <span className="mt-4 inline-block bg-brand text-brand-dark text-sm font-semibold px-4 py-2 rounded-lg text-center group-hover:bg-brand-hover transition-colors">
                {o.cta} →
              </span>
            </Link>
          ))}
        </div>

        <div className="bg-white border border-brand-border rounded-2xl p-5">
          <p className="text-[11px] font-bold text-brand-muted uppercase tracking-wider mb-3">How it works</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {steps.map((s) => (
              <div key={s.n} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-brand-soft text-brand-dark text-xs font-bold flex items-center justify-center">{s.n}</span>
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{s.t}</p>
                  <p className="text-xs text-brand-muted leading-relaxed">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-sm text-brand-muted">
          Just here to play?{' '}
          <Link href="/home" className="text-brand-active font-medium underline underline-offset-2">Explore sessions and events →</Link>
        </p>
      </div>
    </main>
  )
}
