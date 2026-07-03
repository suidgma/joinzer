import { createClient as createAdmin } from '@supabase/supabase-js'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export type RunSessionAction = { label: string; href: string }

/**
 * The "Run Session" nav action for a league manage view — format-aware:
 *  - session_rr → the in-progress session, else the next scheduled one, at its live page.
 *  - box        → the active cycle's attendance surface (if a cycle with boxes exists).
 * Returns undefined for non-admins or when there's nothing to run. Reads via the
 * service-role client (box tables are RLS deny-all).
 */
export async function getRunSessionAction(
  leagueId: string,
  isAdmin: boolean,
  formatKind: string | null,
): Promise<RunSessionAction | undefined> {
  if (!isAdmin) return undefined
  const db = admin()

  if (formatKind === 'box') {
    const { data: cycle } = await db
      .from('league_periods')
      .select('id')
      .eq('league_id', leagueId)
      .eq('period_kind', 'cycle')
      .eq('status', 'active')
      .order('period_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!cycle) return undefined
    // Need at least one box to have something to take attendance for.
    const { count } = await db
      .from('league_boxes')
      .select('id', { count: 'exact', head: true })
      .eq('period_id', cycle.id)
    if (!count) return undefined
    return { label: 'Run Session', href: `/leagues/${leagueId}/attendance` }
  }

  // session_rr (default)
  const { data } = await db
    .from('league_sessions')
    .select('id, status')
    .eq('league_id', leagueId)
    .in('status', ['in_progress', 'scheduled'])
    .order('session_date', { ascending: true })
  if (!data || data.length === 0) return undefined
  const next = data.find((s) => s.status === 'in_progress') ?? data.find((s) => s.status === 'scheduled')
  return next ? { label: 'Run Session', href: `/leagues/${leagueId}/sessions/${next.id}/live` } : undefined
}
