import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// POST /api/tournaments/[id]/registrations/[regId]/replace-player
// Body: { new_user_id: string }
// Swaps the user_id on a registration so the bracket slot, seed, and payment
// status all carry over. Use when a player can't attend and a substitute steps in.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; regId: string }> }
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
  const { new_user_id } = body
  if (!new_user_id) return NextResponse.json({ error: 'new_user_id required' }, { status: 400 })

  // Verify registration belongs to this tournament
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, division_id, user_id')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .single()
  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  if (reg.user_id === new_user_id) {
    return NextResponse.json({ error: 'Player is already in this slot' }, { status: 400 })
  }

  // Block if new player already has an active registration in the same division
  const { data: existing } = await service
    .from('tournament_registrations')
    .select('id')
    .eq('division_id', reg.division_id)
    .eq('user_id', new_user_id)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'This player is already registered in this division' }, { status: 409 })
  }

  const { error: updateError } = await service
    .from('tournament_registrations')
    .update({ user_id: new_user_id })
    .eq('id', params.regId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { data: profile } = await service
    .from('profiles')
    .select('id, name, is_stub, dupr_rating, estimated_rating')
    .eq('id', new_user_id)
    .single()

  return NextResponse.json({ ok: true, profile })
}
