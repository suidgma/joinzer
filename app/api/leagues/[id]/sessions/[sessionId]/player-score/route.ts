import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { validateScores } from '@/lib/scoring/validateScores'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; sessionId: string }> }
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// POST /api/leagues/[id]/sessions/[sessionId]/player-score
// A registered participant scores their own round-robin match when the league allows it.
// Body: { roundMatchId, team_1_score, team_2_score } — team_1/team_2 align with the round
// match's team1/team2 slots. Writes to league_matches (delete-then-insert, like the
// organizer flow). Credited user ids follow subs to the covered player.
export async function POST(req: NextRequest, props: Params) {
  const { id, sessionId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const roundMatchId: string | undefined = body.roundMatchId
  const t1 = body.team_1_score
  const t2 = body.team_2_score
  if (!roundMatchId) return NextResponse.json({ error: 'roundMatchId required' }, { status: 400 })
  const check = validateScores(t1, t2)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by, allow_player_scores').eq('id', id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!league.allow_player_scores) return NextResponse.json({ error: 'Player scoring is off for this league' }, { status: 403 })

  const { data: session } = await db.from('league_sessions').select('id').eq('id', sessionId).eq('league_id', id).maybeSingle()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: rm } = await db
    .from('league_round_matches')
    .select('id, court_number, match_type, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, singles_player1_id, singles_player2_id, round:league_rounds!round_id(round_number)')
    .eq('id', roundMatchId).eq('session_id', sessionId).maybeSingle()
  if (!rm) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  const roundNumber = (rm as any).round?.round_number
  if (roundNumber == null) return NextResponse.json({ error: 'Round not found' }, { status: 400 })

  const isSingles = (rm as any).match_type === 'singles'
  const team1Slots: (string | null)[] = isSingles ? [(rm as any).singles_player1_id] : [(rm as any).team1_player1_id, (rm as any).team1_player2_id]
  const team2Slots: (string | null)[] = isSingles ? [(rm as any).singles_player2_id] : [(rm as any).team2_player1_id, (rm as any).team2_player2_id]

  // Resolve session_player ids → user ids. raw = the actual person on the court (incl. a
  // sub); credit = who the result counts for (a sub credits the covered player).
  const { data: sps } = await db.from('league_session_players').select('id, user_id, sub_for_session_player_id').eq('session_id', sessionId)
  const spRows = (sps ?? []) as { id: string; user_id: string | null; sub_for_session_player_id: string | null }[]
  const raw = new Map(spRows.map((s) => [s.id, s.user_id]))
  const credit = new Map<string, string>()
  for (const s of spRows) if (s.user_id && !s.sub_for_session_player_id) credit.set(s.id, s.user_id)
  for (const s of spRows) if (s.sub_for_session_player_id) { const abs = credit.get(s.sub_for_session_player_id); if (abs) credit.set(s.id, abs) }

  // Participation: the actual people at this match (raw). Organizer/co-admin may also submit.
  const participants = new Set<string>()
  for (const slot of [...team1Slots, ...team2Slots]) { const u = slot ? raw.get(slot) : null; if (u) participants.add(u) }
  let allowed = league.created_by === user.id || participants.has(user.id)
  if (!allowed) {
    const { data: myReg } = await db.from('league_registrations').select('is_co_admin').eq('league_id', id).eq('user_id', user.id).maybeSingle()
    allowed = myReg?.is_co_admin === true
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const resolve = (slots: (string | null)[], i: number) => { const s = slots[i]; return s ? credit.get(s) ?? raw.get(s) ?? null : null }

  // Replace any existing row for this slot (session + round + court), then insert.
  let del = db.from('league_matches').delete().eq('session_id', sessionId).eq('round_number', roundNumber)
  del = (rm as any).court_number !== null ? del.eq('court_number', (rm as any).court_number) : del.is('court_number', null)
  await del

  const { error } = await db.from('league_matches').insert({
    session_id: sessionId,
    round_number: roundNumber,
    court_number: (rm as any).court_number,
    team1_player1_id: resolve(team1Slots, 0),
    team1_player2_id: resolve(team1Slots, 1),
    team2_player1_id: resolve(team2Slots, 0),
    team2_player2_id: resolve(team2Slots, 1),
    team1_score: t1,
    team2_score: t2,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    actorId: user.id, entityType: 'league_match', entityId: roundMatchId, action: 'score_updated',
    after: { team1_score: t1, team2_score: t2, round_number: roundNumber, court_number: (rm as any).court_number },
  })
  return NextResponse.json({ ok: true })
}
