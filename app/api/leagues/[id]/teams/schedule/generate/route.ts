import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer } from '@/lib/leagues/teamsServer'
import { buildTeamRoundRobin } from '@/lib/leagues/teamSchedule'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/teams/schedule/generate
// Round-robin the active teams across weekly matchdays. Creates league_periods
// (matchday) + parent team-matchup league_fixtures. Replaces any existing schedule,
// but refuses if a matchup has already been scored. Organizer-only.
export async function POST(_req: NextRequest, props: Params) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: teams } = await db.from('league_teams')
    .select('id').eq('league_id', id).eq('status', 'active').order('created_at', { ascending: true })
  const teamIds = (teams ?? []).map((t: { id: string }) => t.id)
  if (teamIds.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 active teams to generate a schedule' }, { status: 400 })
  }

  // Don't wipe a season that's already being scored.
  const { count: completed } = await db.from('league_fixtures')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', id).eq('match_stage', 'team_matchup').eq('status', 'completed')
  if ((completed ?? 0) > 0) {
    return NextResponse.json({ error: 'Some matchups are already scored — clear results before regenerating.' }, { status: 409 })
  }

  // Replace any existing team schedule (parents + their child lines + matchday periods).
  await db.from('league_fixtures').delete().eq('league_id', id).in('match_stage', ['team_matchup', 'team_line'])
  await db.from('league_periods').delete().eq('league_id', id).eq('period_kind', 'matchday')

  const schedule = buildTeamRoundRobin(teamIds)

  const { data: periods, error: pErr } = await db.from('league_periods')
    .insert(schedule.map((d) => ({ league_id: id, period_kind: 'matchday', period_number: d.round, name: `Matchday ${d.round}`, status: 'upcoming' })))
    .select('id, period_number')
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  const periodByRound = new Map<number, string>((periods ?? []).map((p: { id: string; period_number: number }) => [p.period_number, p.id]))

  let matchNum = 1
  const fixtureRows = schedule.flatMap((d) =>
    d.matchups.map((m) => ({
      league_id: id,
      period_id: periodByRound.get(d.round) ?? null,
      match_stage: 'team_matchup',
      round_number: d.round,
      match_number: matchNum++,
      team_1_id: m.team1Id,
      team_2_id: m.team2Id,
      status: 'scheduled',
    })),
  )
  if (fixtureRows.length) {
    const { error: fErr } = await db.from('league_fixtures').insert(fixtureRows)
    if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
  }

  await logAudit({ actorId: user.id, entityType: 'league', entityId: id, action: 'team_schedule_generated', after: { matchdays: schedule.length, matchups: fixtureRows.length } })
  return NextResponse.json({ ok: true, matchdays: schedule.length, matchups: fixtureRows.length })
}
