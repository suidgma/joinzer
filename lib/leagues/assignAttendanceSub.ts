import type { SupabaseClient } from '@supabase/supabase-js'

export type AttendanceSubResult = { ok: true } | { ok: false; error: string; status: number }

// Places a single substitute in the unified league_attendance model (box / ladder) by delegating to
// the shared SQL placement primitive `place_league_sub_attendance` (migration 20260716000004) — the
// SINGLE source of truth for attendance-model substitute linkage. The same primitive backs the
// atomic open-pool acceptance RPC (accept_sub_request), so organizer manual-assign, player self-sub,
// and open-pool accept produce identical linkage. Finds-or-creates the sub's attendance row for the
// period, links it to the covered slot registration, and marks the covered ENTRANT 'has_sub'. Credit
// stays on the covered registration so standings/promotion stay correct; sub_credit_cap is unaffected.
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
    // entrant for singles. The attendance grid normalizes a slot cover back to the entrant.
    forRegistrationId?: string
  }
): Promise<AttendanceSubResult> {
  const { error } = await db.rpc('place_league_sub_attendance', {
    p_league_id: leagueId,
    p_period_id: periodId,
    p_covered_registration_id: coveredRegistrationId,
    p_covered_user_id: coveredUserId ?? null,
    p_sub_user_id: subUserId,
    p_for_registration_id: forRegistrationId ?? null,
  })
  if (error) return { ok: false, error: error.message ?? 'Could not add the sub', status: 500 }
  return { ok: true }
}
