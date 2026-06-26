import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '@/lib/tournament/standings'
import { poolStandings, type PoolMatchInput } from '@/lib/tournament/poolPlayoffSeeding'
import { resolvePlayoffSource, type PlayoffSource } from '@/lib/tournament/playoffPlaceholders'
import { resolveBracket } from '@/lib/tournament/resolveCompletion'
import type { MatchRow } from '@/lib/tournament/bracketBuilder'

const PLAYOFF_STAGES = ['playoffs', 'single_elimination', 'winners_bracket', 'losers_bracket', 'championship']
const MATCH_SELECT =
  'id, division_id, round_number, match_number, match_stage, pool_number, court_number, ' +
  'scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, ' +
  'winner_registration_id, status, team_1_source, team_2_source'

// POST — seed the (already-created) playoff bracket once base play is complete:
// fill each first-round placeholder slot with the actual team from the final
// standings, then cascade byes/advancement. Idempotent: a no-op once filled.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments').select('organizer_id').eq('id', params.id).single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, bracket_type')
    .eq('id', params.divisionId).eq('tournament_id', params.id).single()
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
  const isRR = division.bracket_type === 'round_robin'
  const isPool = division.bracket_type === 'pool_play_playoffs'
  if (!isRR && !isPool) {
    return NextResponse.json({ error: 'Playoffs only apply to round-robin and pool-play divisions' }, { status: 400 })
  }

  const { data: matchesRaw } = await service
    .from('tournament_matches').select(MATCH_SELECT)
    .eq('division_id', params.divisionId).eq('is_draft', false)
  const matches = (matchesRaw ?? []) as any[]

  const baseStage = isRR ? 'round_robin' : 'pool_play'
  const baseMatches = matches.filter(m => m.match_stage === baseStage)
  if (baseMatches.length === 0) {
    return NextResponse.json({ error: `Generate the ${isRR ? 'round-robin' : 'pool'} matches first` }, { status: 400 })
  }
  if (!baseMatches.every(m => m.status === 'completed')) {
    return NextResponse.json({ error: `Finish all ${isRR ? 'round-robin' : 'pool'} matches first` }, { status: 409 })
  }

  const toFill = matches.filter(m =>
    PLAYOFF_STAGES.includes(m.match_stage) && (m.team_1_source != null || m.team_2_source != null))
  if (toFill.length === 0) {
    return NextResponse.json({ matches }) // already seeded — nothing to do
  }

  // Settled registrations + names for the standings tiebreak.
  const { data: regsRaw } = await service
    .from('tournament_registrations')
    .select('id, user_id, status, partner_registration_id')
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')
    .in('payment_status', ['paid', 'waived', 'comped'])
  const regsList = (regsRaw ?? []) as any[]
  const userIds = Array.from(new Set(regsList.map(r => r.user_id).filter(Boolean)))
  const { data: profiles } = userIds.length > 0
    ? await service.from('profiles').select('id, name').in('id', userIds)
    : { data: [] }
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.id, p.name]))
  const nameByReg = new Map<string, string>(regsList.map(r => [r.id, nameByUser.get(r.user_id) ?? r.id]))
  const nameOf = (regId: string) => nameByReg.get(regId) ?? regId

  const overall = isRR
    ? computeStandings(baseMatches as StandingsMatchInput[], regsList as StandingsRegInput[], nameOf)
    : []
  const poolMap = new Map<number, { regId: string }[]>()
  if (isPool) {
    for (const { pool, rows } of poolStandings(baseMatches as PoolMatchInput[], regsList as StandingsRegInput[], nameOf)) {
      poolMap.set(pool, rows)
    }
  }

  // Fill each first-round placeholder slot from its source position.
  for (const m of toFill) {
    const t1 = m.team_1_source ? resolvePlayoffSource(m.team_1_source as PlayoffSource, overall, poolMap) : m.team_1_registration_id
    const t2 = m.team_2_source ? resolvePlayoffSource(m.team_2_source as PlayoffSource, overall, poolMap) : m.team_2_registration_id
    await service.from('tournament_matches').update({
      team_1_registration_id: t1, team_2_registration_id: t2,
      team_1_source: null, team_2_source: null,
    }).eq('id', m.id)
    m.team_1_registration_id = t1; m.team_2_registration_id = t2
    m.team_1_source = null; m.team_2_source = null
  }

  // Cascade: auto-complete byes and advance their winners into the next round.
  for (const mut of resolveBracket(matches as MatchRow[])) {
    if (mut.kind === 'set') {
      await service.from('tournament_matches').update({ [mut.field]: mut.value })
        .eq('id', mut.matchId).is(mut.field, null)
    } else if (mut.kind === 'complete') {
      await service.from('tournament_matches').update({ winner_registration_id: mut.winner, status: 'completed' })
        .eq('id', mut.matchId).neq('status', 'completed')
    }
    // 'insert' (the double-elim reset decider) never occurs at seed time — the
    // championship hasn't been played yet — so it's intentionally not handled here.
  }

  const { data: final } = await service
    .from('tournament_matches').select(MATCH_SELECT)
    .eq('division_id', params.divisionId).eq('is_draft', false)
    .order('match_number', { ascending: true })
  return NextResponse.json({ matches: final ?? [] })
}
