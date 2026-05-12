import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

// POST /api/tournaments/[id]/checkin
// Body: { division_id: string }
// Marks the calling player as checked in for their registration in that division.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { division_id } = await req.json()
  if (!division_id) return NextResponse.json({ error: 'division_id required' }, { status: 400 })

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Find an active registration for this user in this division
  const { data: reg } = await db
    .from('tournament_registrations')
    .select('id, status, checked_in')
    .eq('tournament_id', params.id)
    .eq('division_id', division_id)
    .eq('user_id', user.id)
    .eq('status', 'registered')
    .maybeSingle()

  if (!reg) {
    return NextResponse.json({ error: 'No active registration found for this division' }, { status: 404 })
  }

  if (reg.checked_in) {
    return NextResponse.json({ ok: true, already: true })
  }

  const { error } = await db
    .from('tournament_registrations')
    .update({ checked_in: true })
    .eq('id', reg.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, already: false })
}
