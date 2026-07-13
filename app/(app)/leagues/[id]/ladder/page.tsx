import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import RefreshOnVisible from '@/components/ui/refresh-on-visible'
import RefreshButton from '@/components/ui/RefreshButton'
import BoxAttendanceManager from '../attendance/BoxAttendanceManager'
import { ladderAdmin, readLadderState, buildLadderAttendance, computeLadderUpdate } from '@/lib/leagues/ladderServer'
import LadderStartButton from './LadderStartButton'
import LadderRounds, { type RoundView } from './LadderRounds'
import LadderRankingSection from '../roster/LadderRankingSection'

export const dynamic = 'force-dynamic'

export default async function LadderRunPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, format, format_kind, format_settings_json, points_to_win')
    .eq('id', params.id)
    .single()
  if (!league) notFound()
  if ((league as any).format_kind !== 'ladder') redirect(`/leagues/${params.id}`)

  // Organizer or co-admin only.
  const { data: myReg } = await supabase
    .from('league_registrations').select('is_co_admin').eq('league_id', params.id).eq('user_id', user.id).maybeSingle()
  const isAdmin = league.created_by === user.id || myReg?.is_co_admin === true
  if (!isAdmin) redirect(`/leagues/${params.id}`)

  const admin = ladderAdmin()
  const settings = ((league as any).format_settings_json ?? {}) as Record<string, unknown>
  const roundsPerSession = Number(settings.rounds_per_session ?? 6) || 6
  const pointsToWin = (league as any).points_to_win ?? 11

  const state = await readLadderState(admin, params.id, (league as any).format, settings)

  const { data: period } = await admin
    .from('league_periods')
    .select('id, period_number')
    .eq('league_id', params.id)
    .eq('period_kind', 'ladder_session')
    .eq('status', 'active')
    .maybeSingle()

  // The ladder-order editor is a one-time setup shown before session 1 (like box
  // seeding). Once any session has been started, the order is driven by results.
  const { count: sessionCount } = await admin
    .from('league_periods')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', params.id)
    .eq('period_kind', 'ladder_session')
  const neverStarted = (sessionCount ?? 0) === 0
  const ladderEntrants = state.entrants.map((e) => ({ id: e.registrationId, name: e.name, rating: e.rating }))
  const ladderSaved = state.orderedIds.length > 0 && state.orderedIds.every((id, i) => state.posByReg.get(id) === i + 1)

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${params.id}` },
    { label: 'Standings', href: `/leagues/${params.id}/standings` },
    { label: 'Roster', href: `/leagues/${params.id}/roster` },
    { label: 'Edit', href: `/leagues/${params.id}/edit` },
  ]
  const header = (
    <div className="flex items-center gap-3">
      <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      <span className="text-brand-muted text-sm">/</span>
      <span className="text-sm font-medium text-brand-dark">Run Session</span>
    </div>
  )

  let attendees: any[] = []
  let availableSubs: any[] = []
  let rounds: RoundView[] = []
  let preview: { name: string; before: number; after: number; delta: number; wins: number; losses: number }[] | null = null
  let unscored = 0

  if (period) {
    const built = await buildLadderAttendance(admin, params.id, period.id, state.orderedIds, state.byRegId, state.nameOf, state.doubles)
    attendees = built.attendees
    availableSubs = built.availableSubs

    const { data: fxRaw } = await admin
      .from('league_fixtures')
      .select('id, round_number, court_number, match_stage, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, status')
      .eq('period_id', period.id)
      .order('round_number', { ascending: true })
    const fx = (fxRaw ?? []) as any[]
    const roundNums = [...new Set(fx.filter((f) => f.match_stage === 'ladder_round').map((f) => f.round_number))].sort((a, b) => a - b)
    rounds = roundNums.map((rn) => {
      const courts = fx
        .filter((f) => f.match_stage === 'ladder_round' && f.round_number === rn)
        .sort((a, b) => (a.court_number ?? 0) - (b.court_number ?? 0))
        .map((f) => ({
          id: f.id,
          court: f.court_number,
          name1: built.matchName(f.team_1_registration_id),
          name2: built.matchName(f.team_2_registration_id),
          status: f.status,
          score1: f.team_1_score,
          score2: f.team_2_score,
        }))
      const byeRow = fx.find((f) => f.match_stage === 'ladder_bye' && f.round_number === rn)
      return { round: rn, courts, byeName: byeRow ? built.matchName(byeRow.team_1_registration_id) : null }
    })

    if (rounds.length > 0) {
      const update = await computeLadderUpdate(admin, params.id, period.id, (league as any).format, settings)
      preview = update.changes.map((c) => ({ name: c.name, before: c.before, after: c.after, delta: c.delta, wins: c.wins, losses: c.losses }))
      unscored = update.unscored
    }
  }

  return (
    <DesktopShell header={header} sidebar={<ManageNav items={navItems} />}>
      <RefreshOnVisible />
      <ManageNav items={navItems} mobileOnly />
      <div className="max-w-2xl space-y-5 pb-8">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-heading text-xl font-bold text-brand-dark">
              Run Session{period ? ` · Session ${period.period_number}` : ''}
            </h1>
            <RefreshButton className="mt-1 shrink-0" />
          </div>
          <p className="text-xs text-brand-muted">
            {!period
              ? (neverStarted
                  ? 'Set the starting ladder order (this seeds the courts on night one), then start session 1.'
                  : 'King-of-the-court night: start a session, mark who’s here, play the rounds, then update the ladder.')
              : 'Mark who’s here, generate rounds (winner up a court, loser down), then finish to update the ladder.'}
          </p>
        </div>

        {!period ? (
          <>
            {state.entrants.length < 2 ? (
              <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
                <p className="text-2xl">🪜</p>
                <p className="text-sm font-medium text-brand-dark">Not enough players yet</p>
                <p className="text-xs text-brand-muted">Add players on the Roster screen, then set the ladder order here.</p>
              </div>
            ) : (
              <>
                {neverStarted ? (
                  <LadderRankingSection
                    key={ladderEntrants.map((e) => e.id).join(',')}
                    leagueId={params.id}
                    entrants={ladderEntrants}
                    initialSaved={ladderSaved}
                  />
                ) : (
                  <div className="rounded-xl border border-brand-border overflow-hidden">
                    <div className="px-3 py-1.5 bg-brand-soft border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">
                      Current ladder
                    </div>
                    <div className="divide-y divide-brand-border">
                      {state.entrants.map((e, i) => (
                        <div key={e.registrationId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                          <span className="text-brand-muted w-6 text-right">{i + 1}</span>
                          <span className="text-brand-dark truncate">{e.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <LadderStartButton leagueId={params.id} />
              </>
            )}
          </>
        ) : (
          <>
            <BoxAttendanceManager
              key={`${period.id}:${attendees.map((a) => `${a.rowId}~${a.status}~${a.subbingForRegistrationId ?? ''}`).join('|')}`}
              leagueId={params.id}
              periodId={period.id}
              initialAttendees={attendees}
              availableSubs={availableSubs}
              doubles={state.doubles}
            />
            <LadderRounds
              leagueId={params.id}
              pointsToWin={pointsToWin}
              roundsPerSession={roundsPerSession}
              rounds={rounds}
              preview={preview}
              unscored={unscored}
            />
          </>
        )}
      </div>
    </DesktopShell>
  )
}
