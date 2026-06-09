import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// POST { reg1_id: string, reg2_id: string | null }
// Organizer-only. Links (or unlinks) two registrations as a fixed doubles pair.
// Sets partner_user_id + partner_registration_id bidirectionally and clears
// any displaced previous partners.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { reg1_id, reg2_id }: { reg1_id: string; reg2_id: string | null } = body
  if (!reg1_id) return NextResponse.json({ error: 'reg1_id is required' }, { status: 400 })

  // Fetch reg1 — must belong to this division
  const { data: reg1 } = await service
    .from('tournament_registrations')
    .select('id, user_id, partner_registration_id')
    .eq('id', reg1_id)
    .eq('division_id', params.divisionId)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (!reg1) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  // Fetch reg2 if provided
  let reg2: { id: string; user_id: string; partner_registration_id: string | null } | null = null
  if (reg2_id) {
    const { data } = await service
      .from('tournament_registrations')
      .select('id, user_id, partner_registration_id')
      .eq('id', reg2_id)
      .eq('division_id', params.divisionId)
      .neq('status', 'cancelled')
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Partner registration not found' }, { status: 404 })
    if (data.id === reg1.id) return NextResponse.json({ error: 'Cannot pair a player with themselves' }, { status: 400 })
    reg2 = data
  }

  // Clear displaced partners first — anyone who was previously paired with
  // reg1 or reg2 (but won't be in the new pair) needs their links nulled.
  const toClear = new Set<string>()
  if (reg1.partner_registration_id && reg1.partner_registration_id !== reg2_id) {
    toClear.add(reg1.partner_registration_id)
  }
  if (reg2?.partner_registration_id && reg2.partner_registration_id !== reg1_id) {
    toClear.add(reg2.partner_registration_id)
  }
  if (toClear.size > 0) {
    await service
      .from('tournament_registrations')
      .update({ partner_user_id: null, partner_registration_id: null })
      .in('id', Array.from(toClear))
  }

  if (reg2) {
    await service
      .from('tournament_registrations')
      .update({ partner_user_id: reg2.user_id, partner_registration_id: reg2.id })
      .eq('id', reg1.id)
    await service
      .from('tournament_registrations')
      .update({ partner_user_id: reg1.user_id, partner_registration_id: reg1.id })
      .eq('id', reg2.id)
  } else {
    await service
      .from('tournament_registrations')
      .update({ partner_user_id: null, partner_registration_id: null })
      .eq('id', reg1.id)
  }

  return NextResponse.json({ ok: true })
}
