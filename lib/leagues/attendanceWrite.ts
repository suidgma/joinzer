import type { SupabaseClient } from '@supabase/supabase-js'

// Organizer/co-admin gate shared by the box attendance write routes. Pass the
// service-role admin client (box + attendance tables are RLS deny-all).
export async function authorizeOrganizer(
  db: SupabaseClient,
  leagueId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: league } = await db.from('leagues').select('created_by').eq('id', leagueId).single()
  if (!league) return { ok: false, status: 404, error: 'Not found' }
  if (league.created_by === userId) return { ok: true }
  const { data: myReg } = await db
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()
  if (myReg?.is_co_admin === true) return { ok: true }
  return { ok: false, status: 403, error: 'Forbidden' }
}

export const ATTENDANCE_STATUSES = [
  'present',
  'coming',
  'late',
  'cannot_attend',
  'has_sub',
  'not_present',
] as const
