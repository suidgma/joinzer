import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { promoteFromWaitlist } from '@/lib/tournament/waitlist'
import { canManageTournament } from '@/lib/tournament/access'

type Params = { params: Promise<{ id: string; regId: string }> }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('id, organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, division_id, status, partner_registration_id')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .single()
  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  // Player may withdraw themselves; organizer or co-organizer may withdraw anyone.
  const isOwner = reg.user_id === user.id
  const isStaff = isOwner ? true : await canManageTournament(service, params.id, user.id)
  if (!isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (reg.status === 'cancelled') {
    return NextResponse.json({ error: 'Registration already cancelled' }, { status: 409 })
  }

  const { error: cancelErr } = await service
    .from('tournament_registrations')
    .update({ status: 'cancelled' })
    .eq('id', reg.id)
  if (cancelErr) {
    return NextResponse.json({ error: cancelErr.message }, { status: 500 })
  }

  // If this reg was solo-matched to a partner, unlink them so the partner can be re-matched
  if (reg.partner_registration_id) {
    await service
      .from('tournament_registrations')
      .update({ partner_user_id: null, partner_registration_id: null })
      .eq('id', reg.partner_registration_id)
  }

  // Only promote when a registered slot opens up — cancelling a waitlisted reg doesn't free a slot
  const promoted = reg.status === 'registered'
    ? await promoteFromWaitlist(service, reg.division_id)
    : null

  return NextResponse.json({ ok: true, promoted })
}
