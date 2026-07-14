import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flexAdmin, loadFlexFixtureContext } from '@/lib/leagues/flexServer'
import { reportResult, resolveActingSide } from '@/lib/leagues/flexFixture'
import { logAudit } from '@/lib/audit/log'
import { createNotifications } from '@/lib/notifications/create'
import { broadcastLeagueFixtures } from '@/lib/realtime/leagueBroadcast'

type Params = { params: Promise<{ id: string; fixtureId: string }> }

// PATCH /api/leagues/[id]/flex/fixtures/[fixtureId]/report
// An entrant (or organizer) enters the score → awaiting the opponent's confirmation.
// Body: { team_1_score, team_2_score }.
export async function PATCH(req: NextRequest, props: Params) {
  const { id, fixtureId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = flexAdmin()
  const ctx = await loadFlexFixtureContext(db, id, fixtureId, user.id)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = await req.json().catch(() => ({}))
  const action = reportResult(ctx.fixture, ctx.sides, user.id, ctx.isOrganizer, body.team_1_score, body.team_2_score)
  if (!action.ok) return NextResponse.json({ error: action.error }, { status: action.status ?? 400 })

  const { error } = await db.from('league_fixtures').update(action.patch).eq('id', fixtureId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: fixtureId, action: 'flex_reported', after: action.patch })

  // Notify the opposing entrant to confirm (or, if the organizer reported, both sides).
  const reporterSide = resolveActingSide(ctx.sides, user.id)
  const opponents = reporterSide === 'team_1' ? ctx.sides.team_2
    : reporterSide === 'team_2' ? ctx.sides.team_1
    : new Set<string>([...ctx.sides.team_1, ...ctx.sides.team_2])
  await createNotifications([...opponents].filter((uid) => uid !== user.id).map((uid) => ({
    recipientId: uid,
    surface: 'league' as const,
    surfaceId: id,
    kind: 'flex_result_reported',
    title: 'Confirm your match result',
    body: 'Your opponent reported a Flex match score. Confirm or dispute it.',
    url: `/leagues/${id}`,
  })))

  await broadcastLeagueFixtures(id)
  return NextResponse.json({ ok: true })
}
