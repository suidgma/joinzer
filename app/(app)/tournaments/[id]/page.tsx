export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'
import type { TournamentDetail } from '@/lib/types'
import DivisionsSection from '@/components/features/tournaments/DivisionsSection'
import MatchesSection from '@/components/features/tournaments/MatchesSection'
import GroupChat from '@/components/features/GroupChat'
import DeleteTournamentButton from '@/components/features/tournaments/DeleteTournamentButton'

function formatDate(dateStr: string) {
  return formatSessionDate(dateStr, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:     'bg-yellow-100 text-yellow-800',
    published: 'bg-brand-soft text-brand-active',
    cancelled: 'bg-red-100 text-red-700',
    completed: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}


export default async function TournamentDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data }, { data: divisionsRaw }, { data: regsRaw }, { data: matchesData }, { data: tournamentMessages }] = await Promise.all([
    db
      .from('tournaments')
      .select(`
        id, name, description, start_date, start_time, estimated_end_time,
        status, visibility, registration_status, organizer_id,
        location_id,
        location:locations!location_id (id, name, subarea),
        organizer:profiles!organizer_id (name),
        created_at, updated_at
      `)
      .eq('id', params.id)
      .single(),
    db
      .from('tournament_divisions')
      .select('id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, format_type, format_settings_json')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true }),
    db
      .from('tournament_registrations')
      .select('id, division_id, user_id, partner_user_id, team_name, status, payment_status')
      .eq('tournament_id', params.id),
    db
      .from('tournament_matches')
      .select(`
        id, division_id, round_number, match_number, match_stage, pool_number,
        court_number, scheduled_time, team_1_registration_id, team_2_registration_id,
        team_1_score, team_2_score, winner_registration_id, status
      `)
      .eq('tournament_id', params.id)
      .order('match_number', { ascending: true }),
    db
      .from('tournament_messages')
      .select('id, user_id, message_text, created_at, profile:profiles!user_id(name)')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true })
      .limit(100),
  ])

  if (!data) notFound()

  const tournament = data as unknown as TournamentDetail
  const isOrganizer = user?.id === tournament.organizer_id
  const regOpen = tournament.registration_status === 'open'

  const timeRange = tournament.estimated_end_time
    ? `${formatTime(tournament.start_time)} – ${formatTime(tournament.estimated_end_time)}`
    : formatTime(tournament.start_time)

  // Join registrations onto their divisions server-side
  const regsByDivision: Record<string, any[]> = {}
  for (const reg of regsRaw ?? []) {
    if (!regsByDivision[reg.division_id]) regsByDivision[reg.division_id] = []
    regsByDivision[reg.division_id].push(reg)
  }
  const divisions = (divisionsRaw ?? []).map((div: any) => ({
    ...div,
    tournament_registrations: regsByDivision[div.id] ?? [],
  }))
  const matches = (matchesData ?? []) as any[]

  // True if the current user has a 'registered' entry in any division
  const isRegistered = user
    ? divisions.some((div) =>
        (div.tournament_registrations ?? []).some(
          (reg: any) => reg.user_id === user.id && reg.status === 'registered'
        )
      )
    : false

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/tournaments" className="text-brand-muted text-sm">← Back</Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 uppercase">
              Tournament
            </span>
            <StatusBadge status={tournament.status} />
          </div>
          <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-semibold ${
            regOpen ? 'bg-brand-soft text-brand-active' : 'bg-gray-100 text-gray-500'
          }`}>
            {regOpen ? 'Registration Open' : 'Registration Closed'}
          </span>
        </div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">{tournament.name}</h1>
      </div>

      {/* Details card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
        {tournament.location && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">📍</span>
            <div>
              <p className="text-sm font-medium text-brand-dark">{tournament.location.name}</p>
              {tournament.location.subarea && (
                <p className="text-xs text-brand-muted">{tournament.location.subarea}</p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className="text-brand-muted text-xs pt-0.5">📅</span>
          <div>
            <p className="text-sm font-medium text-brand-dark">{formatDate(tournament.start_date)}</p>
            <p className="text-xs text-brand-muted">{timeRange}</p>
          </div>
        </div>
        {tournament.organizer && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">👤</span>
            <p className="text-sm text-brand-dark">Organizer: {tournament.organizer.name}</p>
          </div>
        )}
        {tournament.description && (
          <p className="text-sm text-brand-body leading-relaxed border-t border-brand-border pt-3">
            {tournament.description}
          </p>
        )}
      </div>

      {/* Organizer actions */}
      {isOrganizer && (
        <div className="space-y-2">
          <Link
            href={`/tournaments/${tournament.id}/edit`}
            className="block w-full text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
          >
            Edit Tournament
          </Link>
          <div className="flex justify-center">
            <DeleteTournamentButton tournamentId={tournament.id} />
          </div>
        </div>
      )}

      {/* Divisions + Registration */}
      <DivisionsSection
        tournamentId={tournament.id}
        initialDivisions={divisions}
        isOrganizer={isOrganizer}
        currentUserId={user?.id ?? null}
      />

      {/* Matches, scoring, and standings */}
      {divisions.length > 0 && (
        <MatchesSection
          tournamentId={tournament.id}
          divisions={divisions}
          initialMatches={matches}
          isOrganizer={isOrganizer}
        />
      )}

      {/* Tournament chat */}
      {user && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Tournament Chat</h2>
          <GroupChat
            table="tournament_messages"
            entityId={tournament.id}
            entityField="tournament_id"
            initialMessages={(tournamentMessages ?? []) as any[]}
            currentUserId={user.id}
            canChat={isOrganizer || isRegistered}
          />
        </section>
      )}
    </main>
  )
}
