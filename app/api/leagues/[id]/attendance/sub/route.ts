import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'

type Params = { params: Promise<{ id: string }> }
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/attendance/sub
// Add a substitute or guest to a cycle's attendance (unassigned — covering nobody
// yet). A registered player carries their registration_id; a guest carries a name.
// Organizer/co-admin only. Body: { periodId, userId? , guestName?, displayName? }
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { periodId, userId, guestName } = body
  if (!periodId || (!userId && !guestName)) {
    return NextResponse.json({ error: 'Missing target' }, { status: 400 })
  }

  const db = admin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  if (userId) {
    // A registered player subbing in — link their registration when they have one.
    // A sub can be any profile (like round-robin) — link a registration when they
    // happen to have one, else store the bare user_id.
    const { data: reg } = await db
      .from('league_registrations')
      .select('id')
      .eq('league_id', params.id)
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .maybeSingle()

    // Don't double-add: match by registration when they have one, else by user.
    const { data: existing } = reg
      ? await db.from('league_attendance').select('*').eq('period_id', periodId).eq('registration_id', reg.id).maybeSingle()
      : await db.from('league_attendance').select('*').eq('period_id', periodId).eq('user_id', userId).limit(1).maybeSingle()
    if (existing) return NextResponse.json({ attendance: existing })

    const { data, error } = await db
      .from('league_attendance')
      .insert({ league_id: params.id, period_id: periodId, registration_id: reg?.id ?? null, user_id: userId, status: 'present' })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ attendance: data })
  }

  // Guest (no profile)
  const { data, error } = await db
    .from('league_attendance')
    .insert({ league_id: params.id, period_id: periodId, guest_name: String(guestName).trim(), status: 'present' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ attendance: data })
}
