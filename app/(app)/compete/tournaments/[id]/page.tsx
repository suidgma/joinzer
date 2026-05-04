import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import TournamentEventList from './TournamentEventList'
import DeleteTournamentButton from '@/components/features/tournaments/DeleteTournamentButton'

const CATEGORY_LABELS: Record<string, string> = {
  mens_singles: "Men's Singles",
  womens_singles: "Women's Singles",
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
}

const BRACKET_LABELS: Record<string, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  round_robin: 'Round Robin',
  pool_play: 'Pool Play',
}

export default async function TournamentDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: tournament }, { data: events }, { data: myRegs }, { data: myProfile }] = await Promise.all([
    supabase
      .from('tournaments')
      .select('*, location:location_id(name), organization:organizations(name)')
      .eq('id', params.id)
      .single(),
    supabase
      .from('tournament_events')
      .select('*, reg_count:tournament_registrations(count)')
      .eq('tournament_id', params.id)
      .order('category'),
    user
      ? supabase.from('tournament_registrations').select('tournament_event_id, status').eq('user_id', user.id)
      : Promise.resolve({ data: [] }),
    user
      ? supabase.from('profiles').select('dupr_rating, estimated_rating, rating_source').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
  ])

  if (!tournament) notFound()

  const isManager = user?.id === tournament.created_by
  const orgName = (tournament.organization as { name: string } | null)?.name
  const myRegMap = new Map((myRegs ?? []).map((r) => [r.tournament_event_id, r.status]))

  // Effective DUPR for skill-level warning comparison
  const userRating: number | null =
    myProfile?.rating_source === 'dupr_known' ? (myProfile.dupr_rating ?? null)
    : myProfile?.rating_source === 'estimated' ? (myProfile.estimated_rating ?? null)
    : null

  const fmt = (d: string | null) =>
    d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null

  const cost = tournament.cost_cents ? `$${(tournament.cost_cents / 100).toFixed(0)} per event` : 'Free'

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/compete" className="text-brand-muted text-sm">← Compete</Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">{tournament.name}</h1>
        {orgName && <p className="text-sm text-brand-muted">{orgName}</p>}
        {isManager && (
          <div className="flex gap-3">
            <Link href={`/compete/tournaments/${tournament.id}/edit`} className="text-xs text-brand-active underline underline-offset-2">
              Edit
            </Link>
            <Link href={`/compete/tournaments/${tournament.id}/roster`} className="text-xs text-brand-active underline underline-offset-2">
              Roster
            </Link>
            <DeleteTournamentButton tournamentId={tournament.id} />
          </div>
        )}
      </div>

      {/* Details card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
        {(tournament.location as { name: string } | null)?.name && <Row label="Location" value={(tournament.location as { name: string }).name} />}
        {fmt(tournament.start_date) && <Row label="Dates" value={`${fmt(tournament.start_date)}${tournament.end_date && tournament.end_date !== tournament.start_date ? ` – ${fmt(tournament.end_date)}` : ''}`} />}
        {fmt(tournament.registration_open) && <Row label="Reg. Opens" value={fmt(tournament.registration_open)!} />}
        {fmt(tournament.registration_close) && <Row label="Reg. Closes" value={fmt(tournament.registration_close)!} />}
        <Row label="Entry Fee" value={cost} />
      </div>

      {/* Description */}
      {tournament.description && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4">
          <p className="text-sm text-brand-body whitespace-pre-wrap">{tournament.description}</p>
        </div>
      )}

      {/* Events */}
      <section className="space-y-2">
        <h2 className="font-heading text-base font-bold text-brand-dark">Events</h2>
        {!events?.length ? (
          <p className="text-sm text-brand-muted">No events added yet.</p>
        ) : (
          <TournamentEventList
            tournamentId={tournament.id}
            tournamentStatus={tournament.status}
            events={events.map((e) => ({
              id: e.id,
              name: e.name,
              category: e.category,
              skill_level: e.skill_level,
              age_division: e.age_division,
              max_teams: e.max_teams,
              event_date: e.event_date,
              bracket_type: e.bracket_type,
              reg_count: (e.reg_count as { count: number }[])?.[0]?.count ?? 0,
              myStatus: myRegMap.get(e.id) ?? null,
            }))}
            isLoggedIn={!!user}
            userRating={userRating}
            categoryLabels={CATEGORY_LABELS}
            bracketLabels={BRACKET_LABELS}
          />
        )}
      </section>

      {!user && (
        <p className="text-sm text-brand-muted text-center">
          <Link href="/login" className="text-brand-active underline">Sign in</Link> to register for events.
        </p>
      )}
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs text-brand-muted w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-brand-dark">{value}</span>
    </div>
  )
}
