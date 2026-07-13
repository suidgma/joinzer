import type { SupabaseClient } from '@supabase/supabase-js'

export type AttendanceSubResult = { ok: true } | { ok: false; error: string; status: number }

// Places a single substitute in the unified league_attendance model (box / ladder /
// flex / team): find-or-create the sub's attendance row for the period, link it to
// the covered registration, and mark the covered member 'has_sub'. Credit stays on
// the covered registration so standings/promotion stay correct. Mirrors the
// single-sub path of the organizer assign-sub route; shared with the player self-sub.
export async function assignAttendanceSub(
  db: SupabaseClient,
  {
    leagueId,
    periodId,
    coveredRegistrationId,
    coveredUserId,
    subUserId,
    forRegistrationId,
  }: {
    leagueId: string
    periodId: string
    // The TEAM entrant (canonical) registration — gets 'has_sub'.
    coveredRegistrationId: string
    coveredUserId?: string | null
    subUserId: string
    // The specific slot the sub fills (a doubles partner's own reg). Defaults to the
    // entrant for singles. The attendance grid normalizes a slot cover back to the
    // entrant, so both partners' subs group under the one team row.
    forRegistrationId?: string
  }
): Promise<AttendanceSubResult> {
  const now = new Date().toISOString()
  const slotRegistrationId = forRegistrationId ?? coveredRegistrationId

  // Resolve the sub's attendance row — link their registration if they have one,
  // else store the bare user_id.
  const { data: subReg } = await db
    .from('league_registrations')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', subUserId)
    .neq('status', 'cancelled')
    .maybeSingle()
  const { data: existing } = subReg
    ? await db.from('league_attendance').select('id').eq('period_id', periodId).eq('registration_id', subReg.id).maybeSingle()
    : await db.from('league_attendance').select('id').eq('period_id', periodId).eq('user_id', subUserId).limit(1).maybeSingle()

  let subRowId: string
  if (existing?.id) {
    subRowId = existing.id
  } else {
    const { data: inserted, error } = await db
      .from('league_attendance')
      .insert({ league_id: leagueId, period_id: periodId, registration_id: subReg?.id ?? null, user_id: subUserId, status: 'present' })
      .select('id')
      .single()
    if (error || !inserted) return { ok: false, error: error?.message ?? 'Could not add the sub', status: 500 }
    subRowId = inserted.id
  }

  const { error: linkErr } = await db
    .from('league_attendance')
    .update({ subbing_for_registration_id: slotRegistrationId, status: 'present', updated_at: now })
    .eq('id', subRowId)
  if (linkErr) return { ok: false, error: linkErr.message, status: 500 }

  // Mark the covered member 'has_sub' (update-or-insert their row).
  const { data: existingCovered } = await db
    .from('league_attendance')
    .select('id')
    .eq('period_id', periodId)
    .eq('registration_id', coveredRegistrationId)
    .maybeSingle()
  if (existingCovered) {
    await db.from('league_attendance').update({ status: 'has_sub', updated_at: now }).eq('id', existingCovered.id)
  } else {
    await db
      .from('league_attendance')
      .insert({ league_id: leagueId, period_id: periodId, registration_id: coveredRegistrationId, user_id: coveredUserId ?? null, status: 'has_sub' })
  }

  return { ok: true }
}
