import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canOperate } from '@/lib/tournament/access'

// PATCH /api/tournaments/[id]/registrations/[regId]/checkin
// Body: { checked_in: boolean }
// Organizer/staff-driven check-in — the counterpart to the player-self POST /checkin route,
// used by offline run mode (where the organizer checks players in on their behalf). Idempotent:
// setting checked_in to its current value is a no-op, so an outbox replay is safe.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; regId: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await canOperate(params.id, user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const checkedIn = body.checked_in
  if (typeof checkedIn !== 'boolean') {
    return NextResponse.json({ error: 'checked_in (boolean) required' }, { status: 400 })
  }

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Scope the reg to this tournament so an organizer can't flip a reg in someone else's event.
  const { data: reg } = await db
    .from('tournament_registrations')
    .select('id, checked_in')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .maybeSingle()
  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  if (reg.checked_in === checkedIn) {
    return NextResponse.json({ ok: true, checked_in: checkedIn, already: true })
  }

  const { error } = await db
    .from('tournament_registrations')
    .update({ checked_in: checkedIn })
    .eq('id', params.regId)
  if (error) return NextResponse.json({ error: 'Failed to update check-in' }, { status: 500 })

  return NextResponse.json({ ok: true, checked_in: checkedIn, already: false })
}
