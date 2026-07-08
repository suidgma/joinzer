import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer, rosteredRegistrationIds } from '@/lib/leagues/teamsServer'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; teamId: string }> }

// POST /api/leagues/[id]/teams/[teamId]/members — add a registered player to the roster.
// Body: { registration_id }. A player belongs to at most one team per league.
export async function POST(req: NextRequest, props: Params) {
  const { id, teamId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const registration_id = typeof body.registration_id === 'string' ? body.registration_id : ''
  if (!registration_id) return NextResponse.json({ error: 'registration_id is required' }, { status: 400 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: team } = await db.from('league_teams').select('id').eq('id', teamId).eq('league_id', id).maybeSingle()
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const { data: reg } = await db.from('league_registrations').select('id, status').eq('id', registration_id).eq('league_id', id).maybeSingle()
  if (!reg || (reg as { status: string }).status !== 'registered') {
    return NextResponse.json({ error: 'Player is not a registered member of this league' }, { status: 400 })
  }

  const rostered = await rosteredRegistrationIds(db, id)
  if (rostered.has(registration_id)) return NextResponse.json({ error: 'Player is already on a team in this league' }, { status: 409 })

  const { data: member, error } = await db.from('league_team_members')
    .insert({ team_id: teamId, registration_id, role: 'member' })
    .select('id, team_id, registration_id, role').single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'Player is already on this team' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAudit({ actorId: user.id, entityType: 'league_team', entityId: teamId, action: 'member_added', after: { registration_id } })
  return NextResponse.json({ member })
}
