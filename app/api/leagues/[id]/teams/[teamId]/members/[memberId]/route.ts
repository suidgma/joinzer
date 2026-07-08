import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer } from '@/lib/leagues/teamsServer'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; teamId: string; memberId: string }> }

// DELETE /api/leagues/[id]/teams/[teamId]/members/[memberId] — remove a player from the roster.
export async function DELETE(_req: NextRequest, props: Params) {
  const { id, teamId, memberId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: team } = await db.from('league_teams').select('id').eq('id', teamId).eq('league_id', id).maybeSingle()
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const { data: member } = await db.from('league_team_members')
    .select('id, registration_id').eq('id', memberId).eq('team_id', teamId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { error } = await db.from('league_team_members').delete().eq('id', memberId).eq('team_id', teamId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If the removed player was the team captain, clear the captain.
  await db.from('league_teams').update({ captain_registration_id: null })
    .eq('id', teamId).eq('captain_registration_id', (member as { registration_id: string }).registration_id)

  await logAudit({ actorId: user.id, entityType: 'league_team', entityId: teamId, action: 'member_removed', before: { registration_id: (member as { registration_id: string }).registration_id } })
  return NextResponse.json({ ok: true })
}
