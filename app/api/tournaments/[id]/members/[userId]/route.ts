import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: Promise<{ id: string; userId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// DELETE /api/tournaments/[id]/members/[userId]?eventId=xxx — organizer removes a player from an event
export async function DELETE(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: tournament } = await db.from('tournaments').select('created_by').eq('id', params.id).single()
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tournament.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const eventId = new URL(req.url).searchParams.get('eventId')
  if (!eventId) return NextResponse.json({ error: 'eventId query param required' }, { status: 400 })

  const { error } = await db
    .from('tournament_registrations')
    .update({ status: 'cancelled' })
    .eq('tournament_event_id', eventId)
    .eq('user_id', params.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
