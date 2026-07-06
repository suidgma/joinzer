import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'

type Params = { params: Promise<{ id: string }> }
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/attendance/assign-sub
// Assign substitute(s) to cover an absent box member for a cycle. Finds-or-creates
// each covering attendee, links it to the covered member's registration, and marks
// the member 'has_sub'. Fixture scores still credit the covered registration, so
// standings / promotion-relegation stay correct. Organizer/co-admin only.
//
// A doubles team is one entrant, so a whole-team sub sends TWO choices in `subs`;
// both link to the same covered registration and render as "SubA/SubB". Body:
//   { periodId, coveredRegistrationId, subUserId? | subAttendanceId? | subGuestName? }   (single)
//   { periodId, coveredRegistrationId, subs: [{ subUserId? | subAttendanceId? | subGuestName? }, ...] }  (pair)
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { periodId, coveredRegistrationId } = body
  if (!periodId || !coveredRegistrationId) {
    return NextResponse.json({ error: 'Missing target' }, { status: 400 })
  }
  // Normalize to a list of sub choices (single fields → one-element list).
  const choices: Array<{ subUserId?: string; subAttendanceId?: string; subGuestName?: string }> =
    Array.isArray(body.subs) && body.subs.length > 0
      ? body.subs
      : [{ subUserId: body.subUserId, subAttendanceId: body.subAttendanceId, subGuestName: body.subGuestName }]

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

  const now = new Date().toISOString()
  const isPair = Array.isArray(body.subs)

  // For a pair (re)assignment, clear any existing covers for this member first so
  // re-picking replaces rather than accumulates. Single assignment leaves other
  // covers alone (there's only ever one).
  if (isPair) {
    await db.from('league_attendance')
      .update({ subbing_for_registration_id: null, updated_at: now })
      .eq('league_id', params.id).eq('period_id', periodId)
      .eq('subbing_for_registration_id', coveredRegistrationId)
  }

  // Resolve one sub choice to an attendance row id (find or create).
  async function resolveSubRowId(choice: { subUserId?: string; subAttendanceId?: string; subGuestName?: string }): Promise<{ id: string } | { error: string }> {
    const { subUserId, subAttendanceId, subGuestName } = choice
    if (subAttendanceId) {
      const { data: row } = await db
        .from('league_attendance').select('id')
        .eq('id', subAttendanceId).eq('league_id', params.id).maybeSingle()
      if (!row) return { error: 'Sub not found' }
      return { id: row.id }
    }
    if (subUserId) {
      // A sub can be any profile (like round-robin) — link a registration if they
      // have one, else store the bare user_id.
      const { data: reg } = await db
        .from('league_registrations').select('id')
        .eq('league_id', params.id).eq('user_id', subUserId).neq('status', 'cancelled').maybeSingle()
      const { data: existing } = reg
        ? await db.from('league_attendance').select('id').eq('period_id', periodId).eq('registration_id', reg.id).maybeSingle()
        : await db.from('league_attendance').select('id').eq('period_id', periodId).eq('user_id', subUserId).limit(1).maybeSingle()
      if (existing?.id) return { id: existing.id }
      const { data: inserted, error } = await db
        .from('league_attendance')
        .insert({ league_id: params.id, period_id: periodId, registration_id: reg?.id ?? null, user_id: subUserId, status: 'present' })
        .select('id').single()
      if (error || !inserted) return { error: error?.message ?? 'Insert failed' }
      return { id: inserted.id }
    }
    if (subGuestName) {
      const { data: inserted, error } = await db
        .from('league_attendance')
        .insert({ league_id: params.id, period_id: periodId, guest_name: String(subGuestName).trim(), status: 'present' })
        .select('id').single()
      if (error || !inserted) return { error: error?.message ?? 'Insert failed' }
      return { id: inserted.id }
    }
    return { error: 'No sub specified' }
  }

  // Resolve + link each covering row to the covered member.
  const subs: unknown[] = []
  for (const choice of choices) {
    const resolved = await resolveSubRowId(choice)
    if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })
    const { data: sub, error: subErr } = await db
      .from('league_attendance')
      .update({ subbing_for_registration_id: coveredRegistrationId, status: 'present', updated_at: now })
      .eq('id', resolved.id)
      .select()
      .single()
    if (subErr || !sub) return NextResponse.json({ error: subErr?.message ?? 'Update failed' }, { status: 500 })
    subs.push(sub)
  }

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

  // Back-compat: single callers read `sub`; pair callers read `subs`.
  return NextResponse.json({ sub: subs[0], subs, covered })
}
