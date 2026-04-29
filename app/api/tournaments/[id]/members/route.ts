import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { id: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/tournaments/[id]/members — organizer adds a player to an event
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: tournament } = await db.from('tournaments').select('created_by').eq('id', params.id).single()
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tournament.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const userId: string = body.userId
  const eventId: string = body.eventId
  if (!userId || !eventId) return NextResponse.json({ error: 'userId and eventId required' }, { status: 400 })

  const { error } = await db
    .from('tournament_registrations')
    .upsert(
      { tournament_event_id: eventId, user_id: userId, status: 'registered', registered_at: new Date().toISOString() },
      { onConflict: 'tournament_event_id,user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 201 })
}
