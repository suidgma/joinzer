import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { assignRrSub } from '@/lib/leagues/assignRrSub'

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

  // Place the sub via the shared core (find-or-create the sub row, link to the
  // absent player). Organizer flow leaves 'has_sub' marking to the attendance grid.
  const result = await assignRrSub(db, {
    sessionId: params.sessionId,
    absentPlayerId,
    subUserId,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ subPlayer: result.subPlayer })
}
