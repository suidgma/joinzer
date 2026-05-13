import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST — assign a sub to cover for an absent roster player.
// Body: { subUserId: string, absentPlayerId: string }
//   subUserId      — profiles.id of the player who will sub
//   absentPlayerId — league_session_players.id of the absent roster player
export async function POST(req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { subUserId, absentPlayerId } = body as { subUserId?: string; absentPlayerId?: string }
  if (!subUserId || !absentPlayerId) {
    return NextResponse.json({ error: 'subUserId and absentPlayerId are required' }, { status: 400 })
  }

  const db = admin()

  // Verify caller is the league organizer
  const { data: session } = await db
    .from('league_sessions')
    .select('league_id')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: league } = await db
    .from('leagues')
    .select('created_by')
    .eq('id', session.league_id)
    .single()
  if (!league || league.created_by !== user.id) {
    return NextResponse.json({ error: 'Only the organizer can assign subs' }, { status: 403 })
  }

  // Verify the absent player belongs to this session
  const { data: absentPlayer } = await db
    .from('league_session_players')
    .select('id, display_name')
    .eq('id', absentPlayerId)
    .eq('session_id', params.sessionId)
    .single()
  if (!absentPlayer) return NextResponse.json({ error: 'Absent player not found in this session' }, { status: 404 })

  // Fetch sub's profile
  const { data: subProfile } = await db
    .from('profiles')
    .select('id, name, joinzer_rating')
    .eq('id', subUserId)
    .single()
  if (!subProfile) return NextResponse.json({ error: 'Sub player profile not found' }, { status: 404 })

  // Find or create the sub's league_session_players row
  const { data: existingRow } = await db
    .from('league_session_players')
    .select('id')
    .eq('session_id', params.sessionId)
    .eq('user_id', subUserId)
    .maybeSingle()

  let subPlayer: Record<string, unknown>

  if (existingRow) {
    const { data, error } = await db
      .from('league_session_players')
      .update({
        player_type: 'sub',
        actual_status: 'present',
        sub_for_session_player_id: absentPlayerId,
      })
      .eq('id', existingRow.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    subPlayer = data
  } else {
    const { data, error } = await db
      .from('league_session_players')
      .insert({
        session_id: params.sessionId,
        user_id: subUserId,
        display_name: subProfile.name,
        player_type: 'sub',
        expected_status: 'expected',
        actual_status: 'present',
        joinzer_rating: subProfile.joinzer_rating ?? 1000,
        sub_for_session_player_id: absentPlayerId,
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    subPlayer = data
  }

  return NextResponse.json({ subPlayer })
}
