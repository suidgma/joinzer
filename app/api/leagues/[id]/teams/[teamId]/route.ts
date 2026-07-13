import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { teamAdmin, assertTeamLeagueOrganizer, captainTeamIds } from '@/lib/leagues/teamsServer'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; teamId: string }> }

// PATCH /api/leagues/[id]/teams/[teamId] — rename / set captain / withdraw.
// Body: { name?, captain_registration_id?, status? }. Organizer can change anything;
// the current captain can only transfer captaincy to one of their own teammates.
export async function PATCH(req: NextRequest, props: Params) {
  const { id, teamId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  const isOrganizer = gate.ok
  const isCaptain = !isOrganizer && (await captainTeamIds(db, id, user.id)).has(teamId)
  if (!isOrganizer && !isCaptain) return NextResponse.json({ error: gate.ok ? 'Forbidden' : gate.error }, { status: 403 })

  const { data: team } = await db.from('league_teams')
    .select('id, name, captain_registration_id, status').eq('id', teamId).eq('league_id', id).maybeSingle()
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (isOrganizer) {
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if ('captain_registration_id' in body) patch.captain_registration_id = body.captain_registration_id || null
    if (body.status === 'active' || body.status === 'withdrawn') patch.status = body.status
  } else {
    // Captain: transfer captaincy only, and only to a member of their own team.
    const newCap = body.captain_registration_id || null
    if (!newCap) return NextResponse.json({ error: 'Pick a teammate to make captain' }, { status: 400 })
    const { data: member } = await db.from('league_team_members').select('id').eq('team_id', teamId).eq('registration_id', newCap).maybeSingle()
    if (!member) return NextResponse.json({ error: 'That player isn’t on your team' }, { status: 400 })
    patch.captain_registration_id = newCap
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No changes' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  const { data: updated, error } = await db.from('league_teams')
    .update(patch).eq('id', teamId).select('id, name, captain_registration_id, status').single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A team with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Keep member roles in sync with the canonical captain (captain_registration_id).
  if ('captain_registration_id' in patch) {
    await db.from('league_team_members').update({ role: 'member' }).eq('team_id', teamId)
    if (patch.captain_registration_id) {
      await db.from('league_team_members').update({ role: 'captain' }).eq('team_id', teamId).eq('registration_id', patch.captain_registration_id as string)
    }
  }

  await logAudit({ actorId: user.id, entityType: 'league_team', entityId: teamId, action: 'updated', before: team, after: updated })
  return NextResponse.json({ team: updated })
}

// DELETE /api/leagues/[id]/teams/[teamId] — remove the team (cascades members).
export async function DELETE(_req: NextRequest, props: Params) {
  const { id, teamId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = teamAdmin()
  const gate = await assertTeamLeagueOrganizer(db, id, user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { data: team } = await db.from('league_teams').select('id, name').eq('id', teamId).eq('league_id', id).maybeSingle()
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const { error } = await db.from('league_teams').delete().eq('id', teamId).eq('league_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_team', entityId: teamId, action: 'deleted', before: team })
  return NextResponse.json({ ok: true })
}
