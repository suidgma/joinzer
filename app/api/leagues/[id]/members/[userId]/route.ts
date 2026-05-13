import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: Promise<{ id: string; userId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH /api/leagues/[id]/members/[userId] — primary organizer toggles co-admin status
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Prevent removing own organizer status
  if (params.userId === user.id) return NextResponse.json({ error: 'Cannot change your own admin status' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const { is_co_admin } = body
  if (typeof is_co_admin !== 'boolean') return NextResponse.json({ error: 'is_co_admin must be boolean' }, { status: 400 })

  const { error } = await db
    .from('league_registrations')
    .update({ is_co_admin })
    .eq('league_id', params.id)
    .eq('user_id', params.userId)
    .eq('status', 'registered')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, is_co_admin })
}

// DELETE /api/leagues/[id]/members/[userId] — organizer removes a player
export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await db
    .from('league_registrations')
    .update({ status: 'cancelled' })
    .eq('league_id', params.id)
    .eq('user_id', params.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Remove from non-completed sessions (roster_player only — preserve sub/guest entries)
  const { data: sessions } = await db
    .from('league_sessions')
    .select('id')
    .eq('league_id', params.id)
    .neq('status', 'completed')

  if (sessions && sessions.length > 0) {
    await db
      .from('league_session_players')
      .delete()
      .in('session_id', sessions.map((s) => s.id))
      .eq('user_id', params.userId)
      .eq('player_type', 'roster_player')
  }

  return NextResponse.json({ ok: true })
}
