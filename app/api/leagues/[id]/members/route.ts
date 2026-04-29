import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { id: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/members — organizer adds a player
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const userId: string = body.userId
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const { error } = await db
    .from('league_registrations')
    .upsert(
      { league_id: params.id, user_id: userId, status: 'registered', registered_at: new Date().toISOString() },
      { onConflict: 'league_id,user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sync into league_session_players for non-completed sessions
  const [{ data: profile }, { data: sessions }] = await Promise.all([
    db.from('profiles').select('name, joinzer_rating, dupr_rating, estimated_rating').eq('id', userId).single(),
    db.from('league_sessions').select('id').eq('league_id', params.id).neq('status', 'completed'),
  ])

  if (sessions && sessions.length > 0 && profile) {
    const rows = sessions.map((s) => ({
      session_id: s.id,
      user_id: userId,
      display_name: (profile as { name: string }).name,
      player_type: 'roster_player',
      expected_status: 'expected',
      actual_status: 'not_present',
      joinzer_rating: (profile as { joinzer_rating: number | null }).joinzer_rating ?? 1000,
    }))
    // Only insert if not already present
    await db.from('league_session_players').upsert(rows, { onConflict: 'session_id,user_id', ignoreDuplicates: true })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
