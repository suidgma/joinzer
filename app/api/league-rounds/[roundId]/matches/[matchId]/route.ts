import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { roundId: string; matchId: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH /api/league-rounds/[roundId]/matches/[matchId]
// Manual edit — only allowed on draft rounds.
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()

  const { data: round } = await db
    .from('league_rounds')
    .select('status, session_id')
    .eq('id', params.roundId)
    .single()

  if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 })
  if (round.status === 'completed') return NextResponse.json({ error: 'Cannot edit a completed round.' }, { status: 400 })
  if (round.status === 'locked')    return NextResponse.json({ error: 'Unlock the round before editing.' }, { status: 400 })

  const body = await req.json()

  // Only allow updating player assignment fields and court_number
  const editableFields = [
    'court_number', 'match_type',
    'team1_player1_id', 'team1_player2_id',
    'team2_player1_id', 'team2_player2_id',
    'singles_player1_id', 'singles_player2_id',
    'bye_player_id',
  ]
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of editableFields) {
    if (body[f] !== undefined) update[f] = body[f] ?? null
  }

  // Hard block: detect if any player would appear twice in this round
  if (body.playerIds) {
    const { data: otherMatches } = await db
      .from('league_round_matches')
      .select('*')
      .eq('round_id', params.roundId)
      .neq('id', params.matchId)

    const scheduled = new Set<string>()
    for (const m of otherMatches ?? []) {
      for (const f of editableFields.slice(2)) {
        if (m[f]) scheduled.add(m[f] as string)
      }
    }

    const incoming: string[] = (body.playerIds as string[]).filter(Boolean)
    for (const id of incoming) {
      if (scheduled.has(id)) {
        return NextResponse.json({ error: 'This player is already scheduled in another match this round.' }, { status: 400 })
      }
    }
  }

  const { data, error } = await db
    .from('league_round_matches')
    .update(update)
    .eq('id', params.matchId)
    .eq('round_id', params.roundId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
