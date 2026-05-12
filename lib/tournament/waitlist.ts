import { createClient as createAdmin } from '@supabase/supabase-js'

const db = () => createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * If the given division has open capacity after a cancellation,
 * promotes the oldest waitlisted registration to 'registered'.
 * Returns the promoted registration row or null.
 */
export async function maybePromoteWaitlisted(
  tournamentId: string,
  divisionId: string
): Promise<{ id: string; user_id: string; player_name: string | null } | null> {
  const service = db()

  const { data: division } = await service
    .from('tournament_divisions')
    .select('max_entries')
    .eq('id', divisionId)
    .single()

  if (!division) return null

  const { count: registeredCount } = await service
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', divisionId)
    .eq('status', 'registered')

  if ((registeredCount ?? 0) >= division.max_entries) return null

  // Find oldest waitlisted
  const { data: oldest } = await service
    .from('tournament_registrations')
    .select('id, user_id')
    .eq('division_id', divisionId)
    .eq('tournament_id', tournamentId)
    .eq('status', 'waitlisted')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!oldest) return null

  await service
    .from('tournament_registrations')
    .update({ status: 'registered' })
    .eq('id', oldest.id)

  const { data: profile } = await service
    .from('profiles')
    .select('name')
    .eq('id', oldest.user_id)
    .single()

  return { id: oldest.id, user_id: oldest.user_id, player_name: profile?.name ?? null }
}
