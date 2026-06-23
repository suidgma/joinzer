import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { computeAdvancement, computeLbDrop, computeChampionshipAdvancement, computeBracketReset, matchWillBeReal, checkPendingFeeder, type MatchRow } from '@/lib/tournament/bracketBuilder'
import { logAudit } from '@/lib/audit/log'

const MATCH_SELECT = 'id, division_id, round_number, match_number, match_stage, pool_number, court_number, scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status'
const SLIM_SELECT  = 'id, round_number, match_number, match_stage, team_1_registration_id, team_2_registration_id, winner_registration_id, status'

// Cascades a completed match's winner forward, resolving induced BYEs along the way.
// Returns a list of all DB rows that were updated (for client state sync).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cascadeWinner(
  service: any,
  divisionId: string,
  initialCompleted: MatchRow,
  initialAllMatches: MatchRow[],
): Promise<unknown[]> {
  const advanced: unknown[] = []
  let currentCompleted = initialCompleted
  let allDivMatches = initialAllMatches

  for (let step = 0; step < 10; step++) {
    const advancement = computeAdvancement(currentCompleted, allDivMatches)
    if (!advancement) break

    // Guard: only fill the slot if it's still empty. If a concurrent write
    // (or a re-score) already filled it, this matches 0 rows and returns null,
    // so we stop rather than double-advancing.
    const { data: nextMatch } = await service
      .from('tournament_matches')
      .update({ [advancement.field]: advancement.value })
      .eq('id', advancement.matchId)
      .is(advancement.field, null)
      .select(MATCH_SELECT)
      .maybeSingle()

    if (!nextMatch) break

    const t1 = nextMatch.team_1_registration_id
    const t2 = nextMatch.team_2_registration_id

    if (t1 && t2) {
      advanced.push(nextMatch)
      break
    }

    if (!t1 && !t2) break

    const otherField = advancement.field === 'team_1_registration_id'
      ? 'team_2_registration_id'
      : 'team_1_registration_id'

    const hasPendingFeeder = checkPendingFeeder(
      { id: nextMatch.id, match_stage: nextMatch.match_stage, round_number: nextMatch.round_number },
      otherField,
      currentCompleted,
      allDivMatches,
    )

    if (hasPendingFeeder) {
      advanced.push(nextMatch)
      break
    }

    // Genuine induced BYE — auto-complete this match and continue cascading
    const byeWinner = t1 ?? t2
    const { data: byeCompleted } = await service
      .from('tournament_matches')
      .update({ winner_registration_id: byeWinner, status: 'completed' })
      .eq('id', nextMatch.id)
      .select(MATCH_SELECT)
      .single()

    if (!byeCompleted) break
    advanced.push(byeCompleted)

    const { data: freshMatches } = await service
      .from('tournament_matches')
      .select(SLIM_SELECT)
      .eq('division_id', divisionId)

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

  return advanced
}

// After dropping a loser into an LB slot, check if the target match is now an
// induced BYE (one team filled, the other will never be filled by a prior LB round),
// and if so auto-complete it and cascade forward.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cascadeLbDropInducedByes(
  service: any,
  divisionId: string,
  lbMatch: Record<string, unknown>,
): Promise<unknown[]> {
  const advanced: unknown[] = []
  const t1 = lbMatch.team_1_registration_id as string | null
  const t2 = lbMatch.team_2_registration_id as string | null

  if ((!t1 && !t2) || (t1 && t2)) return advanced  // phantom or real match, nothing to do

  const { data: freshMatches } = await service
    .from('tournament_matches')
    .select(SLIM_SELECT)
    .eq('division_id', divisionId)

  if (!freshMatches) return advanced
  const allMatches = freshMatches as MatchRow[]

  const emptyField: 'team_1_registration_id' | 'team_2_registration_id' =
    t1 ? 'team_2_registration_id' : 'team_1_registration_id'
  const lbRoundNum = lbMatch.round_number as number ?? 1

  // Check if any pending previous-LB-round match will fill the empty slot.
  // Uses positional target check so null-null LB R(N-1) matches (e.g. LB R2 waiting
  // for a LB R1 result) still count as real pending feeders — not phantom slots.
  const hasPendingPrevRoundFeeder = allMatches.some(m => {
    if (m.match_stage !== (lbMatch.match_stage as string)) return false
    if (m.round_number !== lbRoundNum - 1) return false
    if (m.status === 'completed') return false
    if (!matchWillBeReal(m, allMatches)) return false
    // Positional advancement check: does m's winner go to lbMatch's emptyField?
    const sameRound = allMatches
      .filter(x => x.match_stage === m.match_stage && x.round_number === m.round_number)
      .sort((a, b) => a.match_number - b.match_number)
    const posInRound = sameRound.findIndex(x => x.id === m.id)
    if (posInRound === -1) return false
    const nextRound = allMatches
      .filter(x => x.match_stage === m.match_stage && x.round_number === (m.round_number ?? 1) + 1)
      .sort((a, b) => a.match_number - b.match_number)
    // Mirror computeAdvancement's LB rule: into a "minor" round each survivor
    // takes its own match as team_1; into a "major" round (odd >= 3) they pair.
    const intoRound = (m.round_number ?? 1) + 1
    const minorInto = m.match_stage === 'losers_bracket' && !(intoRound % 2 === 1 && intoRound >= 3)
    const candidateNext = minorInto ? nextRound[posInRound] : nextRound[Math.floor(posInRound / 2)]
    const candidateField: 'team_1_registration_id' | 'team_2_registration_id' =
      minorInto ? 'team_1_registration_id' : (posInRound % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id')
    return candidateNext?.id === (lbMatch.id as string) && candidateField === emptyField
  })

  if (hasPendingPrevRoundFeeder) return advanced  // TBD, not an induced BYE

  // Genuine induced BYE — auto-complete and cascade
  const byeWinner = t1 ?? t2
  const { data: byeCompleted } = await service
    .from('tournament_matches')
    .update({ winner_registration_id: byeWinner, status: 'completed' })
    .eq('id', lbMatch.id as string)
    .select(MATCH_SELECT)
    .single()

  if (!byeCompleted) return advanced
  advanced.push(byeCompleted)

  const { data: freshAfterBye } = await service
    .from('tournament_matches')
    .select(SLIM_SELECT)
    .eq('division_id', divisionId)

  if (freshAfterBye) {
    const byeMatchRow: MatchRow = {
      id: byeCompleted.id,
      round_number: byeCompleted.round_number,
      match_number: byeCompleted.match_number,
      match_stage: byeCompleted.match_stage,
      team_1_registration_id: byeCompleted.team_1_registration_id,
      team_2_registration_id: byeCompleted.team_2_registration_id,
      winner_registration_id: byeCompleted.winner_registration_id,
      status: byeCompleted.status,
    }
    const moreCascades = await cascadeWinner(
      service, divisionId, byeMatchRow, freshAfterBye as MatchRow[]
    )
    advanced.push(...moreCascades)
  }

  return advanced
}

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
    .select('id, team_1_registration_id, team_2_registration_id, tournament_id, division_id, match_stage, round_number, match_number, team_1_score, team_2_score, winner_registration_id, status')
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

  const { data: initialDivMatches } = await service
    .from('tournament_matches')
    .select(SLIM_SELECT)
    .eq('division_id', match.division_id)

  if (initialDivMatches) {
    const completedMatchRow: MatchRow = { ...match, winner_registration_id, status: 'completed' }
    const wbAdvanced = await cascadeWinner(
      service, match.division_id, completedMatchRow, initialDivMatches as MatchRow[]
    )
    advancedMatches.push(...wbAdvanced)
  }

  // For WB matches with a real loser, drop the loser into the Losers Bracket
  // and resolve any resulting induced BYEs in the LB (e.g. a WB loser who gets
  // placed into an LB match with no opposing LB survivor should auto-advance).
  if (match.match_stage === 'winners_bracket') {
    const { data: freshForLb } = await service
      .from('tournament_matches')
      .select(SLIM_SELECT)
      .eq('division_id', match.division_id)

    if (freshForLb) {
      const completedForLb: MatchRow = { ...match, winner_registration_id, status: 'completed' }
      const lbDrop = computeLbDrop(completedForLb, freshForLb as MatchRow[])
      if (lbDrop) {
        const { data: lbMatch } = await service
          .from('tournament_matches')
          .update({ [lbDrop.field]: lbDrop.value })
          .eq('id', lbDrop.matchId)
          .is(lbDrop.field, null)
          .select(MATCH_SELECT)
          .maybeSingle()

        if (lbMatch) {
          advancedMatches.push(lbMatch)
          // Cascade any induced BYEs created by this drop
          const lbByes = await cascadeLbDropInducedByes(
            service, match.division_id, lbMatch as Record<string, unknown>
          )
          // Replace the lbMatch entry if it was auto-completed, then add further advances
          if (lbByes.length > 0) {
            const firstBye = lbByes[0] as Record<string, unknown>
            if (firstBye.id === lbMatch.id) {
              advancedMatches[advancedMatches.length - 1] = firstBye
              advancedMatches.push(...lbByes.slice(1))
            } else {
              advancedMatches.push(...lbByes)
            }
          }
        }
      }
    }
  }

  // Advance WB Final winner → Championship team_1, or LB Final winner → Championship team_2.
  // Must also check cascaded auto-completions (e.g. LB Final BYE-cascaded by cascadeWinner)
  // because computeChampionshipAdvancement needs the actual final-round match, not the
  // earlier match that triggered the cascade.
  {
    const { data: freshForChamp } = await service
      .from('tournament_matches')
      .select(SLIM_SELECT)
      .eq('division_id', match.division_id)
    if (freshForChamp) {
      const allFresh = freshForChamp as MatchRow[]
      const candidates: MatchRow[] = [
        { ...match, winner_registration_id, status: 'completed' },
        ...(advancedMatches as MatchRow[]).filter(m => m.status === 'completed' && !!m.winner_registration_id),
      ]
      for (const candidate of candidates) {
        const champAdv = computeChampionshipAdvancement(candidate, allFresh)
        if (champAdv) {
          const { data: champMatch } = await service
            .from('tournament_matches')
            .update({ [champAdv.field]: champAdv.value })
            .eq('id', champAdv.matchId)
            .is(champAdv.field, null)
            .select(MATCH_SELECT)
            .maybeSingle()
          if (champMatch) advancedMatches.push(champMatch)
        }
      }
    }
  }

  // Double-elim bracket reset: if the losers-bracket champion won the first
  // Championship, both teams now have one loss — create the decider (round 2) so
  // the undefeated winners-bracket champion gets their earned rematch.
  if (match.match_stage === 'championship') {
    const { data: allDivMatches } = await service
      .from('tournament_matches')
      .select(SLIM_SELECT)
      .eq('division_id', match.division_id)
    const reset = computeBracketReset(
      { ...match, winner_registration_id, status: 'completed' } as MatchRow,
      (allDivMatches ?? []) as MatchRow[],
    )
    if (reset) {
      const { data: resetMatch } = await service
        .from('tournament_matches')
        .insert({ tournament_id: match.tournament_id, division_id: match.division_id, ...reset })
        .select(MATCH_SELECT)
        .single()
      if (resetMatch) advancedMatches.push(resetMatch)
    }
  }

  return NextResponse.json({ match: updated, advancedMatches })
}
