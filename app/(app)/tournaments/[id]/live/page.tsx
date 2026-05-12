import { createClient as createAdmin } from '@supabase/supabase-js'
import Link from 'next/link'
import LiveScoreboard from './LiveScoreboard'

export const revalidate = 0

export default async function PublicLiveScoreboardPage({
  params,
}: {
  params: { id: string }
}) {
  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: tournament }, { data: divisions }, { data: matches }, { data: registrations }] =
    await Promise.all([
      db.from('tournaments').select('id, name, start_date, status').eq('id', params.id).single(),
      db.from('tournament_divisions').select('id, name').eq('tournament_id', params.id).eq('status', 'active'),
      db.from('tournament_matches').select('*').eq('tournament_id', params.id),
      db.from('tournament_registrations')
        .select('id, user_id, division_id, team_name, status, partner_user_id, profiles!user_id(name)')
        .eq('tournament_id', params.id)
        .eq('status', 'registered'),
    ])

  if (!tournament) {
    return (
      <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
        <p className="text-sm text-brand-muted">Tournament not found.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-brand-page">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Live Scoreboard</p>
          <h1 className="font-heading text-xl font-bold text-brand-dark">{tournament.name}</h1>
          <p className="text-xs text-brand-muted">
            {new Date(tournament.start_date).toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric',
            })}
          </p>
        </div>

        <LiveScoreboard
          tournamentId={params.id}
          initialDivisions={divisions ?? []}
          initialMatches={matches ?? []}
          initialRegistrations={(registrations ?? []) as any[]}
        />

        <div className="text-center">
          <Link
            href={`/tournaments/${params.id}`}
            className="text-xs text-brand-active hover:underline"
          >
            View full tournament →
          </Link>
        </div>
      </div>
    </main>
  )
}
