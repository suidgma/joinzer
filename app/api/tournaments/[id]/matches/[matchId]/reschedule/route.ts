import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canOperate } from '@/lib/tournament/access'
import { createNotifications } from '@/lib/notifications/create'
import { logAudit } from '@/lib/audit/log'

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; matchId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await canOperate(params.id, user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { court_number, scheduled_time } = body

  if (court_number === undefined && scheduled_time === undefined) {
    return NextResponse.json({ error: 'Provide court_number or scheduled_time' }, { status: 400 })
  }

  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check match exists and is not completed; capture registration IDs for notifications
  const { data: match } = await service
    .from('tournament_matches')
    .select('id, status, team_1_registration_id, team_2_registration_id')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (match.status === 'completed') {
    return NextResponse.json({ error: 'Cannot reschedule a completed match' }, { status: 409 })
  }

  const update: Record<string, unknown> = {}
  if (court_number !== undefined) update.court_number = court_number === null ? null : Number(court_number)
  if (scheduled_time !== undefined) update.scheduled_time = scheduled_time || null

  const { data: updated, error } = await service
    .from('tournament_matches')
    .update(update)
    .eq('id', params.matchId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    actorId: user.id,
    entityType: 'tournament_match',
    entityId: params.matchId,
    action: 'match_rescheduled',
    before: { court_number: (match as any).court_number, scheduled_time: (match as any).scheduled_time },
    after: update,
  })

  // Notify all players in the rescheduled match
  const regIds = [match.team_1_registration_id, match.team_2_registration_id].filter(Boolean)
  if (regIds.length > 0) {
    const [{ data: regs }, { data: tourney }] = await Promise.all([
      service.from('tournament_registrations').select('user_id, partner_user_id').in('id', regIds),
      service.from('tournaments').select('name').eq('id', params.id).single(),
    ])

    const recipientIds = [...new Set(
      (regs ?? []).flatMap(r => [r.user_id, r.partner_user_id].filter(Boolean))
    )]

    const changeNote = court_number !== undefined && scheduled_time !== undefined
      ? 'Court and time have been updated.'
      : court_number !== undefined
        ? `Court ${court_number} has been assigned.`
        : 'Match time has been updated.'

    await createNotifications(
      recipientIds.map(uid => ({
        recipientId: uid,
        surface: 'tournament' as const,
        surfaceId: params.id,
        kind: 'tournament_match_rescheduled',
        title: `Match rescheduled — ${tourney?.name ?? 'Tournament'}`,
        body: changeNote,
        url: `/tournaments/${params.id}/live`,
      }))
    )
  }

  return NextResponse.json({ match: updated })
}
