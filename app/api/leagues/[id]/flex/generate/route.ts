import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flexAdmin, assertFlexLeagueOrganizer } from '@/lib/leagues/flexServer'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { roundRobinMatches } from '@/lib/tournament/bracketBuilder'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/flex/generate
// Builds the whole-league round-robin of league_fixtures for a Flex league (one match per
// entrant pairing). Singles entrant = one registration; fixed-doubles = one canonical
// registration per pair. Refuses to wipe reported/scored fixtures without `force`.
export async function POST(req: NextRequest, props: Params) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = flexAdmin()
  const gate = await assertFlexLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json().catch(() => ({}))
  const force = body.force === true

  const { data: regsRaw } = await db
    .from('league_registrations')
    .select('id, partner_registration_id')
    .eq('league_id', id).eq('status', 'registered')
    .order('registered_at', { ascending: true })
  const entrants = dedupeRegistrationsToTeams((regsRaw ?? []) as { id: string; partner_registration_id: string | null }[])
  if (entrants.length < 2) return NextResponse.json({ error: 'Need at least 2 entrants to generate the schedule' }, { status: 400 })

  // Don't silently wipe played matches — regenerating over any reported/completed
  // result needs an explicit force.
  const { count: played } = await db
    .from('league_fixtures').select('id', { count: 'exact', head: true })
    .eq('league_id', id).eq('match_stage', 'round_robin')
    .in('status', ['in_progress', 'completed', 'disputed'])
  if ((played ?? 0) > 0 && !force) {
    return NextResponse.json({ error: 'played_exists', played }, { status: 409 })
  }

  const { rows } = roundRobinMatches(entrants, { status: 'scheduled' } as any)
  const fixtureRows = (rows as any[]).map((r) => ({
    league_id: id,
    round_number: r.round_number ?? null,
    match_number: r.match_number,
    match_stage: 'round_robin',
    team_1_registration_id: r.team_1_registration_id,
    team_2_registration_id: r.team_2_registration_id,
    status: 'scheduled',
  }))

  await db.from('league_fixtures').delete().eq('league_id', id).eq('match_stage', 'round_robin')
  const { error: insErr } = await db.from('league_fixtures').insert(fixtureRows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: id, action: 'flex_generated', after: { fixtures: fixtureRows.length, entrants: entrants.length } })
  return NextResponse.json({ ok: true, fixtures: fixtureRows.length, entrants: entrants.length })
}
