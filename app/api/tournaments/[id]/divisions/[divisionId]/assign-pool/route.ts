import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// POST { registration_id: string, pool_number: number | null }
// Organizer-only. Sets the team's pool for pool-play match generation. For a
// doubles team the partner registration gets the same pool, so whichever row is
// the canonical team id carries it. pool_number null clears the assignment
// (the generator auto-balances unassigned teams).
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
  const { registration_id, pool_number }: { registration_id?: string; pool_number?: number | null } = body
  if (!registration_id) return NextResponse.json({ error: 'registration_id is required' }, { status: 400 })
  if (pool_number != null && (!Number.isInteger(pool_number) || pool_number < 1)) {
    return NextResponse.json({ error: 'pool_number must be a positive integer or null' }, { status: 400 })
  }

  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, partner_registration_id')
    .eq('id', registration_id)
    .eq('division_id', params.divisionId)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  const ids = reg.partner_registration_id ? [reg.id, reg.partner_registration_id] : [reg.id]
  const { error } = await service
    .from('tournament_registrations')
    .update({ pool_number: pool_number ?? null })
    .in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
