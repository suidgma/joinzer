import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'

// POST /api/league-sub-requests/[id]/accept — an eligible player accepts an OPEN league substitute
// request. The claim (status open->filled) AND the substitute placement happen atomically inside the
// accept_sub_request SQL RPC (one transaction) — this route does NOT re-implement eligibility or
// placement. The route IS the trust boundary: it authenticates the caller with getUser() and passes
// the authenticated id to the RPC (which is granted to service_role only). Post-commit it fires
// best-effort notifications + a realtime attendance nudge — never rolling back the completed sub.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// RPC machine-code (the raised message) -> HTTP status. See docs/phases/substitutions-implementation-plan.md §5.2.
const STATUS: Record<string, number> = {
  bad_request: 400,
  request_not_found: 404, accepter_not_found: 404, league_not_found: 404, occasion_not_found: 404, covered_not_found: 404,
  own_request: 403, accepter_ineligible: 403, gender_mismatch: 403,
  unsupported_format: 422, invalid_scope: 422, scope_mismatch: 422,
  already_filled: 409, duplicate_participation: 409, already_covered: 409, schedule_conflict: 409, generation_started: 409,
  request_expired: 410, occasion_started: 410,
}

// Player-facing messages for the codes a normal user can trip.
const MESSAGE: Record<string, string> = {
  already_filled: 'Someone just took this one.',
  request_expired: 'This request has expired.',
  occasion_started: 'This session has already started.',
  generation_started: 'The lineup is already set — ask the organizer to sub you in.',
  duplicate_participation: "You're already in this session.",
  already_covered: 'This spot already has a substitute.',
  schedule_conflict: 'You already have another Joinzer session that day.',
  gender_mismatch: "This session's format doesn't match your profile.",
  own_request: "You can't sub in for your own request.",
  accepter_ineligible: 'Finish setting up your profile before subbing in.',
  unsupported_format: "This league format isn't supported for open-pool subs yet.",
  request_not_found: 'That request is no longer available.',
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()

  const { data: result, error } = await db.rpc('accept_sub_request', {
    p_request_id: id,
    p_accepter_id: user.id,
  })

  if (error) {
    const code = (error.message ?? '').trim()
    const status = STATUS[code] ?? 500
    const message = MESSAGE[code] ?? (status === 500 ? 'Could not complete the substitution.' : code)
    return NextResponse.json({ error: message, code }, { status })
  }

  // Placement is committed. Everything below is best-effort — a failure here must never undo the sub.
  fireSideEffects(id, user.id, result).catch(console.error)

  return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) })
}

async function fireSideEffects(requestId: string, accepterId: string, result: unknown) {
  const r = (result ?? {}) as {
    league_id?: string
    requesting_player_id?: string
    session_id?: string | null
    period_id?: string | null
    idempotent?: boolean
  }
  // A no-op idempotent retry shouldn't re-notify.
  if (r.idempotent) return

  const db = admin()

  // Live attendance nudge so the organizer's grid + "who's coming" reflect the placement.
  const occasionId = r.session_id ?? r.period_id
  if (occasionId) {
    await broadcast(attendanceTopic(occasionId), RealtimeEvents.attendanceStatusChanged, {
      userId: accepterId,
      status: 'present',
    }).catch(() => {})
  }

  if (!r.league_id) return

  const [{ data: league }, { data: accepter }, { data: requester }, { data: session }] = await Promise.all([
    db.from('leagues').select('name, created_by').eq('id', r.league_id).maybeSingle(),
    db.from('profiles').select('name').eq('id', accepterId).maybeSingle(),
    r.requesting_player_id
      ? db.from('profiles').select('name').eq('id', r.requesting_player_id).maybeSingle()
      : Promise.resolve({ data: null }),
    r.session_id
      ? db.from('league_sessions').select('session_date, session_number').eq('id', r.session_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const leagueName = league?.name ?? 'your league'
  const accepterName = accepter?.name ?? 'A player'
  const dateStr = session?.session_date
    ? new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })
    : ''
  const url = `/leagues/${r.league_id}`

  // Requester: their spot is covered.
  if (r.requesting_player_id) {
    await createNotification({
      recipientId: r.requesting_player_id,
      surface: 'league',
      surfaceId: r.league_id,
      kind: 'league_sub_confirmed',
      title: `${accepterName} is covering your spot`,
      body: `${leagueName}${dateStr ? ` — ${dateStr}` : ''}`,
      url,
    })
  }

  // Substitute: confirmation.
  await createNotification({
    recipientId: accepterId,
    surface: 'league',
    surfaceId: r.league_id,
    kind: 'league_sub_confirmed',
    title: `You're subbing in — ${leagueName}`,
    body: requester?.name ? `Covering for ${requester.name}${dateStr ? ` on ${dateStr}` : ''}` : (dateStr || undefined),
    url,
  })

  // Organizer FYI (skip if the organizer is the sub).
  if (league?.created_by && league.created_by !== accepterId) {
    await createNotification({
      recipientId: league.created_by,
      surface: 'league',
      surfaceId: r.league_id,
      kind: 'league_sub_filled',
      title: `Sub filled — ${leagueName}`,
      body: `${accepterName} is covering${requester?.name ? ` for ${requester.name}` : ''}${dateStr ? ` on ${dateStr}` : ''}`,
      url,
    })
  }
}
