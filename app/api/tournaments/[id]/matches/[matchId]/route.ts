import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveCompletion, type Mutation } from '@/lib/tournament/resolveCompletion'
import { type MatchRow } from '@/lib/tournament/bracketBuilder'
import { resetDeciderSlot } from '@/lib/tournament/scheduleGenerator'
import { logAudit } from '@/lib/audit/log'

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

  // Fetch match (incl. pre-update score state for the audit "before" snapshot)
  const { data: match } = await service
    .from('tournament_matches')
    .select('id, team_1_registration_id, team_2_registration_id, tournament_id, division_id, match_stage, round_number, match_number, court_number, scheduled_time, scheduled_end_time, team_1_score, team_2_score, winner_registration_id, status')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  const winner_registration_id = team_1_score > team_2_score
    ? match.team_1_registration_id
    : match.team_2_registration_id

  // Idempotency guard: if this exact result was already recorded (double-click,
  // retry, or two devices submitting the same score), return without re-running
  // the advancement cascade. Re-cascading could double-fill downstream slots.
  if (
    match.status === 'completed' &&
    match.winner_registration_id === winner_registration_id &&
    match.team_1_score === team_1_score &&
    match.team_2_score === team_2_score
  ) {
    return NextResponse.json({ match, advancedMatches: [] })
  }

  const { data: updated, error } = await service
    .from('tournament_matches')
    .update({ team_1_score, team_2_score, winner_registration_id, status: 'completed' })
    .eq('id', params.matchId)
    .select()
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  // Audit the score write. Non-blocking — logAudit swallows + logs errors.
  await logAudit({
    actorId:    user.id,
    entityType: 'tournament_match',
    entityId:   params.matchId,
    action:     'score_updated',
    before: {
      team_1_score:           match.team_1_score,
      team_2_score:           match.team_2_score,
      winner_registration_id: match.winner_registration_id,
      status:                 match.status,
    },
    after: {
      team_1_score,
      team_2_score,
      winner_registration_id,
      status: 'completed',
    },
  })

  const advancedMatches: unknown[] = []

  // Single source of truth for advancement: the explicit-topology resolver. It
  // takes the just-completed result plus the division's matches and returns every
  // follow-on change — winner/loser placements, induced-BYE auto-completions, the
  // championship advances, and the if-necessary bracket reset — as flat mutations.
  // Correct by construction for single-elim, double-elim, and non-power-of-2 fields.
  const { data: divMatches } = await service
    .from('tournament_matches')
    .select(SLIM_SELECT)
    .eq('division_id', match.division_id)

  if (divMatches) {
    const completedRow: MatchRow = { ...match, winner_registration_id, status: 'completed' }
    const mutations: Mutation[] = resolveCompletion(completedRow, divMatches as MatchRow[])

    for (const mut of mutations) {
      if (mut.kind === 'set') {
        // Only fill an empty slot — a 0-row update (concurrent write / re-score) returns null.
        const { data } = await service
          .from('tournament_matches')
          .update({ [mut.field]: mut.value })
          .eq('id', mut.matchId)
          .is(mut.field, null)
          .select(MATCH_SELECT)
          .maybeSingle()
        if (data) advancedMatches.push(data)
      } else if (mut.kind === 'complete') {
        const { data } = await service
          .from('tournament_matches')
          .update({ winner_registration_id: mut.winner, status: 'completed' })
          .eq('id', mut.matchId)
          .neq('status', 'completed')
          .select(MATCH_SELECT)
          .maybeSingle()
        if (data) advancedMatches.push(data)
      } else {
        // insert — the bracket-reset decider (round 2 championship). It plays on the
        // just-scored championship's court, right after it, so it isn't left without
        // a court/time (the block packer never sees this reactively-created match).
        const m = mut.match
        const slot = resetDeciderSlot(match.scheduled_time, match.scheduled_end_time)
        const { data } = await service
          .from('tournament_matches')
          .insert({
            tournament_id: match.tournament_id,
            division_id: match.division_id,
            match_stage: m.match_stage,
            round_number: m.round_number,
            match_number: m.match_number,
            team_1_registration_id: m.team_1_registration_id,
            team_2_registration_id: m.team_2_registration_id,
            court_number: match.court_number ?? null,
            scheduled_time: slot.scheduled_time,
            scheduled_end_time: slot.scheduled_end_time,
            status: 'scheduled',
          })
          .select(MATCH_SELECT)
          .single()
        if (data) advancedMatches.push(data)
      }
    }
  }

  return NextResponse.json({ match: updated, advancedMatches })
}
