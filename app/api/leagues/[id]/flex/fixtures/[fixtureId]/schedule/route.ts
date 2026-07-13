import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { flexAdmin, loadFlexFixtureContext } from '@/lib/leagues/flexServer'
import { logAudit } from '@/lib/audit/log'
import { createNotifications } from '@/lib/notifications/create'

type Params = { params: Promise<{ id: string; fixtureId: string }> }

// PATCH /api/leagues/[id]/flex/fixtures/[fixtureId]/schedule
// Flex self-scheduling: an entrant (or organizer) records when + where their match
// will be played, so both sides see the agreed time. Body:
//   { scheduledTime: string | null, court?: number | null }
// scheduledTime is a wall-clock datetime-local value ("2026-07-20T18:00") or null to clear.
export async function PATCH(req: NextRequest, props: Params) {
  const { id, fixtureId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = flexAdmin()
  const ctx = await loadFlexFixtureContext(db, id, fixtureId, user.id)
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Only a participant of the match (or the organizer) may schedule it.
  const onSide = ctx.sides.team_1.has(user.id) || ctx.sides.team_2.has(user.id)
  if (!onSide && !ctx.isOrganizer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (ctx.fixture.status !== 'scheduled' && ctx.fixture.status !== 'in_progress') {
    return NextResponse.json({ error: 'This match is already decided' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const scheduledTime = body.scheduledTime ? String(body.scheduledTime) : null
  let court: number | null = null
  if (body.court != null && body.court !== '') {
    court = Number(body.court)
    if (isNaN(court) || court < 1) return NextResponse.json({ error: 'Invalid court number' }, { status: 400 })
  }

  const { error } = await db
    .from('league_fixtures')
    .update({ scheduled_time: scheduledTime, court_number: court })
    .eq('id', fixtureId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    actorId: user.id,
    entityType: 'league_match',
    entityId: fixtureId,
    action: 'flex_scheduled',
    after: { scheduled_time: scheduledTime, court_number: court },
  })

  // Let the opponent know a time was set (skip when clearing).
  if (scheduledTime) {
    const actingSide = ctx.sides.team_1.has(user.id) ? 'team_1' : ctx.sides.team_2.has(user.id) ? 'team_2' : null
    const opponents =
      actingSide === 'team_1' ? ctx.sides.team_2
        : actingSide === 'team_2' ? ctx.sides.team_1
        : new Set<string>([...ctx.sides.team_1, ...ctx.sides.team_2])
    await createNotifications(
      [...opponents].filter((uid) => uid !== user.id).map((uid) => ({
        recipientId: uid,
        surface: 'league' as const,
        surfaceId: id,
        kind: 'flex_match_scheduled',
        title: 'Match time set',
        body: 'Your opponent proposed a time for your Flex match.',
        url: `/leagues/${id}`,
      })),
    )
  }

  return NextResponse.json({ ok: true })
}
