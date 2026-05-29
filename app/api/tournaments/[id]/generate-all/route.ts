import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  singleEliminationBracket,
  doubleEliminationBracket,
  poolPlayMatches,
  roundRobinMatches,
  rotatingDoublesMatches,
} from '@/lib/tournament/bracketBuilder'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'

// POST /api/tournaments/[id]/generate-all
// Generates brackets for every division that doesn't have matches yet.
// Returns { divisions: [{ divisionId, name, matchCount }], totalMatches }
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: divisions } = await service
    .from('tournament_divisions')
    .select('id, name, bracket_type, format_settings_json, partner_mode')
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  if (!divisions || divisions.length === 0) {
    return NextResponse.json({ error: 'No divisions found' }, { status: 400 })
  }

  const results: { divisionId: string; name: string; matchCount: number; skipped?: string }[] = []
  const allInserted: object[] = []

  for (const division of divisions) {
    // Skip if matches already exist for this division
    const { count: existing } = await service
      .from('tournament_matches')
      .select('id', { count: 'exact', head: true })
      .eq('division_id', division.id)

    if (existing && existing > 0) {
      results.push({ divisionId: division.id, name: division.name, matchCount: existing, skipped: 'already generated' })
      continue
    }

    const { data: registrations } = await service
      .from('tournament_registrations')
      .select('id, partner_registration_id')
      .eq('division_id', division.id)
      .eq('status', 'registered')
      .in('payment_status', ['paid', 'waived', 'comped'])
      .order('created_at', { ascending: true })

    const ft = division.bracket_type as string
    const fs = (division.format_settings_json ?? {}) as Record<string, unknown>
    const base = { tournament_id: params.id, division_id: division.id, status: 'scheduled' }
    const isRotating = division.partner_mode === 'rotating'

    if (isRotating && ft !== 'round_robin') {
      results.push({ divisionId: division.id, name: division.name, matchCount: 0, skipped: `rotating partner mode requires round_robin (this division uses ${ft})` })
      continue
    }

    let matchRows: object[]

    if (isRotating) {
      const playerIds = (registrations ?? []).map(r => r.id)
      if (playerIds.length < 4) {
        results.push({ divisionId: division.id, name: division.name, matchCount: 0, skipped: `rotating doubles needs 4+ solo registrations (${playerIds.length} found)` })
        continue
      }
      matchRows = rotatingDoublesMatches(playerIds, base).rows
    } else {
      const teams = dedupeRegistrationsToTeams(registrations ?? [])
      if (teams.length < 2) {
        results.push({ divisionId: division.id, name: division.name, matchCount: 0, skipped: `fewer than 2 settled registrations (${teams.length} found)` })
        continue
      }

      if (ft === 'single_elimination') {
        matchRows = singleEliminationBracket(teams, 'single_elimination', base).rows
      } else if (ft === 'double_elimination') {
        matchRows = doubleEliminationBracket(teams, base)
      } else if (ft === 'pool_play_playoffs') {
        const numPools = (fs.number_of_pools as number) ?? 2
        matchRows = poolPlayMatches(teams, numPools, base).rows
      } else {
        // round_robin: circle-method scheduling — see roundRobinMatches() for why.
        matchRows = roundRobinMatches(teams, base).rows
      }
    }

    const { data: inserted, error } = await service
      .from('tournament_matches')
      .insert(matchRows)
      .select()

    if (error || !inserted) {
      return NextResponse.json({ error: `Failed to generate matches for division "${division.name}": ${error?.message}` }, { status: 500 })
    }

    allInserted.push(...inserted)
    results.push({ divisionId: division.id, name: division.name, matchCount: inserted.length })
  }

  return NextResponse.json({
    divisions: results,
    totalMatches: allInserted.length,
    matches: allInserted,
  })
}
