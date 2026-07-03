import type { SupabaseClient } from '@supabase/supabase-js'

export interface RunnableSession {
  id: string
}

/**
 * The session an organizer would "Run" next from a league manage view:
 * the in-progress session if one exists, otherwise the earliest scheduled one.
 * Returns null for non-admins or when there's nothing runnable — so callers can
 * render the "Run Session" action on every manage page, not just Overview.
 */
export async function getRunnableSession(
  supabase: SupabaseClient,
  leagueId: string,
  isAdmin: boolean,
): Promise<RunnableSession | null> {
  if (!isAdmin) return null
  const { data } = await supabase
    .from('league_sessions')
    .select('id, status')
    .eq('league_id', leagueId)
    .in('status', ['in_progress', 'scheduled'])
    .order('session_date', { ascending: true })
  if (!data || data.length === 0) return null
  const next =
    data.find((s) => s.status === 'in_progress') ?? data.find((s) => s.status === 'scheduled')
  return next ? { id: next.id as string } : null
}
