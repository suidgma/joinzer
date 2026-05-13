import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { computeAdvancement, type MatchRow } from '@/lib/tournament/bracketBuilder'

// POST /api/tournaments/[id]/matches/[matchId]/score
// Organizer-only score write path for the tournament day view.
// Service-role backed — never uses anon key for writes.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; matchId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { team_1_score, team_2_score } = body

  if (typeof team_1_score !== 'number' || typeof team_2_score !== 'number') {
    return NextResponse.json({ error: 'Scores must be numbers' }, { status: 400 })
  }
  if (team_1_score < 0 || team_2_score < 0) {
    return NextResponse.json({ error: 'Scores cannot be negative' }, { status: 400 })
  }
  if (team_1_score === team_2_score) {
    return NextResponse.json({ error: 'Tie scores are not allowed' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: match } = await service
    .from('tournament_matches')
    .select('id, team_1_registration_id, team_2_registration_id, tournament_id, division_id, match_stage, round_number, match_number')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()
  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  const winner_registration_id = team_1_score > team_2_score
    ? match.team_1_registration_id
    : match.team_2_registration_id

  const { data: updated, error } = await service
    .from('tournament_matches')
    .update({ team_1_score, team_2_score, winner_registration_id, status: 'completed' })
    .eq('id', params.matchId)
    .select()
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  // TODO: write to audit_log once competition audit_log table is migrated (CLAUDE.md Section 6)
  console.log('[audit] score saved:', { matchId: params.matchId, team_1_score, team_2_score, actor: user.id })

  // Advance winner to next bracket slot if applicable
  const { data: divisionMatches } = await service
    .from('tournament_matches')
    .select('id, round_number, match_number, match_stage, team_1_registration_id, team_2_registration_id, winner_registration_id, status')
    .eq('division_id', match.division_id)

  if (divisionMatches) {
    const completedMatch: MatchRow = { ...match, winner_registration_id, status: 'completed' }
    const advancement = computeAdvancement(completedMatch, divisionMatches as MatchRow[])
    if (advancement) {
      await service
        .from('tournament_matches')
        .update({ [advancement.field]: advancement.value })
        .eq('id', advancement.matchId)
    }
  }

  return NextResponse.json({ match: updated })
}
