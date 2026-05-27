import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  singleEliminationBracket,
  doubleEliminationBracket,
  poolPlayMatches,
} from '@/lib/tournament/bracketBuilder'

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
    .select('id, format_type, format_settings_json')
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })

  // Fetch registered teams
  const { data: registrations } = await service
    .from('tournament_registrations')
    .select('id')
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')
    .order('created_at', { ascending: true })

  const teams = (registrations ?? []).map(r => r.id)
  if (teams.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 registered entries to generate matches' }, { status: 400 })
  }

  const ft = division.format_type as string
  const fs = (division.format_settings_json ?? {}) as Record<string, unknown>
  const base = { tournament_id: params.id, division_id: params.divisionId, status: 'scheduled' }

  let matchRows: object[]
  if (ft === 'single_elimination') {
    matchRows = singleEliminationBracket(teams, 'single_elimination', base).rows
  } else if (ft === 'double_elimination') {
    matchRows = doubleEliminationBracket(teams, base)
  } else if (ft === 'pool_play_playoffs') {
    const numPools = (fs.number_of_pools as number) ?? 2
    matchRows = poolPlayMatches(teams, numPools, base).rows
  } else {
    // round_robin: all vs all in a single pool
    const rows: object[] = []
    let matchNum = 1
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        rows.push({
          ...base,
          team_1_registration_id: teams[i],
          team_2_registration_id: teams[j],
          match_stage: 'round_robin',
          round_number: 1,
          match_number: matchNum++,
        })
      }
    }
    matchRows = rows
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
