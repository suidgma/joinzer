import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { computeAdvancement, type MatchRow } from '@/lib/tournament/bracketBuilder'

const MATCH_SELECT = 'id, division_id, round_number, match_number, match_stage, pool_number, court_number, scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status'
const SLIM_SELECT  = 'id, round_number, match_number, match_stage, team_1_registration_id, team_2_registration_id, winner_registration_id, status'

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; matchId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const team_1_score = body.team_1_score
  const team_2_score = body.team_2_score

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

  // Verify organizer
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch match
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

  // Advance winner through the bracket, cascading over induced BYEs.
  // An induced BYE occurs when one team advances into a future-round slot but the
  // other slot is null because the bracket had an odd-sized half — the filled player
  // should auto-advance without needing a score entry.
  const advancedMatches: unknown[] = []

  const { data: initialDivMatches } = await service
    .from('tournament_matches')
    .select(SLIM_SELECT)
    .eq('division_id', match.division_id)

  if (initialDivMatches) {
    let currentCompleted: MatchRow = { ...match, winner_registration_id, status: 'completed' }
    let allDivMatches: MatchRow[] = initialDivMatches as MatchRow[]

    for (let step = 0; step < 10; step++) {
      const advancement = computeAdvancement(currentCompleted, allDivMatches)
      if (!advancement) break

      // Write the winner into the next-round slot and read back the updated row atomically.
      // A separate update + select risks a read-your-own-writes miss under connection pooling,
      // causing the freshly-written slot to appear null in the BYE check below.
      const { data: nextMatch } = await service
        .from('tournament_matches')
        .update({ [advancement.field]: advancement.value })
        .eq('id', advancement.matchId)
        .select(MATCH_SELECT)
        .single()

      if (!nextMatch) break

      const t1 = nextMatch.team_1_registration_id
      const t2 = nextMatch.team_2_registration_id

      if (t1 && t2) {
        // Both slots filled — match is ready to play
        advancedMatches.push(nextMatch)
        break
      }

      if (!t1 && !t2) break

      // One slot is filled, one is null. Distinguish a genuine induced BYE
      // (no real pending match will ever fill the null slot) from TBD
      // (another pending match in the same stage/round will eventually fill it).
      const otherField = advancement.field === 'team_1_registration_id'
        ? 'team_2_registration_id'
        : 'team_1_registration_id'

      const hasPendingFeeder = allDivMatches.some(m => {
        if (m.match_stage !== currentCompleted.match_stage) return false
        if (m.round_number !== currentCompleted.round_number) return false
        if (m.status === 'completed') return false
        if (!m.team_1_registration_id && !m.team_2_registration_id) return false
        if (m.id === currentCompleted.id) return false
        const adv = computeAdvancement(
          { ...m, winner_registration_id: m.team_1_registration_id ?? m.team_2_registration_id ?? '', status: 'completed' },
          allDivMatches
        )
        return adv?.matchId === nextMatch.id && adv?.field === otherField
      })

      if (hasPendingFeeder) {
        // TBD — another pending match will eventually fill the empty slot; stop here
        advancedMatches.push(nextMatch)
        break
      }

      // Genuine induced BYE — no real match will ever fill the empty slot
      const byeWinner = t1 ?? t2
      const { data: byeCompleted } = await service
        .from('tournament_matches')
        .update({ winner_registration_id: byeWinner, status: 'completed' })
        .eq('id', nextMatch.id)
        .select(MATCH_SELECT)
        .single()

      if (!byeCompleted) break
      advancedMatches.push(byeCompleted)

      // Re-fetch division matches so the next computeAdvancement sees the BYE completion
      const { data: freshMatches } = await service
        .from('tournament_matches')
        .select(SLIM_SELECT)
        .eq('division_id', match.division_id)

      if (!freshMatches) break
      allDivMatches = freshMatches as MatchRow[]
      currentCompleted = {
        id: byeCompleted.id,
        round_number: byeCompleted.round_number,
        match_number: byeCompleted.match_number,
        match_stage: byeCompleted.match_stage,
        team_1_registration_id: byeCompleted.team_1_registration_id,
        team_2_registration_id: byeCompleted.team_2_registration_id,
        winner_registration_id: byeCompleted.winner_registration_id,
        status: byeCompleted.status,
      }
    }
  }

  return NextResponse.json({ match: updated, advancedMatches })
}
