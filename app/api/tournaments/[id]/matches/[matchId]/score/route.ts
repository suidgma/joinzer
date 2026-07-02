import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { type MatchRow } from '@/lib/tournament/bracketBuilder'
import { resolveCompletion } from '@/lib/tournament/resolveCompletion'
import { resetDeciderSlot } from '@/lib/tournament/scheduleGenerator'
import { logAudit } from '@/lib/audit/log'
import { createNotifications } from '@/lib/notifications/create'
import { validateScores } from '@/lib/scoring/validateScores'

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

  const scoreCheck = validateScores(team_1_score, team_2_score)
  if (!scoreCheck.ok) {
    return NextResponse.json({ error: scoreCheck.error }, { status: 400 })
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

  // Pull the pre-update state for the audit "before" snapshot.
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

  // Idempotency guard: identical re-submit (double-click, retry, two devices) —
  // return without re-advancing or re-notifying.
  if (
    match.status === 'completed' &&
    match.winner_registration_id === winner_registration_id &&
    match.team_1_score === team_1_score &&
    match.team_2_score === team_2_score
  ) {
    return NextResponse.json({ match })
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

  // Notify all players in the match that the score was recorded.
  const regIds = [match.team_1_registration_id, match.team_2_registration_id].filter(Boolean)
  if (regIds.length > 0) {
    const { data: regs } = await service
      .from('tournament_registrations')
      .select('user_id, partner_user_id')
      .in('id', regIds)

    const recipientIds = [...new Set(
      (regs ?? []).flatMap(r => [r.user_id, r.partner_user_id].filter(Boolean))
    )]

    const { data: tourney } = await service
      .from('tournaments')
      .select('name')
      .eq('id', params.id)
      .single()

    await createNotifications(
      recipientIds.map(uid => ({
        recipientId: uid,
        surface: 'tournament' as const,
        surfaceId: params.id,
        kind: 'tournament_score_submitted',
        title: `Match complete — ${team_1_score}–${team_2_score}`,
        body: `${tourney?.name ?? 'Tournament'} match result has been recorded.`,
        url: `/tournaments/${params.id}/live`,
      }))
    )
  }

  // Advance via the shared resolver — same engine as the bracket PATCH route, so
  // single-elim, double-elim (LB drops, championship, bracket reset), and induced
  // BYEs all resolve identically no matter which surface entered the score.
  const { data: divisionMatches } = await service
    .from('tournament_matches')
    .select('id, round_number, match_number, match_stage, team_1_registration_id, team_2_registration_id, winner_registration_id, status')
    .eq('division_id', match.division_id)

  if (divisionMatches) {
    const completedMatch: MatchRow = { ...match, winner_registration_id, status: 'completed' }
    for (const mut of resolveCompletion(completedMatch, divisionMatches as MatchRow[])) {
      if (mut.kind === 'set') {
        // Only fill an empty slot — guards a concurrent write / re-score.
        await service
          .from('tournament_matches')
          .update({ [mut.field]: mut.value })
          .eq('id', mut.matchId)
          .is(mut.field, null)
      } else if (mut.kind === 'complete') {
        await service
          .from('tournament_matches')
          .update({ winner_registration_id: mut.winner, status: 'completed' })
          .eq('id', mut.matchId)
          .neq('status', 'completed')
      } else {
        // Bracket-reset decider — same court as the championship it follows, slotted
        // right after, so it isn't left without a court/time.
        const m = mut.match
        const slot = resetDeciderSlot(match.scheduled_time, match.scheduled_end_time)
        await service
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
      }
    }
  }

  return NextResponse.json({ match: updated })
}
