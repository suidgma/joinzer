import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

function roundRobinMatches(teams: string[], base: object): object[] {
  const rows: object[] = []
  let matchNum = 1
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      rows.push({ ...base, team_1_registration_id: teams[i], team_2_registration_id: teams[j],
        match_stage: 'round_robin', round_number: 1, match_number: matchNum++ })
    }
  }
  return rows
}

function eliminationMatches(teams: string[], stage: string, base: object): object[] {
  const shuffled = [...teams].sort(() => Math.random() - 0.5)
  const rows: object[] = []
  let matchNum = 1
  for (let i = 0; i < shuffled.length; i += 2) {
    if (i + 1 < shuffled.length) {
      rows.push({ ...base, team_1_registration_id: shuffled[i], team_2_registration_id: shuffled[i + 1],
        match_stage: stage, round_number: 1, match_number: matchNum++ })
    } else {
      // Bye — auto-complete with team advancing
      rows.push({ ...base, team_1_registration_id: shuffled[i], team_2_registration_id: null,
        match_stage: stage, round_number: 1, match_number: matchNum++,
        status: 'completed', winner_registration_id: shuffled[i] })
    }
  }
  return rows
}

function poolPlayMatches(teams: string[], numPools: number, base: object): object[] {
  const pools: string[][] = Array.from({ length: Math.max(1, numPools) }, () => [])
  teams.forEach((t, i) => pools[i % pools.length].push(t))

  const rows: object[] = []
  let matchNum = 1
  pools.forEach((pool, pi) => {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        rows.push({ ...base, team_1_registration_id: pool[i], team_2_registration_id: pool[j],
          match_stage: 'pool_play', pool_number: pi + 1, match_number: matchNum++ })
      }
    }
  })
  return rows
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; divisionId: string } }
) {
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

  // Fetch registered teams only
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
  if (ft === 'round_robin') {
    matchRows = roundRobinMatches(teams, base)
  } else if (ft === 'single_elimination') {
    matchRows = eliminationMatches(teams, 'winners_bracket', base)
  } else if (ft === 'double_elimination') {
    matchRows = eliminationMatches(teams, 'winners_bracket', base)
  } else if (ft === 'pool_play_playoffs') {
    const numPools = (fs.number_of_pools as number) ?? 2
    matchRows = poolPlayMatches(teams, numPools, base)
  } else {
    matchRows = roundRobinMatches(teams, base)
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
