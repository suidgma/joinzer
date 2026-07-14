import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

// GET /api/chat/unread-sources
// The chat "sources" the signed-in user belongs to (leagues + tournaments they're
// registered in or organize) that have had a message recently, each with the latest
// message time. The client compares `latest` to its per-entity localStorage last-read to
// decide what's unread, and subscribes to these for live updates (cross-app nav badges).
// Bounded to the last 30 days so it stays small — older unread isn't worth surfacing.
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ sources: [] })

  const db = admin()
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

  const [{ data: leagueRegs }, { data: myLeagues }, { data: tourRegs }, { data: myTours }] = await Promise.all([
    db.from('league_registrations').select('league_id').eq('user_id', user.id).eq('status', 'registered'),
    db.from('leagues').select('id').eq('created_by', user.id),
    db.from('tournament_registrations').select('tournament_id').eq('user_id', user.id).neq('status', 'cancelled'),
    db.from('tournaments').select('id').eq('organizer_id', user.id),
  ])
  const leagueIds = [...new Set([...(leagueRegs ?? []).map((r: any) => r.league_id), ...(myLeagues ?? []).map((l: any) => l.id)])]
  const tourIds = [...new Set([...(tourRegs ?? []).map((r: any) => r.tournament_id), ...(myTours ?? []).map((t: any) => t.id)])]

  const sources: { table: string; entityId: string; surface: 'leagues' | 'tournaments'; latest: string }[] = []

  if (leagueIds.length) {
    const { data } = await db.from('league_messages').select('league_id, created_at')
      .in('league_id', leagueIds).gte('created_at', cutoff).order('created_at', { ascending: false })
    const latest = new Map<string, string>()
    for (const m of data ?? []) if (!latest.has((m as any).league_id)) latest.set((m as any).league_id, (m as any).created_at)
    for (const [entityId, l] of latest) sources.push({ table: 'league_messages', entityId, surface: 'leagues', latest: l })
  }
  if (tourIds.length) {
    const { data } = await db.from('tournament_messages').select('tournament_id, created_at')
      .in('tournament_id', tourIds).gte('created_at', cutoff).order('created_at', { ascending: false })
    const latest = new Map<string, string>()
    for (const m of data ?? []) if (!latest.has((m as any).tournament_id)) latest.set((m as any).tournament_id, (m as any).created_at)
    for (const [entityId, l] of latest) sources.push({ table: 'tournament_messages', entityId, surface: 'tournaments', latest: l })
  }

  return NextResponse.json({ sources })
}
