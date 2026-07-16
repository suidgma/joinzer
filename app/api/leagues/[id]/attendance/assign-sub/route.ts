import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'
import { broadcastSubRequestsChanged } from '@/lib/subs/broadcast'

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
// NOTE (Phase 2 unification): the single-user placement here is functionally identical to the shared
// SQL primitive `place_league_sub_attendance` (migration 20260716000004) that assignAttendanceSub +
// the atomic open-pool accept use. It is NOT routed through that primitive because this route also
// handles cases the primitive intentionally doesn't model: guest subs (no user_id), subbing an
// existing attendance row (subAttendanceId), and doubles-pair clear-and-replace. Folding those into
// the primitive is the Phase-3 "organizer assignment through the unified model" work; until then keep
// the linkage columns (subbing_for_registration_id + covered status 'has_sub') in lockstep here.
//
// A doubles team is one entrant. Whole-team out → two choices; one player out →
// one choice with the other slot left present. Each choice carries the specific
// player registration it covers (`forRegistrationId`) so the team renders per slot
// ("SubA/SubB", "SubA/PresentPartner"). Body:
//   { periodId, coveredRegistrationId, subUserId? | subAttendanceId? | subGuestName? }   (single)
//   { periodId, coveredRegistrationId, slotRegistrationIds: [regA, regB],
//     subs: [{ subUserId? | subAttendanceId? | subGuestName?, forRegistrationId }, ...] } (doubles, 1-2)
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
  const choices: Array<{ subUserId?: string; subAttendanceId?: string; subGuestName?: string; forRegistrationId?: string }> =
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

  // Unified path: a single Joinzer-user sub (not a pair, no guest, no existing-attendance-row reuse)
  // goes through assign_organizer_sub_request — it creates the organizer_assigned request record AND
  // places the sub in one transaction, via the shared primitive. Guests + doubles-pair + attendance-id
  // reuse keep the existing placement below; their unified record is deferred (see the header note).
  const single = !isPair && choices.length === 1 ? choices[0] : null
  if (single && single.subUserId && !single.subAttendanceId && !single.subGuestName) {
    const { data: result, error } = await db.rpc('assign_organizer_sub_request', {
      p_actor_id: user.id,
      p_league_id: params.id,
      p_scope_kind: 'period',
      p_scope_id: periodId,
      p_covered_user_id: coveredReg.user_id,
      p_covered_registration_id: coveredRegistrationId,
      p_slot_registration_id: single.forRegistrationId ?? coveredRegistrationId,
      p_sub_user_id: single.subUserId,
      p_placed_with_override: body.override === true,
    })
    if (error) {
      const code = (error.message ?? '').trim()
      const map: Record<string, number> = {
        accepter_ineligible: 403, gender_mismatch: 403, own_request: 403, already_covered: 409,
        unsupported_format: 422, scope_mismatch: 422, covered_player_not_found: 404, league_not_found: 404,
      }
      const s = map[code] ?? 500
      return NextResponse.json({ error: s === 500 ? (error.message ?? 'Could not assign the sub') : code, code }, { status: s })
    }
    // Return a client-compatible shape (BoxAttendanceManager reads data.sub.{id,registration_id,user_id,status}).
    const subAttId = (result as { placement?: { sub_attendance_id?: string } }).placement?.sub_attendance_id
    const { data: subRow } = subAttId
      ? await db.from('league_attendance').select('id, registration_id, user_id, status').eq('id', subAttId).maybeSingle()
      : { data: null }
    broadcastSubRequestsChanged().catch(() => {})
    return NextResponse.json({ ok: true, unified: true, sub: subRow, subs: subRow ? [subRow] : [], ...(result as Record<string, unknown>) })
  }

  // For a doubles (re)assignment, clear existing covers on ALL of the team's slots
  // first so re-picking replaces rather than accumulates (and reducing 2→1 drops the
  // freed slot). Single assignment leaves other covers alone (there's only one).
  if (isPair) {
    const clearRegs: string[] = Array.isArray(body.slotRegistrationIds) && body.slotRegistrationIds.length
      ? body.slotRegistrationIds
      : [coveredRegistrationId]
    await db.from('league_attendance')
      .update({ subbing_for_registration_id: null, updated_at: now })
      .eq('league_id', params.id).eq('period_id', periodId)
      .in('subbing_for_registration_id', clearRegs)
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

  // Resolve + link each covering row to the specific player slot it fills (defaults
  // to the team registration for the single-sub / singles path).
  const subs: unknown[] = []
  for (const choice of choices) {
    const resolved = await resolveSubRowId(choice)
    if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 })
    const forReg = choice.forRegistrationId ?? coveredRegistrationId
    const { data: sub, error: subErr } = await db
      .from('league_attendance')
      .update({ subbing_for_registration_id: forReg, status: 'present', updated_at: now })
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
