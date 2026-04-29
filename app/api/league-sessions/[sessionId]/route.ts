import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { sessionId: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH /api/league-sessions/[sessionId] — update date or notes (league organizer only)
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { session: authSession } } = await supabase.auth.getSession()
  const user = authSession?.user ?? null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()

  // Verify caller is the league organizer via join
  const { data: session } = await db
    .from('league_sessions')
    .select('id, league_id, leagues(created_by)')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const league = session.leagues as unknown as { created_by: string } | null
  if (!league || league.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (body.session_date !== undefined) updates.session_date = body.session_date
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.status !== undefined) updates.status = body.status

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: updated, error } = await db
    .from('league_sessions')
    .update(updates)
    .eq('id', params.sessionId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(updated)
}
