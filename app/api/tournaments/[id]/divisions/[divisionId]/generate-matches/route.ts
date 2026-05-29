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

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify organizer
  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Block duplicate generation
  const { count: existing } = await service
    .from('tournament_matches')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', params.divisionId)
  if (existing && existing > 0) {
    return NextResponse.json({ error: 'Matches already generated for this division' }, { status: 409 })
  }

  // Fetch division format
  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, bracket_type, format_settings_json, partner_mode')
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })

  // Fetch settled registered teams (paid, waived, comped) — unpaid rows (abandoned checkouts) must not get bracket slots.
  // We pull partner_registration_id so we can dedupe doubles pairs to one row per team
  // (the register_doubles_pair RPC inserts two cross-linked rows per team).
  const { data: registrations } = await service
    .from('tournament_registrations')
    .select('id, partner_registration_id')
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')
    .in('payment_status', ['paid', 'waived', 'comped'])
    .order('created_at', { ascending: true })

  const ft = division.bracket_type as string
  const fs = (division.format_settings_json ?? {}) as Record<string, unknown>
  const base = { tournament_id: params.id, division_id: params.divisionId, status: 'scheduled' }
  const isRotating = division.partner_mode === 'rotating'

  // Rotating mode is round-robin only (UI gates this). Other bracket types
  // would need their own rotating designs; reject here for safety.
  if (isRotating && ft !== 'round_robin') {
    return NextResponse.json({
      error: `Rotating partner mode is only supported with round_robin bracket type (this division uses ${ft}).`,
    }, { status: 400 })
  }

  let matchRows: object[]

  if (isRotating) {
    // Rotating: each registration is a solo player. Don't dedupe — every
    // registration row is one individual. Need at least 4 players for doubles.
    const playerIds = (registrations ?? []).map(r => r.id)
    if (playerIds.length < 4) {
      return NextResponse.json({
        error: `Rotating doubles needs at least 4 solo registrations. This division has ${playerIds.length}.`,
      }, { status: 400 })
    }
    matchRows = rotatingDoublesMatches(playerIds, base).rows
  } else {
    // Fixed mode: existing dedupe-and-bracket flow.
    const teams = dedupeRegistrationsToTeams(registrations ?? [])
    if (teams.length < 2) {
      return NextResponse.json({
        error: `Need at least 2 settled registrations to generate matches. This division has ${teams.length} settled registration${teams.length === 1 ? '' : 's'}.`,
      }, { status: 400 })
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
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ matches: inserted })
}
