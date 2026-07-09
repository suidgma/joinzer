import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { ChevronLeft, User } from 'lucide-react'
import { loadOrganizerProfile } from '@/lib/profile/organizer'
import OrganizerHostedList from './OrganizerHostedList'

// Public organizer-identity page. Reads via the service role; the loader returns only
// PII-safe fields and null for non-organizers (→ 404). Scoped to tournaments + leagues
// (the organizer surfaces); casual events are intentionally excluded.
export default async function OrganizerProfilePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const org = await loadOrganizerProfile(admin, id)
  if (!org) notFound()

  const name = org.identity.displayName ?? org.identity.name ?? 'Organizer'
  const meta = [
    org.identity.memberSinceYear ? `Member since ${org.identity.memberSinceYear}` : null,
    org.identity.homeCourtName ? `Home court: ${org.identity.homeCourtName}` : null,
  ].filter(Boolean).join(' · ')

  const stats: [string, number][] = [
    ['Tournaments', org.stats.tournaments],
    ['Leagues', org.stats.leagues],
    ['Players served', org.stats.playersServed],
  ]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href={`/players/${org.identity.id}`} className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark">
        <ChevronLeft className="w-4 h-4" />
        Player profile
      </Link>

      {/* Hero */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
        <div className="bg-brand/10 px-6 pt-8 pb-5 flex flex-col items-center gap-3 text-center">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-brand-soft border-2 border-brand-border flex items-center justify-center">
            {org.identity.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.identity.photoUrl} alt={name} className="w-full h-full object-cover" />
            ) : (
              <User className="w-10 h-10 text-brand-muted" />
            )}
          </div>
          <div>
            <h1 className="font-heading font-bold text-xl text-brand-dark">{name}</h1>
            <p className="text-sm text-brand-active font-medium mt-0.5">Organizer</p>
            {meta && <p className="text-xs text-brand-muted mt-1">{meta}</p>}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 divide-x divide-brand-border border-t border-brand-border">
          {stats.map(([label, value]) => (
            <div key={label} className="px-2 py-3 text-center">
              <p className="text-xl font-extrabold text-brand-dark leading-none">{value}</p>
              <p className="text-[11px] text-brand-muted mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <OrganizerHostedList title="Tournaments" comps={org.tournaments} />
      <OrganizerHostedList title="Leagues" comps={org.leagues} />
    </main>
  )
}
