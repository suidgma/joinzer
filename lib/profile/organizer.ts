// Server loader for the public organizer-identity page (/organizers/[id]). Assembles the
// PII-safe organizer identity, the tournaments + leagues they host, and headline stats
// (counts + distinct players served). Reads via the service-role client — selects only
// public-safe columns, never email/phone. Returns null when the user hosts nothing
// (i.e. isn't an organizer) so the page can 404.

import type { SupabaseClient } from '@supabase/supabase-js'

export type OrganizerIdentity = {
  id: string
  name: string | null
  displayName: string | null
  photoUrl: string | null
  memberSinceYear: number | null
  homeCourtName: string | null
}
export type HostedComp = {
  kind: 'tournament' | 'league'
  id: string
  name: string
  date: string | null
  status: string | null
  location: string | null
  isPast: boolean
  formatKind: string | null
}
export type OrganizerProfile = {
  identity: OrganizerIdentity
  tournaments: HostedComp[]
  leagues: HostedComp[]
  stats: { tournaments: number; leagues: number; playersServed: number }
}

// Terminal states render as "past"; everything else is treated as active/upcoming.
const PAST_STATUSES = new Set(['completed', 'cancelled', 'canceled', 'archived'])

// Active/upcoming first, then most-recent by date.
function sortComps(a: HostedComp, b: HostedComp): number {
  if (a.isPast !== b.isPast) return a.isPast ? 1 : -1
  return (a.date ?? '') > (b.date ?? '') ? -1 : (a.date ?? '') < (b.date ?? '') ? 1 : 0
}

export async function loadOrganizerProfile(admin: SupabaseClient, userId: string): Promise<OrganizerProfile | null> {
  const [{ data: p }, { data: tRows }, { data: lRows }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, name, display_name, profile_photo_url, created_at, home_court:locations!home_court_id(name)')
      .eq('id', userId)
      .maybeSingle(),
    admin
      .from('tournaments')
      .select('id, name, status, start_date, location:locations!location_id(name)')
      .eq('organizer_id', userId),
    admin
      .from('leagues')
      .select('id, name, status, start_date, format_kind, location_name, location:locations!location_id(name)')
      .eq('created_by', userId),
  ])
  if (!p) return null
  const prof = p as any
  const tournamentRows = (tRows ?? []) as any[]
  const leagueRows = (lRows ?? []) as any[]
  if (tournamentRows.length === 0 && leagueRows.length === 0) return null

  const tournaments: HostedComp[] = tournamentRows.map((t) => ({
    kind: 'tournament',
    id: t.id,
    name: t.name,
    date: t.start_date ?? null,
    status: t.status ?? null,
    location: t.location?.name ?? null,
    isPast: PAST_STATUSES.has(t.status ?? ''),
    formatKind: null,
  }))
  const leagues: HostedComp[] = leagueRows.map((l) => ({
    kind: 'league',
    id: l.id,
    name: l.name,
    date: l.start_date ?? null,
    status: l.status ?? null,
    location: l.location?.name ?? l.location_name ?? null,
    isPast: PAST_STATUSES.has(l.status ?? ''),
    formatKind: l.format_kind ?? null,
  }))
  tournaments.sort(sortComps)
  leagues.sort(sortComps)

  // Players served = distinct registrants across all their tournaments + leagues.
  const served = new Set<string>()
  const tIds = tournamentRows.map((t) => t.id)
  const lIds = leagueRows.map((l) => l.id)
  const [tReg, lReg] = await Promise.all([
    tIds.length ? admin.from('tournament_registrations').select('user_id').in('tournament_id', tIds) : Promise.resolve({ data: [] }),
    lIds.length ? admin.from('league_registrations').select('user_id').in('league_id', lIds) : Promise.resolve({ data: [] }),
  ])
  for (const r of (tReg.data ?? []) as any[]) if (r.user_id) served.add(r.user_id)
  for (const r of (lReg.data ?? []) as any[]) if (r.user_id) served.add(r.user_id)

  return {
    identity: {
      id: prof.id,
      name: prof.name ?? null,
      displayName: prof.display_name ?? null,
      photoUrl: prof.profile_photo_url ?? null,
      memberSinceYear: prof.created_at ? new Date(prof.created_at).getUTCFullYear() : null,
      homeCourtName: prof.home_court?.name ?? null,
    },
    tournaments,
    leagues,
    stats: { tournaments: tournaments.length, leagues: leagues.length, playersServed: served.size },
  }
}
