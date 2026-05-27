import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

type Body = { email?: string; role?: 'co_organizer' | 'volunteer' }

// GET /api/tournaments/[id]/staff — list staff for the manage UI
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  if (tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: staff } = await service
    .from('tournament_staff')
    .select('id, user_id, role, created_at, profiles:user_id (id, name, email)')
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ staff: staff ?? [] })
}

// POST /api/tournaments/[id]/staff — invite a user by email
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const email = body.email?.trim().toLowerCase()
  const role = body.role === 'volunteer' ? 'volunteer' : 'co_organizer'

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Only the primary organizer can add staff.
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  if (tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Only the organizer can add staff' }, { status: 403 })
  }

  // Resolve email → user_id via profiles
  const { data: profile } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (!profile) {
    return NextResponse.json(
      { error: 'No Joinzer account found with that email. Ask them to sign up first.' },
      { status: 404 }
    )
  }
  if (profile.id === tournament.organizer_id) {
    return NextResponse.json({ error: 'The organizer is already in charge.' }, { status: 400 })
  }

  const { error } = await service
    .from('tournament_staff')
    .insert({ tournament_id: params.id, user_id: profile.id, role })

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That user is already on staff' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
