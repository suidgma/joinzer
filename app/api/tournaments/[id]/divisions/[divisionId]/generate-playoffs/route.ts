import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { playoffBracket } from '@/lib/tournament/bracketBuilder'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '@/lib/tournament/standings'

// Match stages that mean a playoff bracket already exists for the division.
const PLAYOFF_STAGES = ['playoffs', 'single_elimination', 'winners_bracket', 'losers_bracket', 'championship']

const MATCH_SELECT =
  'id, division_id, round_number, match_number, match_stage, pool_number, court_number, ' +
  'scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, ' +
  'winner_registration_id, status'

// POST — generate the playoff bracket for a round-robin division. The top-N
// finishers (by round-robin standings) are seeded into a single-elimination
// bracket; the final is single or double-elim per the division's playoff_format.
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
    .select('id, bracket_type, format_settings_json')
    .eq('id', params.divisionId).eq('tournament_id', params.id).single()
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
  if (division.bracket_type !== 'round_robin') {
    return NextResponse.json({ error: 'Playoffs are only available for round-robin divisions' }, { status: 400 })
  }

  const fs = (division.format_settings_json ?? {}) as Record<string, unknown>
  if (!fs.playoffs_enabled) {
    return NextResponse.json({ error: 'Playoffs are not enabled for this division' }, { status: 400 })
  }
  const finalFormat = fs.playoff_format === 'double_elimination' ? 'double_elimination' : 'single_elimination'
  const qualifiers = [2, 4, 6, 8].includes(fs.playoff_qualifiers as number) ? (fs.playoff_qualifiers as number) : 2

  // All division matches — used to check completion, find the next match_number,
  // and confirm playoffs aren't already generated.
  const { data: matchesRaw } = await service
    .from('tournament_matches')
    .select(MATCH_SELECT)
    .eq('division_id', params.divisionId)
    .eq('is_draft', false)
  const all = (matchesRaw ?? []) as any[]

  if (all.some(m => PLAYOFF_STAGES.includes(m.match_stage))) {
    return NextResponse.json({ error: 'Playoffs have already been generated for this division' }, { status: 409 })
  }
  const roundRobin = all.filter(m => m.match_stage === 'round_robin')
  if (roundRobin.length === 0) {
    return NextResponse.json({ error: 'Generate and play the round-robin matches first' }, { status: 400 })
  }
  if (!roundRobin.every(m => m.status === 'completed')) {
    return NextResponse.json({ error: 'Finish all round-robin matches before generating playoffs' }, { status: 409 })
  }

  // Settled registrations — the only teams eligible for the playoff.
  const { data: regsRaw } = await service
    .from('tournament_registrations')
    .select('id, user_id, status, partner_registration_id')
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')
    .in('payment_status', ['paid', 'waived', 'comped'])
  const regsList = (regsRaw ?? []) as any[]

  // Names for the standings tiebreak (so equal records resolve deterministically).
  const userIds = Array.from(new Set(regsList.map(r => r.user_id).filter(Boolean)))
  const { data: profiles } = userIds.length > 0
    ? await service.from('profiles').select('id, name').in('id', userIds)
    : { data: [] }
  const nameByUser = new Map((profiles ?? []).map((p: any) => [p.id, p.name]))
  const nameByReg = new Map<string, string>(regsList.map(r => [r.id, nameByUser.get(r.user_id) ?? r.id]))

  // Standings from round-robin matches only — playoff results never seed the bracket.
  const standings = computeStandings(
    roundRobin as StandingsMatchInput[],
    regsList as StandingsRegInput[],
    (regId: string) => nameByReg.get(regId) ?? regId,
  )
  const n = Math.min(qualifiers, standings.length)
  if (n < 2) {
    return NextResponse.json({ error: 'Need at least 2 teams to run a playoff' }, { status: 400 })
  }
  const seeded = standings.slice(0, n).map(s => s.regId)   // canonical team reg ids, best first

  const maxMatchNum = all.reduce((mx, m) => Math.max(mx, m.match_number ?? 0), 0)
  const base = { tournament_id: params.id, division_id: params.divisionId, status: 'scheduled' }
  const { rows } = playoffBracket(seeded, finalFormat, base, maxMatchNum + 1)

  const { data: inserted, error } = await service
    .from('tournament_matches')
    .insert(rows)
    .select(MATCH_SELECT)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ matches: inserted ?? [] })
}
