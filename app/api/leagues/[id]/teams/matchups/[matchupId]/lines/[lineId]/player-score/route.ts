import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin } from '@/lib/leagues/teamsServer'
import { validateScores } from '@/lib/scoring/validateScores'
import { rollUpMatchup, type LineChild } from '@/lib/leagues/teamMatchup'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; matchupId: string; lineId: string }> }

// PATCH /api/leagues/[id]/teams/matchups/[matchupId]/lines/[lineId]/player-score
// A player scores their own team-league line when the league allows it. Updates the line
// fixture and rolls the result up to the parent matchup (line wins → winner_team_id).
// Body: { team_1_score, team_2_score } aligned with the line's team_1/team_2 slots.
export async function PATCH(req: NextRequest, props: Params) {
  const { id, matchupId, lineId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const t1 = body.team_1_score
  const t2 = body.team_2_score
  const check = validateScores(t1, t2)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const db = teamAdmin()
  const { data: league } = await db.from('leagues').select('created_by, allow_player_scores').eq('id', id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!league.allow_player_scores) return NextResponse.json({ error: 'Player scoring is off for this league' }, { status: 403 })

  const { data: matchup } = await db.from('league_fixtures')
    .select('id, team_1_id, team_2_id').eq('id', matchupId).eq('league_id', id).eq('match_stage', 'team_matchup').maybeSingle()
  if (!matchup) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 })

  const { data: line } = await db.from('league_fixtures')
    .select('id, team_1_registration_id, team_1_partner_registration_id, team_2_registration_id, team_2_partner_registration_id')
    .eq('id', lineId).eq('parent_fixture_id', matchupId).eq('match_stage', 'team_line').maybeSingle()
  if (!line) return NextResponse.json({ error: 'Line not found' }, { status: 404 })

  // Participant check: the caller must be one of this line's four possible registrations.
  const regIds = [line.team_1_registration_id, line.team_1_partner_registration_id, line.team_2_registration_id, line.team_2_partner_registration_id].filter(Boolean) as string[]
  const { data: regs } = await db.from('league_registrations').select('id, user_id').in('id', regIds)
  const participants = new Set((regs ?? []).map((r) => r.user_id).filter(Boolean))
  let allowed = league.created_by === user.id || participants.has(user.id)
  if (!allowed) {
    const { data: myReg } = await db.from('league_registrations').select('is_co_admin').eq('league_id', id).eq('user_id', user.id).maybeSingle()
    allowed = myReg?.is_co_admin === true
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Update this line + recompute the parent matchup (other lines keep their stored scores).
  const { data: children } = await db.from('league_fixtures')
    .select('id, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, status')
    .eq('parent_fixture_id', matchupId).eq('match_stage', 'team_line')
  const provided = new Map([[lineId, { team_1_score: t1 as number, team_2_score: t2 as number }]])
  const rollup = rollUpMatchup((children ?? []) as LineChild[], provided, (matchup as any).team_1_id, (matchup as any).team_2_id)

  for (const u of rollup.childUpdates) {
    const { error } = await db.from('league_fixtures')
      .update({ team_1_score: u.team_1_score, team_2_score: u.team_2_score, winner_registration_id: u.winner_registration_id, status: u.status })
      .eq('id', u.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const parentStatus = rollup.completed ? 'completed' : 'scheduled'
  const { error: parentErr } = await db.from('league_fixtures')
    .update({ team_1_score: rollup.team1Lines, team_2_score: rollup.team2Lines, winner_team_id: rollup.winnerTeamId, status: parentStatus })
    .eq('id', matchupId)
  if (parentErr) return NextResponse.json({ error: parentErr.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: matchupId, action: 'score_updated', after: { line: lineId, team_1_score: t1, team_2_score: t2 } })
  return NextResponse.json({ ok: true, team1Lines: rollup.team1Lines, team2Lines: rollup.team2Lines, completed: rollup.completed })
}
