import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { generateNextRound, type CompletedRound, type CompletedMatch, type SessionPlayer } from '@/lib/scheduling/leagueScheduler'

type Params = { params: Promise<{ sessionId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { session: authSession } } = await supabase.auth.getSession()
  const user = authSession?.user ?? null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const replaceExistingDraft = body.replace_existing_draft === true

  const db = admin()

  // --- Verify manager access ---
  const { data: session } = await db
    .from('league_sessions')
    .select('id, league_id, number_of_courts, rounds_planned')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: league } = await db.from('leagues').select('created_by').eq('id', session.league_id).single()
  if (!league || league.created_by !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const courts = session.number_of_courts ?? 4

  // --- Fetch present players ---
  const { data: rawPlayers } = await db
    .from('league_session_players')
    .select('*')
    .eq('session_id', params.sessionId)

  const players: SessionPlayer[] = (rawPlayers ?? [])
    // Unassigned subs sit out — only assigned subs (covering an absent player) play
    .filter((p: Record<string, unknown>) =>
      p.player_type !== 'sub' || p.sub_for_session_player_id !== null
    )
    .map((p: Record<string, unknown>) => ({
      id:                p.id as string,
      userId:            p.user_id as string | null,
      name:              p.display_name as string,
      playerType:        (p.player_type as SessionPlayer['playerType']) ?? 'roster_player',
      actualStatus:      (p.actual_status as SessionPlayer['actualStatus']) ?? 'not_present',
      arrivedAfterRound: p.arrived_after_round as number | null,
      joinzerRating:     (p.joinzer_rating as number) ?? 1000,
    }))

  const presentCount = players.filter(p => p.actualStatus === 'present').length
  if (presentCount < 2) {
    return NextResponse.json({ error: 'No players are currently marked present. Check in players before generating a round.' }, { status: 400 })
  }

  // --- Fetch completed rounds for history ---
  const { data: completedRoundRows } = await db
    .from('league_rounds')
    .select('id, round_number, status')
    .eq('session_id', params.sessionId)
    .eq('status', 'completed')
    .order('round_number')

  const completedRounds: CompletedRound[] = []
  for (const r of completedRoundRows ?? []) {
    const { data: matchRows } = await db
      .from('league_round_matches')
      .select('*')
      .eq('round_id', r.id)

    const matches: CompletedMatch[] = (matchRows ?? []).map((m: Record<string, unknown>) => ({
      matchType:   m.match_type as CompletedMatch['matchType'],
      team1:       [m.team1_player1_id, m.team1_player2_id].filter(Boolean) as string[],
      team2:       [m.team2_player1_id, m.team2_player2_id].filter(Boolean) as string[],
      singles:     [m.singles_player1_id, m.singles_player2_id].filter(Boolean) as string[],
      byePlayerId: (m.bye_player_id as string) ?? null,
    }))
    completedRounds.push({ roundNumber: r.round_number as number, matches })
  }

  // --- Determine next round number ---
  const { data: allRounds } = await db
    .from('league_rounds')
    .select('id, round_number, status')
    .eq('session_id', params.sessionId)
    .order('round_number')

  const nextRoundNumber = ((allRounds ?? []).length === 0)
    ? 1
    : Math.max(...(allRounds ?? []).map((r: Record<string, unknown>) => r.round_number as number)) + 1

  // --- Check for existing draft ---
  const existingDraft = (allRounds ?? []).find((r: Record<string, unknown>) => r.status === 'draft')
  if (existingDraft && !replaceExistingDraft) {
    return NextResponse.json(
      { error: `Round ${existingDraft.round_number} already has a draft schedule. Send replace_existing_draft: true to replace it.`, existing_round_id: existingDraft.id },
      { status: 409 }
    )
  }

  // --- Delete existing draft if replacing ---
  if (existingDraft && replaceExistingDraft) {
    await db.from('league_rounds').delete().eq('id', existingDraft.id)
  }

  // --- Generate schedule ---
  const result = generateNextRound(players, completedRounds, courts, nextRoundNumber)
  if (!result) {
    return NextResponse.json({ error: 'Could not generate a valid schedule. Check player count.' }, { status: 422 })
  }

  // --- Persist round ---
  const { data: newRound, error: roundErr } = await db
    .from('league_rounds')
    .insert({
      session_id:       params.sessionId,
      round_number:     existingDraft && replaceExistingDraft ? existingDraft.round_number : nextRoundNumber,
      status:           'draft',
      generation_notes: result.notes.join('\n'),
    })
    .select()
    .single()

  if (roundErr || !newRound) return NextResponse.json({ error: roundErr?.message ?? 'Failed to create round' }, { status: 500 })

  // --- Persist matches ---
  const matchRows = result.matches.map(m => ({
    round_id:          newRound.id,
    session_id:        params.sessionId,
    court_number:      m.courtNumber,
    match_type:        m.matchType,
    team1_player1_id:  m.team1Player1Id,
    team1_player2_id:  m.team1Player2Id,
    team2_player1_id:  m.team2Player1Id,
    team2_player2_id:  m.team2Player2Id,
    singles_player1_id: m.singlesPlayer1Id,
    singles_player2_id: m.singlesPlayer2Id,
    bye_player_id:     m.byePlayerId,
  }))

  const { error: matchErr } = await db.from('league_round_matches').insert(matchRows)
  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 })

  // Return full round with matches
  const { data: fullRound } = await db
    .from('league_rounds')
    .select('*, matches:league_round_matches(*)')
    .eq('id', newRound.id)
    .single()

  return NextResponse.json({ round: fullRound, notes: result.notes, format: result.format }, { status: 201 })
}
