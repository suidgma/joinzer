import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentEventId } = await request.json()
  if (!tournamentEventId) return NextResponse.json({ error: 'Missing tournamentEventId' }, { status: 400 })

  // Cancel the requesting user's registration
  const { error: cancelErr } = await supabase
    .from('tournament_registrations')
    .update({ status: 'cancelled' })
    .eq('tournament_event_id', tournamentEventId)
    .eq('user_id', user.id)

  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 })

  // Promote the oldest waitlisted player using service role (bypasses RLS)
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: nextUp } = await admin
    .from('tournament_registrations')
    .select('id')
    .eq('tournament_event_id', tournamentEventId)
    .eq('status', 'waitlist')
    .order('registered_at', { ascending: true })
    .limit(1)
    .single()

  if (nextUp) {
    await admin
      .from('tournament_registrations')
      .update({ status: 'registered' })
      .eq('id', nextUp.id)
  }

  return NextResponse.json({ ok: true, promoted: !!nextUp })
}
