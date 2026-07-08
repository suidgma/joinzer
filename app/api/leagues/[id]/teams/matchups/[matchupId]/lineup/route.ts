import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer } from '@/lib/leagues/teamsServer'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; matchupId: string }> }

// PUT /api/leagues/[id]/teams/matchups/[matchupId]/lineup
// Sets the full lineup for a team matchup — replaces the child line fixtures. Side 1 =
// the matchup's team_1 roster, side 2 = team_2 roster. Body:
//   { lines: [{ team1: registrationId[], team2: registrationId[] }, …] }  (one per line, in order)
export async function PUT(req: NextRequest, props: Params) {
  const { id, matchupId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: matchup } = await db.from('league_fixtures')
    .select('id, period_id, round_number, team_1_id, team_2_id, status')
    .eq('id', matchupId).eq('league_id', id).eq('match_stage', 'team_matchup').maybeSingle()
  if (!matchup) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 })
  if ((matchup as any).status === 'completed') return NextResponse.json({ error: 'Matchup already scored — clear results to change the lineup' }, { status: 409 })

  const { data: league } = await db.from('leagues').select('format_settings_json').eq('id', id).single()
  const settings = ((league as any)?.format_settings_json ?? {}) as Record<string, any>
  const lineConfigs = (settings.lines ?? []) as Array<{ discipline?: string }>
  if (lineConfigs.length === 0) return NextResponse.json({ error: 'This league has no line configuration' }, { status: 400 })
  const allowMulti = settings.allow_multi_line !== false

  const body = await req.json().catch(() => ({}))
  const lineups = Array.isArray(body.lines) ? body.lines : []
  if (lineups.length !== lineConfigs.length) return NextResponse.json({ error: 'Lineup must cover every line' }, { status: 400 })

  const rosterOf = async (teamId: string) => {
    const { data } = await db.from('league_team_members').select('registration_id').eq('team_id', teamId)
    return new Set((data ?? []).map((m: { registration_id: string }) => m.registration_id))
  }
  const roster1 = await rosterOf((matchup as any).team_1_id)
  const roster2 = await rosterOf((matchup as any).team_2_id)

  const used1 = new Set<string>()
  const used2 = new Set<string>()
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < lineConfigs.length; i++) {
    const expected = lineConfigs[i].discipline === 'singles' ? 1 : 2
    const t1 = (lineups[i]?.team1 ?? []).filter(Boolean) as string[]
    const t2 = (lineups[i]?.team2 ?? []).filter(Boolean) as string[]
    if (t1.length !== expected || t2.length !== expected) return NextResponse.json({ error: `Line ${i + 1} needs ${expected} player${expected > 1 ? 's' : ''} per side` }, { status: 400 })
    if (new Set(t1).size !== t1.length || new Set(t2).size !== t2.length) return NextResponse.json({ error: `Line ${i + 1} has a duplicate player` }, { status: 400 })
    for (const r of t1) {
      if (!roster1.has(r)) return NextResponse.json({ error: `Line ${i + 1}: a selected player isn't on that team's roster` }, { status: 400 })
      if (!allowMulti && used1.has(r)) return NextResponse.json({ error: 'A player is assigned to more than one line' }, { status: 400 })
    }
    for (const r of t2) {
      if (!roster2.has(r)) return NextResponse.json({ error: `Line ${i + 1}: a selected player isn't on that team's roster` }, { status: 400 })
      if (!allowMulti && used2.has(r)) return NextResponse.json({ error: 'A player is assigned to more than one line' }, { status: 400 })
    }
    if (!allowMulti) { t1.forEach((r) => used1.add(r)); t2.forEach((r) => used2.add(r)) }
    rows.push({
      league_id: id,
      period_id: (matchup as any).period_id,
      parent_fixture_id: matchupId,
      match_stage: 'team_line',
      round_number: (matchup as any).round_number,
      match_number: i + 1,
      team_1_registration_id: t1[0],
      team_1_partner_registration_id: t1[1] ?? null,
      team_2_registration_id: t2[0],
      team_2_partner_registration_id: t2[1] ?? null,
      status: 'scheduled',
    })
  }

  await db.from('league_fixtures').delete().eq('parent_fixture_id', matchupId)
  const { error } = await db.from('league_fixtures').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: matchupId, action: 'lineup_set', after: { lines: rows.length } })
  return NextResponse.json({ ok: true, lines: rows.length })
}
