import { createClient as createAdmin } from '@supabase/supabase-js'

const db = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type StaffRole = 'co_organizer' | 'volunteer'

/** Returns null if caller has no access. Returns role string if they do. */
export async function getTournamentRole(
  tournamentId: string,
  userId: string
): Promise<'organizer' | StaffRole | null> {
  const service = db()
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', tournamentId)
    .single()

  if (!tournament) return null
  if (tournament.organizer_id === userId) return 'organizer'

  const { data: staff } = await service
    .from('tournament_staff')
    .select('role')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .single()

  return (staff?.role as StaffRole) ?? null
}

/** True if user is organizer or co_organizer */
export async function canManage(tournamentId: string, userId: string): Promise<boolean> {
  const role = await getTournamentRole(tournamentId, userId)
  return role === 'organizer' || role === 'co_organizer'
}

/** True if user is organizer, co_organizer, or volunteer */
export async function canOperate(tournamentId: string, userId: string): Promise<boolean> {
  const role = await getTournamentRole(tournamentId, userId)
  return role !== null
}
