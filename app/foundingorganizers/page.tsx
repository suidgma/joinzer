import type { Metadata } from 'next'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'

// Direct-link outreach page: on-domain (trust) but not indexed — you send it to a
// prospective organizer, it isn't a publicly-ranked marketing page.
export const metadata: Metadata = {
  title: 'Founding Organizers — Joinzer',
  description: "Run your next pickleball league or tournament without the spreadsheet. I'll set up and run your first event on Joinzer, free.",
  robots: { index: false, follow: true },
}

const BOOK_URL = 'https://calendly.com/martysuidgeest/30-minute-zoom-with-marty'
const EMAIL = 'marty@joinzer.com'
const PHONE_DISPLAY = '702-266-0013'
const PHONE_TEL = '+17022660013'

const CAPABILITIES: { title: string; body: string }[] = [
  { title: 'Rosters & registration', body: 'Players sign up, pay, and land on your roster automatically.' },
  { title: 'Scheduling & live scoring', body: 'Generate rounds or a bracket, then score from your phone, courtside.' },
  { title: 'Standings that keep themselves', body: 'Every result updates the table instantly. No spreadsheet, ever.' },
  { title: 'Substitutes, handled', body: 'Players line up their own subs — you approve nothing and nothing breaks.' },
  { title: 'Payments & payouts', body: 'Take entry fees, get paid straight to your bank. Refunds built in.' },
  { title: 'Ratings that follow players', body: 'Every player earns a rating and a record that carries season to season.' },
]

export default function FoundingOrganizersPage() {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <main>
        {/* HERO */}
        <section className="bg-white pt-12 pb-14 md:pt-20 md:pb-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-4">
              Founding organizers · Las Vegas
            </p>
            <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-brand-dark leading-tight mb-6 text-balance">
              Run your next league<br className="hidden sm:block" />
              <span className="text-brand"> without the spreadsheet.</span>
            </h1>
            <p className="text-brand-muted text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-8">
              Joinzer handles the roster, the schedule, live scoring, standings, subs, and the money — with{' '}
              <span className="text-brand-dark font-semibold">payouts straight to your account.</span> One app. On your phone. On the court.
            </p>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mb-3">
              <a
                href={BOOK_URL}
                className="w-full sm:w-auto bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover transition-colors text-sm text-center shadow-sm"
              >
                Book my free first event
              </a>
              <a
                href={`tel:${PHONE_TEL}`}
                className="w-full sm:w-auto bg-brand-dark text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-dark/90 transition-colors text-sm text-center shadow-sm"
              >
                Call or text {PHONE_DISPLAY}
              </a>
            </div>
            <p className="text-xs text-brand-muted">No cost. No setup work. I run it with you.</p>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="bg-brand-page border-y border-brand-border py-14 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">The reality</p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-brand-dark leading-tight mb-4 text-balance">
              You didn&apos;t sign up to run a spreadsheet.
            </h2>
            <p className="text-brand-muted text-base md:text-lg leading-relaxed max-w-2xl">
              Right now your league lives in five places — a group text, a spreadsheet, a bracket site, Venmo, and your head.
              You chase subs by text, tally standings by hand, and hope nothing falls apart on game day. That&apos;s not
              organizing. That&apos;s data entry.
            </p>
          </div>
        </section>

        {/* CAPABILITIES */}
        <section className="bg-white py-14 md:py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">What Joinzer does</p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-brand-dark leading-tight mb-8 text-balance">
              Everything your event needs, in one place.
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {CAPABILITIES.map((c) => (
                <div key={c.title} className="rounded-2xl border border-brand-border bg-brand-surface p-5">
                  <span className="block w-6 h-1 rounded-full bg-brand mb-4" aria-hidden="true" />
                  <h3 className="font-heading text-base font-bold text-brand-dark mb-1.5">{c.title}</h3>
                  <p className="text-sm text-brand-muted leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* THE OFFER */}
        <section className="bg-white pb-16 md:pb-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <div className="rounded-3xl bg-brand-dark px-7 py-10 md:px-12 md:py-12 shadow-sm">
              <p className="text-brand text-xs font-semibold uppercase tracking-widest mb-4">The founding-organizer offer</p>
              <h2 className="font-heading text-2xl sm:text-3xl md:text-4xl font-extrabold text-white leading-tight mb-5 text-balance">
                Let me run your next event. <span className="text-brand">Free.</span>
              </h2>
              <p className="text-white/80 text-base md:text-lg leading-relaxed mb-4 max-w-2xl">
                I&apos;ll set your league or tournament up in Joinzer, and I&apos;ll be there on event day to make sure it runs.
                You don&apos;t pay a thing, and you don&apos;t do the setup. If it makes your life easier, you keep it. If it
                doesn&apos;t, you&apos;ve lost nothing but a couple of hours.
              </p>
              <p className="text-brand font-semibold text-sm md:text-base mb-8">
                All I ask: one real event, and your honest feedback.
              </p>
              <a
                href={BOOK_URL}
                className="inline-block bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover transition-colors text-sm text-center shadow-sm"
              >
                Grab a 15-minute call
              </a>
            </div>
          </div>
        </section>

        {/* FOUNDER NOTE */}
        <section className="bg-brand-page border-y border-brand-border py-14 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <blockquote className="border-l-4 border-brand pl-5 md:pl-6">
              <p className="text-brand-dark text-lg md:text-xl leading-relaxed italic max-w-2xl">
                I built Joinzer here in the Las Vegas area because I watched organizers do an incredible amount of invisible
                work to keep local pickleball running. I&apos;m looking for a few founding organizers to build this around — and
                if you&apos;re one of them, you get me, personally, in your corner.
              </p>
            </blockquote>
            <p className="font-heading font-bold text-brand-active text-sm mt-5 pl-5 md:pl-6">
              Marty Suidgeest
              <span className="block text-brand-muted font-medium">Founder, Joinzer</span>
            </p>
          </div>
        </section>

        {/* FINAL CTA + CONTACT */}
        <section className="bg-white py-16 md:py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <p className="text-brand-active text-xs font-semibold uppercase tracking-widest mb-3">Your move</p>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-brand-dark leading-tight mb-4 text-balance">
              Ready to run your next one the easy way?
            </h2>
            <p className="text-brand-muted text-base md:text-lg leading-relaxed max-w-xl mx-auto mb-8">
              Fifteen minutes, no pressure. I&apos;ll show you exactly how your event would run — and if it&apos;s a fit,
              we&apos;ll pick a date.
            </p>
            <a
              href={BOOK_URL}
              className="inline-block bg-brand text-brand-dark font-semibold px-8 py-4 rounded-xl hover:bg-brand-hover transition-colors text-sm text-center shadow-sm mb-8"
            >
              Book a 15-minute call
            </a>
            <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-sm text-brand-muted border-t border-brand-border pt-6">
              <a href={`tel:${PHONE_TEL}`} className="hover:text-brand-dark transition-colors">{PHONE_DISPLAY}</a>
              <a href={`mailto:${EMAIL}`} className="hover:text-brand-dark transition-colors">{EMAIL}</a>
              <a href="/organizers" className="text-brand-active font-semibold hover:text-brand-dark transition-colors">
                See everything Joinzer does →
              </a>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  )
}
