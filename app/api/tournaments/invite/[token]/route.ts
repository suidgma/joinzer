import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// GET — return invitation details (for the acceptance page to display)
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('tournament_team_invitations')
    .select(`
      id, status, invitee_email,
      tournament:tournaments!tournament_id(id, name, start_date),
      division:tournament_divisions!division_id(id, name, category),
      inviter_reg:tournament_registrations!inviter_registration_id(
        user_id, team_name
      )
    `)
    .eq('token', params.token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  // Fetch inviter name separately (flat query avoids PostgREST FK hint issues)
  const inviterReg = inv.inviter_reg as any
  const { data: inviterProfile } = await service
    .from('profiles')
    .select('name')
    .eq('id', inviterReg?.user_id)
    .maybeSingle()

  return NextResponse.json({
    invitation: {
      id: inv.id,
      status: inv.status,
      invitee_email: inv.invitee_email,
      tournament: inv.tournament,
      division: inv.division,
      inviter_name: inviterProfile?.name ?? 'Unknown',
      team_name: inviterReg?.team_name ?? null,
    }
  })
}

// POST — accept or decline
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json().catch(() => ({}))
  if (!['accept', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('tournament_team_invitations')
    .select('id, status, tournament_id, division_id, inviter_registration_id, invitee_email')
    .eq('token', params.token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (inv.status !== 'pending') return NextResponse.json({ error: `Invitation already ${inv.status}` }, { status: 409 })

  if (action === 'decline') {
    await service
      .from('tournament_team_invitations')
      .update({ status: 'declined', invitee_user_id: user.id })
      .eq('id', inv.id)
    return NextResponse.json({ ok: true, action: 'declined' })
  }

  // Accept — create registration for invitee
  // Check invitee not already registered
  const { data: existing } = await service
    .from('tournament_registrations')
    .select('id')
    .eq('division_id', inv.division_id)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You are already registered for this division' }, { status: 409 })
  }

  // Count slots
  const { count } = await service
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', inv.division_id)
    .eq('status', 'registered')

  const { data: division } = await service
    .from('tournament_divisions')
    .select('max_entries, waitlist_enabled, status')
    .eq('id', inv.division_id)
    .single()

  if (!division || division.status === 'closed') {
    return NextResponse.json({ error: 'Division is closed' }, { status: 400 })
  }

  const isFull = (count ?? 0) >= division.max_entries
  if (isFull && !division.waitlist_enabled) {
    return NextResponse.json({ error: 'Division is full' }, { status: 400 })
  }

  const regStatus = isFull ? 'waitlisted' : 'registered'

  // Create invitee's registration
  const { data: newReg, error: regErr } = await service
    .from('tournament_registrations')
    .insert({
      tournament_id: inv.tournament_id,
      division_id: inv.division_id,
      user_id: user.id,
      partner_user_id: null, // will be set below
      status: regStatus,
    })
    .select('id')
    .single()

  if (regErr || !newReg) {
    return NextResponse.json({ error: regErr?.message ?? 'Registration failed' }, { status: 500 })
  }

  // Link partner_user_id on both registrations
  await Promise.all([
    service.from('tournament_registrations')
      .update({ partner_user_id: user.id })
      .eq('id', inv.inviter_registration_id),
    service.from('tournament_registrations')
      .update({ partner_user_id: (await service.from('tournament_registrations').select('user_id').eq('id', inv.inviter_registration_id).single()).data?.user_id })
      .eq('id', newReg.id),
  ])

  // Mark invitation accepted
  await service
    .from('tournament_team_invitations')
    .update({ status: 'accepted', invitee_user_id: user.id })
    .eq('id', inv.id)

  return NextResponse.json({
    ok: true,
    action: 'accepted',
    tournament_id: inv.tournament_id,
    registration_id: newReg.id,
  })
}
