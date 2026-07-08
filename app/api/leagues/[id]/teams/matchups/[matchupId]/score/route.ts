import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer } from '@/lib/leagues/teamsServer'
import { validateScores } from '@/lib/scoring/validateScores'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; matchupId: string }> }

// PATCH /api/leagues/[id]/teams/matchups/[matchupId]/score
// Scores the individual line fixtures of a team matchup and rolls the result up to the
// parent team_matchup. Body: { lines: [{ id, team_1_score, team_2_score } | null, …] }
// — one entry per child line (null = leave unscored). Parent tally = line wins per team;
// winner_team_id = the team that won more lines; status='completed' once every line is in.
export async function PATCH(req: NextRequest, props: Params) {
  const { id, matchupId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: matchup } = await db.from('league_fixtures')
    .select('id, team_1_id, team_2_id, team_1_score, team_2_score, winner_team_id, status')
    .eq('id', matchupId).eq('league_id', id).eq('match_stage', 'team_matchup').maybeSingle()
  if (!matchup) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 })

  const { data: childrenRaw } = await db.from('league_fixtures')
    .select('id, match_number, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, status')
    .eq('parent_fixture_id', matchupId).order('match_number', { ascending: true })
  const children = (childrenRaw ?? []) as any[]
  if (children.length === 0) return NextResponse.json({ error: 'Set the lineup before scoring' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const scores = Array.isArray(body.lines) ? body.lines : []
  const byId = new Map<string, { team_1_score: number; team_2_score: number }>()
  for (const s of scores) {
    if (!s || s.team_1_score == null || s.team_2_score == null) continue
    const check = validateScores(s.team_1_score, s.team_2_score)
    if (!check.ok) return NextResponse.json({ error: `Line score: ${check.error}` }, { status: 400 })
    byId.set(s.id, { team_1_score: s.team_1_score, team_2_score: s.team_2_score })
  }

  // Apply each provided line score to its child fixture.
  for (const child of children) {
    const s = byId.get(child.id)
    if (!s) continue
    const winner_registration_id = s.team_1_score > s.team_2_score ? child.team_1_registration_id : child.team_2_registration_id
    const { error } = await db.from('league_fixtures')
      .update({ team_1_score: s.team_1_score, team_2_score: s.team_2_score, winner_registration_id, status: 'completed' })
      .eq('id', child.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Roll up the parent from the fresh child state.
  const merged = children.map((c) => {
    const s = byId.get(c.id)
    return s ? { ...c, ...s, status: 'completed' } : c
  })
  let team1Lines = 0
  let team2Lines = 0
  for (const c of merged) {
    if (c.status !== 'completed' || c.team_1_score == null || c.team_2_score == null) continue
    if (c.team_1_score > c.team_2_score) team1Lines++
    else team2Lines++
  }
  const allScored = merged.every((c) => c.status === 'completed')
  const winner_team_id = !allScored || team1Lines === team2Lines
    ? null
    : team1Lines > team2Lines ? (matchup as any).team_1_id : (matchup as any).team_2_id

  const { error: parentErr } = await db.from('league_fixtures')
    .update({ team_1_score: team1Lines, team_2_score: team2Lines, winner_team_id, status: allScored ? 'completed' : 'scheduled' })
    .eq('id', matchupId)
  if (parentErr) return NextResponse.json({ error: parentErr.message }, { status: 500 })

  await logAudit({
    actorId: user.id,
    entityType: 'league_match',
    entityId: matchupId,
    action: 'score_updated',
    before: { team_1_score: (matchup as any).team_1_score, team_2_score: (matchup as any).team_2_score, status: (matchup as any).status },
    after: { team_1_score: team1Lines, team_2_score: team2Lines, winner_team_id, status: allScored ? 'completed' : 'scheduled' },
  })

  return NextResponse.json({ ok: true, team1Lines, team2Lines, completed: allScored })
}
