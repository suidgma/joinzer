import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; divisionId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const team_name: string | null = body.team_name ?? null

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Allow organizer to register a specific player; otherwise register self
  let targetUserId = user.id
  if (body.user_id && body.user_id !== user.id) {
    // Verify caller is the tournament organizer
    const { data: tournament } = await service
      .from('tournaments')
      .select('organizer_id')
      .eq('id', params.id)
      .single()
    if (!tournament || tournament.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the organizer can add players' }, { status: 403 })
    }
    targetUserId = body.user_id
  }

  // Fetch division
  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, tournament_id, max_entries, waitlist_enabled, status')
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()

  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
  if (division.status === 'closed') return NextResponse.json({ error: 'Division is closed' }, { status: 400 })

  // Block duplicate active registration
  const { data: existing } = await service
    .from('tournament_registrations')
    .select('id')
    .eq('division_id', params.divisionId)
    .eq('user_id', targetUserId)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existing) return NextResponse.json({ error: 'Player is already registered for this division' }, { status: 409 })

  // Count current registered entries (not waitlisted)
  const { count } = await service
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')

  const registered = count ?? 0
  const isFull = registered >= division.max_entries

  if (isFull && !division.waitlist_enabled) {
    return NextResponse.json({ error: 'Division is full and has no waitlist' }, { status: 400 })
  }

  const status = isFull ? 'waitlisted' : 'registered'

  const { data: registration, error: insertErr } = await service
    .from('tournament_registrations')
    .insert({
      tournament_id: params.id,
      division_id: params.divisionId,
      user_id: targetUserId,
      team_name: team_name || null,
      status,
    })
    .select('id, user_id, partner_user_id, team_name, status')
    .single()

  if (insertErr || !registration) {
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ registration })
}
