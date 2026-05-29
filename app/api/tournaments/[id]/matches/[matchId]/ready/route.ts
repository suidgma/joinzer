import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit/log'
import { createNotifications } from '@/lib/notifications/create'

// POST /api/tournaments/[id]/matches/[matchId]/ready
// Marks a match as in_progress (ready to play).
// Uses 'in_progress' status — a future migration will add a 'ready' status
// to the competition_matches enum (CLAUDE.md Section 6).
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; matchId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Snapshot the prior status + registration IDs for audit and notifications.
  const { data: priorMatch } = await service
    .from('tournament_matches')
    .select('status, team_1_registration_id, team_2_registration_id')
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)
    .single()

  const { error } = await service
    .from('tournament_matches')
    .update({ status: 'in_progress' })
    .eq('id', params.matchId)
    .eq('tournament_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit the readiness transition. Non-blocking — logAudit swallows errors.
  await logAudit({
    actorId:    user.id,
    entityType: 'tournament_match',
    entityId:   params.matchId,
    action:     'match_marked_ready',
    before:     { status: priorMatch?.status ?? null },
    after:      { status: 'in_progress' },
  })

  // Notify all players in this match. Resolve registration IDs → user_ids.
  const regIds = [priorMatch?.team_1_registration_id, priorMatch?.team_2_registration_id].filter(Boolean)
  if (regIds.length > 0) {
    const { data: regs } = await service
      .from('tournament_registrations')
      .select('user_id, partner_user_id')
      .in('id', regIds)

    const recipientIds = [...new Set(
      (regs ?? []).flatMap(r => [r.user_id, r.partner_user_id].filter(Boolean))
    )]

    const { data: tourney } = await service
      .from('tournaments')
      .select('name')
      .eq('id', params.id)
      .single()

    await createNotifications(
      recipientIds.map(uid => ({
        recipientId: uid,
        surface: 'tournament' as const,
        surfaceId: params.id,
        kind: 'tournament_match_ready',
        title: `Your match is ready — ${tourney?.name ?? 'Tournament'}`,
        body: 'Head to your assigned court and mark ready to start.',
        url: `/tournaments/${params.id}/live`,
      }))
    )
  }

  return NextResponse.json({ ok: true })
}
