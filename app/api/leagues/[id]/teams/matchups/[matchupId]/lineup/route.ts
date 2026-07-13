import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer, teamMatchupRole } from '@/lib/leagues/teamsServer'
import { validateLineup, validateLineupSide } from '@/lib/leagues/teamMatchup'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; matchupId: string }> }

// PUT /api/leagues/[id]/teams/matchups/[matchupId]/lineup
// Two shapes:
//   Organizer (both sides): { lines: [{ team1: regId[], team2: regId[] }, …] }
//   Captain / organizer (one side): { side: 1|2, lines: [{ players: regId[] }, …] }
// Side 1 = the matchup's team_1 roster, side 2 = team_2. Setting a side fills only that
// side's columns on the child line fixtures (assembling the matchup from both captains).
export async function PUT(req: NextRequest, props: Params) {
  const { id, matchupId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()

  const { data: matchup } = await db.from('league_fixtures')
    .select('id, period_id, round_number, team_1_id, team_2_id, status')
    .eq('id', matchupId).eq('league_id', id).eq('match_stage', 'team_matchup').maybeSingle()
  if (!matchup) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 })
  if ((matchup as any).status === 'completed') return NextResponse.json({ error: 'Matchup already scored — clear results to change the lineup' }, { status: 409 })

  const { data: league } = await db.from('leagues').select('format_settings_json').eq('id', id).single()
  const settings = ((league as any)?.format_settings_json ?? {}) as Record<string, any>
  const lineConfigs = (settings.lines ?? []) as Array<{ discipline?: string }>
  const allowMulti = settings.allow_multi_line !== false

  const body = await req.json().catch(() => ({}))

  const rosterOf = async (teamId: string) => {
    const { data } = await db.from('league_team_members').select('registration_id').eq('team_id', teamId)
    return new Set((data ?? []).map((m: { registration_id: string }) => m.registration_id))
  }

  // ── Per-side path: a captain (or the organizer) sets one team's half. ──
  if (body.side === 1 || body.side === 2) {
    const side = body.side as 1 | 2
    const role = await teamMatchupRole(db, id, user.id, (matchup as any).team_1_id, (matchup as any).team_2_id)
    if (!role.isOrganizer && role.captainSide !== side) {
      return NextResponse.json({ error: 'You can only set your own team’s lineup' }, { status: 403 })
    }
    const teamId = side === 1 ? (matchup as any).team_1_id : (matchup as any).team_2_id
    const roster = await rosterOf(teamId)
    const validated = validateLineupSide(lineConfigs, Array.isArray(body.lines) ? body.lines : [], roster, allowMulti)
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

    const { data: existing } = await db.from('league_fixtures').select('id, match_number').eq('parent_fixture_id', matchupId)
    const idByNum = new Map<number, string>((existing ?? []).map((c: any) => [c.match_number, c.id]))

    for (let i = 0; i < lineConfigs.length; i++) {
      const players = validated.lines[i]
      const sideCols = side === 1
        ? { team_1_registration_id: players[0], team_1_partner_registration_id: players[1] ?? null }
        : { team_2_registration_id: players[0], team_2_partner_registration_id: players[1] ?? null }
      // Setting a lineup resets that line's scores (players changed).
      const reset = { team_1_score: null, team_2_score: null, winner_registration_id: null, status: 'scheduled' }
      if (idByNum.has(i + 1)) {
        await db.from('league_fixtures').update({ ...sideCols, ...reset }).eq('id', idByNum.get(i + 1)!)
      } else {
        await db.from('league_fixtures').insert({
          league_id: id, period_id: (matchup as any).period_id, parent_fixture_id: matchupId,
          match_stage: 'team_line', round_number: (matchup as any).round_number, match_number: i + 1,
          ...sideCols, status: 'scheduled',
        })
      }
    }
    // Lineup changed → reset the parent tally.
    await db.from('league_fixtures').update({ team_1_score: null, team_2_score: null, winner_team_id: null, status: 'scheduled' }).eq('id', matchupId)
    await logAudit({ actorId: user.id, entityType: 'league_match', entityId: matchupId, action: 'lineup_set', after: { side } })
    return NextResponse.json({ ok: true, side })
  }

  // ── Both-sides path: organizer sets the whole lineup (replaces child fixtures). ──
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const lineups = Array.isArray(body.lines) ? body.lines : []
  const roster1 = await rosterOf((matchup as any).team_1_id)
  const roster2 = await rosterOf((matchup as any).team_2_id)

  // Pure validation → ordered line rows (see lib/leagues/teamMatchup, unit-tested).
  const validated = validateLineup(lineConfigs, lineups, roster1, roster2, allowMulti)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const rows = validated.rows.map((r) => ({
    league_id: id,
    period_id: (matchup as any).period_id,
    parent_fixture_id: matchupId,
    match_stage: 'team_line',
    round_number: (matchup as any).round_number,
    match_number: r.match_number,
    team_1_registration_id: r.team_1_registration_id,
    team_1_partner_registration_id: r.team_1_partner_registration_id,
    team_2_registration_id: r.team_2_registration_id,
    team_2_partner_registration_id: r.team_2_partner_registration_id,
    status: 'scheduled',
  }))

  await db.from('league_fixtures').delete().eq('parent_fixture_id', matchupId)
  const { error } = await db.from('league_fixtures').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: matchupId, action: 'lineup_set', after: { lines: rows.length } })
  return NextResponse.json({ ok: true, lines: rows.length })
}
