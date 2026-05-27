import type { SupabaseClient } from '@supabase/supabase-js'

type PromotionResult = {
  promotedRegistrationId: string
  userId: string
  divisionId: string
} | null

/**
 * Promote the oldest waitlisted registration in a division to "registered",
 * but only if effective team capacity is below max_entries.
 *
 * Effective teams = team registrations + floor(solo registrations / 2).
 * Mirrors the capacity math in the register route — keep these in sync.
 *
 * Returns the promoted registration info, or null if no promotion happened.
 */
export async function promoteFromWaitlist(
  service: SupabaseClient,
  divisionId: string
): Promise<PromotionResult> {
  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, max_entries, waitlist_enabled')
    .eq('id', divisionId)
    .single()

  if (!division || !division.waitlist_enabled) return null

  const { data: active } = await service
    .from('tournament_registrations')
    .select('id, registration_type, partner_registration_id')
    .eq('division_id', divisionId)
    .eq('status', 'registered')

  const teamRegs = (active ?? []).filter(r => r.registration_type === 'team').length
  const soloRegs = (active ?? []).filter(r => r.registration_type === 'solo').length
  const effectiveTeams = teamRegs + Math.floor(soloRegs / 2)

  if (effectiveTeams >= division.max_entries) return null

  // Pull the oldest waitlisted registration in this division
  const { data: nextUp } = await service
    .from('tournament_registrations')
    .select('id, user_id')
    .eq('division_id', divisionId)
    .eq('status', 'waitlisted')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!nextUp) return null

  const { error } = await service
    .from('tournament_registrations')
    .update({ status: 'registered' })
    .eq('id', nextUp.id)

  if (error) return null

  return {
    promotedRegistrationId: nextUp.id,
    userId: nextUp.user_id,
    divisionId,
  }
}
