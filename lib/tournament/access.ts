import type { SupabaseClient } from '@supabase/supabase-js'

export type StaffRole = 'co_organizer' | 'volunteer'

/**
 * True if userId is the primary organizer or appears in tournament_staff
 * for tournamentId with a role allowed by `allowedRoles`.
 *
 * Defaults to allowing only 'co_organizer' — volunteers are scoped narrowly
 * (check-in + score entry) and most routes should reject them.
 */
export async function canManageTournament(
  service: SupabaseClient,
  tournamentId: string,
  userId: string,
  allowedRoles: StaffRole[] = ['co_organizer']
): Promise<boolean> {
  const { data: t } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', tournamentId)
    .single()

  if (!t) return false
  if (t.organizer_id === userId) return true

  if (allowedRoles.length === 0) return false

  const { data: staff } = await service
    .from('tournament_staff')
    .select('role')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .in('role', allowedRoles)
    .maybeSingle()

  return !!staff
}
