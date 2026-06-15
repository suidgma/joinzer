import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { computeAdvancement, computeLbDrop, computeChampionshipAdvancement, type MatchRow } from '@/lib/tournament/bracketBuilder'
import { logAudit } from '@/lib/audit/log'

const MATCH_SELECT = 'id, division_id, round_number, match_number, match_stage, pool_number, court_number, scheduled_time, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status'
const SLIM_SELECT  = 'id, round_number, match_number, match_stage, team_1_registration_id, team_2_registration_id, winner_registration_id, status'

// Returns true if a match will eventually have real players — it already has at least
// one team, or one of its same-stage predecessor matches is real (not phantom/padded).
// Distinguishes "temporarily null-null, waiting for upstream results" from
// "phantom null-null, a padded bracket slot that will never have players".
function matchWillBeReal(match: MatchRow, allMatches: MatchRow[], depth = 0): boolean {
  if (depth > 6) return false
  if (match.team_1_registration_id || match.team_2_registration_id) return true
  const round = match.round_number ?? 1
  if (round <= 1) return false  // R1 null-null with no teams = phantom
  const sameRound = allMatches
    .filter(m => m.match_stage === match.match_stage && m.round_number === round)
    .sort((a, b) => a.match_number - b.match_number)
  const idx = sameRound.findIndex(m => m.id === match.id)
  if (idx === -1) return false
  const prevRound = allMatches
    .filter(m => m.match_stage === match.match_stage && m.round_number === round - 1)
    .sort((a, b) => a.match_number - b.match_number)
  const f1 = prevRound[idx * 2]
  const f2 = prevRound[idx * 2 + 1]
  return (
    (f1 != null && matchWillBeReal(f1, allMatches, depth + 1)) ||
    (f2 != null && matchWillBeReal(f2, allMatches, depth + 1))
  )
}

// Returns true if the empty slot of nextMatch will eventually be filled by a real pending match.
// Checks both same-stage feeders AND WB drop-in feeders for LB drop-in rounds.
function checkPendingFeeder(
  nextMatch: { id: string; match_stage: string; round_number: number | null },
  otherField: 'team_1_registration_id' | 'team_2_registration_id',
  currentCompleted: MatchRow,
  allDivMatches: MatchRow[],
): boolean {
  // Championship always waits — its two participants come from different stages
  // (WB Final winner and LB Final winner). Never treat it as an induced BYE.
  if (nextMatch.match_stage === 'championship') return true

  // Same-stage feeder: a pending match in the same stage/round that advances here
  const hasSameStageFeeder = allDivMatches.some(m => {
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
  if (hasSameStageFeeder) return true

  // For LB drop-in rounds (odd round numbers), also check if a pending WB match
  // will eventually drop a loser into the empty slot.
  // Use positional math (not computeLbDrop) so null-null WB matches that are
  // "waiting for their own WB R1 feeders" still count as real pending feeders.
  if (nextMatch.match_stage === 'losers_bracket') {
    const lbRound = nextMatch.round_number ?? 1
    if (lbRound % 2 === 1) {
      const expectedWbRound = (lbRound + 1) / 2
      const wbRoundMatches = allDivMatches
        .filter(m => m.match_stage === 'winners_bracket' && m.round_number === expectedWbRound)
        .sort((a, b) => a.match_number - b.match_number)
      const lbTargetRound = expectedWbRound === 1 ? 1 : expectedWbRound * 2 - 1
      const lbTargetMatches = allDivMatches
        .filter(m => m.match_stage === 'losers_bracket' && m.round_number === lbTargetRound)
        .sort((a, b) => a.match_number - b.match_number)
      return wbRoundMatches.some((wbM, wbIdx) => {
        if (wbM.status === 'completed') return false
        // Determine which LB slot this WB match's loser would drop into, by position
        let lbMatchIdx: number
        let lbField: 'team_1_registration_id' | 'team_2_registration_id'
        if (expectedWbRound === 1) {
          lbMatchIdx = Math.floor(wbIdx / 2)
          lbField = wbIdx % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
        } else {
          lbMatchIdx = wbIdx
          lbField = 'team_2_registration_id'
        }
        const targetLbMatch = lbTargetMatches[lbMatchIdx]
        if (!targetLbMatch || targetLbMatch.id !== nextMatch.id || lbField !== otherField) {
          return false
        }
        // Correct drop target — only count if the WB match is real (not a phantom padded slot)
        return matchWillBeReal(wbM, allDivMatches)
      })
    }
  }

  return false
}

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
    const candidateNext = nextRound[Math.floor(posInRound / 2)]
    const candidateField: 'team_1_registration_id' | 'team_2_registration_id' =
      posInRound % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
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
          .select(MATCH_SELECT)
          .single()

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
            .select(MATCH_SELECT)
            .single()
          if (champMatch) advancedMatches.push(champMatch)
        }
      }
    }
  }

  return NextResponse.json({ match: updated, advancedMatches })
}
