import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'
import { ladderAdmin, computeLadderUpdate } from '@/lib/leagues/ladderServer'
import { logAudit } from '@/lib/audit/log'
import { createNotifications, type NotificationInput } from '@/lib/notifications/create'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/ladder/finalize
// Apply the night's king-of-the-court results to the ladder: bounded movement
// toward the win-% order (absent entrants hold), persist ladder_positions +
// ladder_position_history, close the session, and notify anyone who moved.
// Organizer/co-admin. Body: { force?: boolean } to finalize with unscored courts.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const force = (await req.json().catch(() => ({})))?.force === true

  const db = ladderAdmin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const { data: league } = await db.from('leagues').select('format, format_settings_json').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: period } = await db
    .from('league_periods')
    .select('id, period_number')
    .eq('league_id', params.id)
    .eq('period_kind', 'ladder_session')
    .eq('status', 'active')
    .maybeSingle()
  if (!period) return NextResponse.json({ error: 'No active session to finalize.' }, { status: 400 })

  const update = await computeLadderUpdate(db, params.id, period.id, (league as any).format, (league as any).format_settings_json ?? null)
  if (update.roundsPlayed < 1) return NextResponse.json({ error: 'Play at least one round before finalizing.' }, { status: 400 })
  if (update.unscored > 0 && !force) {
    return NextResponse.json({ error: `${update.unscored} court${update.unscored === 1 ? '' : 's'} still unscored.`, incomplete: update.unscored }, { status: 409 })
  }

  const now = new Date().toISOString()

  // Replace the ladder order.
  await db.from('ladder_positions').delete().eq('league_id', params.id)
  const posErr = (await db.from('ladder_positions').insert(
    update.newRanking.map((rid, i) => ({ league_id: params.id, registration_id: rid, position: i + 1, updated_at: now })),
  )).error
  if (posErr) return NextResponse.json({ error: posErr.message }, { status: 500 })

  // Record history (one row per participant) for trend + prior-rank + delta.
  await db.from('ladder_position_history').insert(
    update.changes.map((c) => ({
      league_id: params.id,
      period_id: period.id,
      registration_id: c.regId,
      session_number: period.period_number,
      position_before: c.before,
      position_after: c.after,
      wins: c.wins,
      losses: c.losses,
      pf: c.pf,
      pa: c.pa,
    })),
  )

  await db.from('league_periods').update({ status: 'completed', updated_at: now }).eq('id', period.id)

  // Notify everyone whose rank changed (both partners in doubles).
  const notifs: NotificationInput[] = []
  for (const c of update.changes.filter((c) => c.delta !== 0)) {
    const reg = update.byRegId.get(c.regId)
    const partner = reg?.partner_registration_id ? update.byRegId.get(reg.partner_registration_id) : null
    const userIds = [reg?.user_id, partner?.user_id].filter((u): u is string => !!u)
    const dir = c.delta > 0 ? `up ${c.delta}` : `down ${-c.delta}`
    for (const recipientId of userIds) {
      notifs.push({
        recipientId,
        surface: 'league',
        surfaceId: params.id,
        kind: 'ladder_rank_changed',
        title: `You moved ${dir} on the ladder`,
        body: `Now #${c.after} after Session ${period.period_number}.`,
        url: `/leagues/${params.id}/standings`,
      })
    }
  }
  if (notifs.length) await createNotifications(notifs)

  const moved = update.changes.filter((c) => c.delta !== 0).length
  await logAudit({
    actorId: user.id,
    entityType: 'league',
    entityId: params.id,
    action: 'ladder_session_finalized',
    after: { session_number: period.period_number, moved },
  })

  return NextResponse.json({ ok: true, moved })
}
