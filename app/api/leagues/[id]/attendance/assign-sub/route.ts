import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'

type Params = { params: Promise<{ id: string }> }
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/attendance/assign-sub
// Assign a substitute to cover an absent box member for a cycle. Finds-or-creates
// the covering attendee, links it to the covered member's registration, and marks
// the member 'has_sub'. Fixture scores still credit the covered registration, so
// standings / promotion-relegation stay correct. Organizer/co-admin only. Body:
//   { periodId, coveredRegistrationId, subUserId? | subAttendanceId? | subGuestName? }
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { periodId, coveredRegistrationId, subUserId, subAttendanceId, subGuestName } = body
  if (!periodId || !coveredRegistrationId) {
    return NextResponse.json({ error: 'Missing target' }, { status: 400 })
  }

  const db = admin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  // Covered member must be a registration in this league.
  const { data: coveredReg } = await db
    .from('league_registrations')
    .select('id, user_id, league_id')
    .eq('id', coveredRegistrationId)
    .single()
  if (!coveredReg || coveredReg.league_id !== params.id) {
    return NextResponse.json({ error: 'Bad member' }, { status: 400 })
  }

  // ── Resolve the covering attendance row (find or create) ──
  let subRowId: string | null = null

  if (subAttendanceId) {
    const { data: row } = await db
      .from('league_attendance')
      .select('id')
      .eq('id', subAttendanceId)
      .eq('league_id', params.id)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Sub not found' }, { status: 400 })
    subRowId = row.id
  } else if (subUserId) {
    const { data: reg } = await db
      .from('league_registrations')
      .select('id')
      .eq('league_id', params.id)
      .eq('user_id', subUserId)
      .neq('status', 'cancelled')
      .maybeSingle()
    if (!reg) return NextResponse.json({ error: 'Sub is not registered in this league' }, { status: 400 })
    const { data: existing } = await db
      .from('league_attendance')
      .select('id')
      .eq('period_id', periodId)
      .eq('registration_id', reg.id)
      .maybeSingle()
    subRowId = existing?.id ?? null
    if (!subRowId) {
      const { data: inserted, error } = await db
        .from('league_attendance')
        .insert({ league_id: params.id, period_id: periodId, registration_id: reg.id, user_id: subUserId, status: 'present' })
        .select('id')
        .single()
      if (error || !inserted) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
      subRowId = inserted.id
    }
  } else if (subGuestName) {
    const { data: inserted, error } = await db
      .from('league_attendance')
      .insert({ league_id: params.id, period_id: periodId, guest_name: String(subGuestName).trim(), status: 'present' })
      .select('id')
      .single()
    if (error || !inserted) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    subRowId = inserted.id
  } else {
    return NextResponse.json({ error: 'No sub specified' }, { status: 400 })
  }

  // Link the covering row to the covered member.
  const now = new Date().toISOString()
  const { data: sub, error: subErr } = await db
    .from('league_attendance')
    .update({ subbing_for_registration_id: coveredRegistrationId, status: 'present', updated_at: now })
    .eq('id', subRowId)
    .select()
    .single()
  if (subErr || !sub) return NextResponse.json({ error: subErr?.message ?? 'Update failed' }, { status: 500 })

  // Mark the covered member 'has_sub' (update-or-insert their row).
  const { data: existingCovered } = await db
    .from('league_attendance')
    .select('id')
    .eq('period_id', periodId)
    .eq('registration_id', coveredRegistrationId)
    .maybeSingle()
  let covered
  if (existingCovered) {
    const { data } = await db
      .from('league_attendance')
      .update({ status: 'has_sub', updated_at: now })
      .eq('id', existingCovered.id)
      .select()
      .single()
    covered = data
  } else {
    const { data } = await db
      .from('league_attendance')
      .insert({ league_id: params.id, period_id: periodId, registration_id: coveredRegistrationId, user_id: coveredReg.user_id, status: 'has_sub' })
      .select()
      .single()
    covered = data
  }

  return NextResponse.json({ sub, covered })
}
