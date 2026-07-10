import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'
import { ladderAdmin, readLadderState } from '@/lib/leagues/ladderServer'
import { seedKotcRound, nextKotcRound, type CourtAssignment, type CourtResult } from '@/lib/leagues/ladder'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/ladder/round
// Generate the next king-of-the-court round for the active ladder session — or, with
// { regenerate: true }, rebuild the current (latest) round. Round 1 seeds present entrants
// onto courts of two by ladder rank; later rounds apply up-down movement from the prior
// round (which must be fully scored). Regenerate is useful when attendance changed
// (round 1) or an earlier score was corrected (later rounds). Organizer/co-admin.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = ladderAdmin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const body = await req.json().catch(() => ({}))
  const regenerate = body?.regenerate === true

  const { data: league } = await db.from('leagues').select('format, format_settings_json').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const settings = ((league as any).format_settings_json ?? {}) as Record<string, unknown>
  const roundsPerSession = Number(settings.rounds_per_session ?? 6) || 6

  const { data: period } = await db
    .from('league_periods')
    .select('id')
    .eq('league_id', params.id)
    .eq('period_kind', 'ladder_session')
    .eq('status', 'active')
    .maybeSingle()
  if (!period) return NextResponse.json({ error: 'No active session — start one first.' }, { status: 400 })

  const { data: fxRaw } = await db
    .from('league_fixtures')
    .select('id, round_number, court_number, match_number, match_stage, team_1_registration_id, team_2_registration_id, winner_registration_id, status')
    .eq('period_id', period.id)
  const fx = (fxRaw ?? []) as any[]
  const currentRound = fx.length ? Math.max(...fx.map((f) => f.round_number ?? 0)) : 0

  if (regenerate && currentRound === 0) {
    return NextResponse.json({ error: 'No round to regenerate yet.' }, { status: 400 })
  }

  // Generate the next round, or (regenerate) rebuild the current one. Either way the target
  // round is derived from the round before it: attendance for round 1, the prior round's
  // up-down results otherwise.
  const targetRound = regenerate ? currentRound : currentRound + 1
  const sourceRound = targetRound - 1

  let assignment: CourtAssignment

  if (sourceRound === 0) {
    // Round 1: seed present entrants (present / covered-by-sub) by ladder rank.
    const state = await readLadderState(db, params.id, (league as any).format, settings)
    const { data: att } = await db
      .from('league_attendance')
      .select('registration_id, status')
      .eq('period_id', period.id)
    const here = new Set(
      (att ?? []).filter((a: any) => a.registration_id && (a.status === 'present' || a.status === 'has_sub')).map((a: any) => a.registration_id),
    )
    const presentOrder = state.orderedIds.filter((id) => here.has(id))
    if (presentOrder.length < 2) {
      return NextResponse.json({ error: 'Mark at least 2 players Here before generating round 1.' }, { status: 400 })
    }
    assignment = seedKotcRound(presentOrder)
  } else {
    if (!regenerate && currentRound >= roundsPerSession) {
      return NextResponse.json({ error: `All ${roundsPerSession} rounds have been played — finish the session.` }, { status: 400 })
    }
    const roundFx = fx.filter((f) => f.match_stage === 'ladder_round' && f.round_number === sourceRound)
    const unscored = roundFx.filter((f) => f.status !== 'completed').length
    if (unscored > 0) {
      return NextResponse.json({ error: `Score all ${roundFx.length} courts in round ${sourceRound} first.`, incomplete: unscored }, { status: 409 })
    }
    const prevCourts = roundFx
      .slice()
      .sort((a, b) => (a.court_number ?? 0) - (b.court_number ?? 0))
      .map((f) => ({ court: f.court_number as number, a: f.team_1_registration_id as string, b: f.team_2_registration_id as string }))
    const byeRow = fx.find((f) => f.match_stage === 'ladder_bye' && f.round_number === sourceRound)
    const prev: CourtAssignment = { courts: prevCourts, bye: byeRow?.team_1_registration_id ?? null }
    const results: CourtResult[] = roundFx.map((f) => ({
      court: f.court_number as number,
      winner: f.winner_registration_id as string,
      loser: (f.team_1_registration_id === f.winner_registration_id ? f.team_2_registration_id : f.team_1_registration_id) as string,
    }))
    assignment = nextKotcRound(prev, results)
  }

  // Regenerate: clear the target round's existing courts/byes (incl. any scores) first.
  if (regenerate) {
    await db.from('league_fixtures').delete().eq('period_id', period.id).eq('round_number', targetRound)
  }

  // Match numbers sequence after all earlier rounds (excluding the round we're rebuilding).
  const baseFx = regenerate ? fx.filter((f) => f.round_number !== targetRound) : fx
  let nextMatchNum = baseFx.length ? Math.max(...baseFx.map((f) => f.match_number ?? 0)) + 1 : 1

  const rows = assignment.courts.map((c) => ({
    league_id: params.id,
    period_id: period.id,
    round_number: targetRound,
    court_number: c.court,
    match_number: nextMatchNum++,
    match_stage: 'ladder_round',
    team_1_registration_id: c.a,
    team_2_registration_id: c.b,
    status: 'scheduled',
  }))
  if (assignment.bye) {
    rows.push({
      league_id: params.id,
      period_id: period.id,
      round_number: targetRound,
      court_number: null as any,
      match_number: nextMatchNum++,
      match_stage: 'ladder_bye',
      team_1_registration_id: assignment.bye,
      team_2_registration_id: null as any,
      status: 'scheduled',
    })
  }

  const { error } = await db.from('league_fixtures').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, round: targetRound, regenerated: regenerate })
}
