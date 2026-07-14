import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flexAdmin, loadFlexFixtureContext } from '@/lib/leagues/flexServer'
import { organizerSetResult } from '@/lib/leagues/flexFixture'
import { logAudit } from '@/lib/audit/log'
import { broadcastLeagueFixtures } from '@/lib/realtime/leagueBroadcast'

type Params = { params: Promise<{ id: string; fixtureId: string }> }

// PATCH /api/leagues/[id]/flex/fixtures/[fixtureId]/organizer-score
// Organizer only: set or correct a match's final score at any point — including editing
// an already-completed match (the edit affordance the other formats have). Body:
// { team_1_score, team_2_score }.
export async function PATCH(req: NextRequest, props: Params) {
  const { id, fixtureId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = flexAdmin()
  const ctx = await loadFlexFixtureContext(db, id, fixtureId, user.id)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = await req.json().catch(() => ({}))
  const action = organizerSetResult(ctx.fixture, ctx.isOrganizer, body.team_1_score, body.team_2_score)
  if (!action.ok) return NextResponse.json({ error: action.error }, { status: action.status ?? 400 })

  const { error } = await db.from('league_fixtures').update(action.patch).eq('id', fixtureId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: fixtureId, action: 'flex_organizer_score', after: action.patch })
  await broadcastLeagueFixtures(id)
  return NextResponse.json({ ok: true })
}
