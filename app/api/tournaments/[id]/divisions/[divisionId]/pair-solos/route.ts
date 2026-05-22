import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

type Params = { params: Promise<{ id: string; divisionId: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { reg1_id, reg2_id } = body
  if (!reg1_id || !reg2_id || typeof reg1_id !== 'string' || typeof reg2_id !== 'string') {
    return NextResponse.json({ error: 'reg1_id and reg2_id are required' }, { status: 400 })
  }
  if (reg1_id === reg2_id) {
    return NextResponse.json({ error: 'Cannot pair a registration with itself' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Auth: organizer_id lives on tournaments, not on registrations (Fix 2)
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  if (tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Atomic cross-link via RPC — transaction guarantees both rows update or neither does.
  // Guards (solo, registered, unpartnered, same division) are enforced inside the function.
  const { data, error } = await service.rpc('pair_solo_registrations', {
    p_reg1_id: reg1_id,
    p_reg2_id: reg2_id,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('reg1_not_found') || msg.includes('reg2_not_found')) {
      return NextResponse.json({ error: 'One or both registrations not found' }, { status: 404 })
    }
    if (msg.includes('invalid_reg1') || msg.includes('invalid_reg2')) {
      return NextResponse.json({ error: 'One or both registrations are not eligible to be paired (must be solo, registered, and unpartnered)' }, { status: 409 })
    }
    if (msg.includes('different_divisions')) {
      return NextResponse.json({ error: 'Registrations must be in the same division' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...(data as object) })
}
