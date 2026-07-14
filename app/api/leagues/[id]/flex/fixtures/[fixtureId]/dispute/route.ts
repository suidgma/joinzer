import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flexAdmin, loadFlexFixtureContext } from '@/lib/leagues/flexServer'
import { disputeResult } from '@/lib/leagues/flexFixture'
import { logAudit } from '@/lib/audit/log'
import { createNotification } from '@/lib/notifications/create'
import { broadcastLeagueFixtures } from '@/lib/realtime/leagueBroadcast'

type Params = { params: Promise<{ id: string; fixtureId: string }> }

// PATCH /api/leagues/[id]/flex/fixtures/[fixtureId]/dispute
// The opposing entrant flags the reported score → disputed (organizer resolves).
export async function PATCH(_req: NextRequest, props: Params) {
  const { id, fixtureId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = flexAdmin()
  const ctx = await loadFlexFixtureContext(db, id, fixtureId, user.id)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const action = disputeResult(ctx.fixture, ctx.sides, user.id, ctx.isOrganizer)
  if (!action.ok) return NextResponse.json({ error: action.error }, { status: action.status ?? 400 })

  const { error } = await db.from('league_fixtures').update(action.patch).eq('id', fixtureId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ actorId: user.id, entityType: 'league_match', entityId: fixtureId, action: 'flex_disputed', after: action.patch })

  // Notify the organizer that a result needs resolving.
  const { data: league } = await db.from('leagues').select('created_by').eq('id', id).single()
  const organizer = (league as any)?.created_by
  if (organizer && organizer !== user.id) {
    await createNotification({
      recipientId: organizer,
      surface: 'league', surfaceId: id,
      kind: 'flex_result_disputed',
      title: 'A Flex result is disputed',
      body: 'A player disputed a reported match. Resolve it from the Flex screen.',
      url: `/leagues/${id}/flex`,
    })
  }

  await broadcastLeagueFixtures(id)
  return NextResponse.json({ ok: true })
}
