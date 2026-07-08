import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer } from '@/lib/leagues/teamsServer'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/teams — organizer creates a team. Body: { name }.
export async function POST(req: NextRequest, props: Params) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: team, error } = await db.from('league_teams')
    .insert({ league_id: id, name, created_by: user.id })
    .select('id, name, captain_registration_id, status')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A team with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAudit({ actorId: user.id, entityType: 'league_team', entityId: team!.id, action: 'created', after: { name } })
  return NextResponse.json({ team })
}
