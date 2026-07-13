import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'

// PATCH /api/sub-nominations/[id] — resolve a sub nomination.
//   { action: 'approve' | 'decline' }  → organizer only (per surface)
//   { action: 'cancel' }               → the requesting player, while still pending
//
// On approve, the surface-specific effect runs. Phase 1: 'play' = the nominee takes
// the requester's spot (a 1:1 swap, only before the session starts).

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Nomination = {
  id: string
  surface: string
  status: string
  requesting_user_id: string
  nominated_user_id: string
  event_id: string | null
  league_session_id: string | null
  covered_registration_id: string | null
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  if (!['approve', 'decline', 'cancel', 'undo'].includes(action)) {
    return NextResponse.json({ error: 'Bad action' }, { status: 400 })
  }

  const db = admin()
  const { data: nom } = await db
    .from('sub_nominations')
    .select('id, surface, status, requesting_user_id, nominated_user_id, event_id, league_session_id, covered_registration_id')
    .eq('id', id)
    .single<Nomination>()
  if (!nom) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()

  // Undo — the player who added the sub reverses an already-applied swap.
  if (action === 'undo') {
    if (nom.requesting_user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (nom.status !== 'approved') {
      return NextResponse.json({ error: 'Nothing to undo' }, { status: 409 })
    }
    if (nom.surface === 'play') {
      return undoPlay(db, { nom, actorId: user.id, now })
    }
    if (nom.surface === 'league') {
      return undoLeague(db, { nom, actorId: user.id, now })
    }
    return NextResponse.json({ error: 'Unsupported surface' }, { status: 400 })
  }

  if (nom.status !== 'pending') {
    return NextResponse.json({ error: 'This request was already resolved' }, { status: 409 })
  }

  // Cancel — only the player who made the request.
  if (action === 'cancel') {
    if (nom.requesting_user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await db.from('sub_nominations').update({ status: 'cancelled', resolved_by: user.id, resolved_at: now }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (nom.surface === 'play') {
    return resolvePlay(db, { nom, action, actorId: user.id, now })
  }
  return NextResponse.json({ error: 'Unsupported surface' }, { status: 400 })
}

async function resolvePlay(
  db: ReturnType<typeof admin>,
  { nom, action, actorId, now }: { nom: Nomination; action: string; actorId: string; now: string }
) {
  const { data: event } = await db
    .from('events')
    .select('id, title, starts_at, status, price_cents, captain_user_id, creator_user_id')
    .eq('id', nom.event_id!)
    .single()
  if (!event) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Approve/decline authority = the session captain (or creator).
  if (event.captain_user_id !== actorId && event.creator_user_id !== actorId) {
    return NextResponse.json({ error: 'Only the captain can resolve sub requests' }, { status: 403 })
  }

  if (action === 'decline') {
    await db.from('sub_nominations').update({ status: 'declined', resolved_by: actorId, resolved_at: now }).eq('id', nom.id)
    await createNotification({
      recipientId: nom.requesting_user_id,
      surface: 'event',
      surfaceId: event.id,
      kind: 'sub_declined',
      title: 'Sub request declined',
      body: `${event.title}`,
      url: `/play/${event.id}`,
    })
    return NextResponse.json({ ok: true })
  }

  // ---- approve: re-validate the guards, then swap the spot ----
  if (event.status === 'cancelled' || event.status === 'completed') {
    return NextResponse.json({ error: 'This session is closed' }, { status: 400 })
  }
  if (new Date(event.starts_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'This session has already started' }, { status: 400 })
  }

  const { data: parts } = await db
    .from('event_participants')
    .select('user_id, participant_status')
    .eq('event_id', event.id)
  const active = (parts ?? []).filter((p) => p.participant_status !== 'left')
  const requesterJoined = active.find((p) => p.user_id === nom.requesting_user_id && p.participant_status === 'joined')
  if (!requesterJoined) {
    return NextResponse.json({ error: 'That player is no longer in this session' }, { status: 400 })
  }
  if (active.some((p) => p.user_id === nom.nominated_user_id)) {
    return NextResponse.json({ error: 'The sub is already in this session' }, { status: 400 })
  }

  const paid = (event.price_cents ?? 0) > 0
  // Requester leaves; the nominee takes their joined slot (1:1, capacity preserved).
  await db.from('event_participants')
    .update({ participant_status: 'left' })
    .eq('event_id', event.id)
    .eq('user_id', nom.requesting_user_id)
  const { error: upErr } = await db.from('event_participants').upsert(
    {
      event_id: event.id,
      user_id: nom.nominated_user_id,
      participant_status: 'joined',
      payment_status: paid ? 'unpaid' : 'free',
    },
    { onConflict: 'event_id,user_id' }
  )
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await db.from('sub_nominations').update({ status: 'approved', resolved_by: actorId, resolved_at: now }).eq('id', nom.id)

  const [{ data: reqP }, { data: subP }] = await Promise.all([
    db.from('profiles').select('name').eq('id', nom.requesting_user_id).maybeSingle(),
    db.from('profiles').select('name').eq('id', nom.nominated_user_id).maybeSingle(),
  ])
  await Promise.all([
    createNotification({
      recipientId: nom.requesting_user_id,
      surface: 'event',
      surfaceId: event.id,
      kind: 'sub_approved',
      title: `Your sub is confirmed: ${event.title}`,
      body: `${subP?.name ?? 'Your sub'} is taking your spot`,
      url: `/play/${event.id}`,
    }),
    createNotification({
      recipientId: nom.nominated_user_id,
      surface: 'event',
      surfaceId: event.id,
      kind: 'sub_added',
      title: `You're subbing in: ${event.title}`,
      body: `You're on the roster in place of ${reqP?.name ?? 'a player'}`,
      url: `/play/${event.id}`,
    }),
  ])

  return NextResponse.json({ ok: true })
}

// Undo a play sub swap: the requester takes their spot back and the sub is removed.
// Only before the session starts, and only while the swap is still intact.
async function undoPlay(
  db: ReturnType<typeof admin>,
  { nom, actorId, now }: { nom: Nomination; actorId: string; now: string }
) {
  const { data: event } = await db
    .from('events')
    .select('id, title, starts_at, status, price_cents, captain_user_id')
    .eq('id', nom.event_id!)
    .single()
  if (!event) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (event.status === 'cancelled' || event.status === 'completed') {
    return NextResponse.json({ error: 'This session is closed' }, { status: 400 })
  }
  if (new Date(event.starts_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'This session has already started' }, { status: 400 })
  }

  const { data: parts } = await db
    .from('event_participants')
    .select('user_id, participant_status')
    .eq('event_id', event.id)
  const active = (parts ?? []).filter((p) => p.participant_status !== 'left')
  // The swap must still be intact: the sub is in, the requester is out.
  if (active.some((p) => p.user_id === actorId)) {
    return NextResponse.json({ error: "You're already back in this session" }, { status: 400 })
  }
  if (!active.some((p) => p.user_id === nom.nominated_user_id)) {
    return NextResponse.json({ error: 'Your sub already left — rejoin the session instead' }, { status: 400 })
  }

  const paid = (event.price_cents ?? 0) > 0
  // Reverse the swap: sub → left, requester → joined (1:1, capacity preserved).
  await db.from('event_participants')
    .update({ participant_status: 'left' })
    .eq('event_id', event.id)
    .eq('user_id', nom.nominated_user_id)
  const { error: upErr } = await db.from('event_participants').upsert(
    {
      event_id: event.id,
      user_id: actorId,
      participant_status: 'joined',
      payment_status: paid ? 'unpaid' : 'free',
    },
    { onConflict: 'event_id,user_id' }
  )
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await db.from('sub_nominations').update({ status: 'cancelled', resolved_by: actorId, resolved_at: now }).eq('id', nom.id)

  // Let the removed sub know.
  const { data: reqP } = await db.from('profiles').select('name').eq('id', actorId).maybeSingle()
  await createNotification({
    recipientId: nom.nominated_user_id,
    surface: 'event',
    surfaceId: event.id,
    kind: 'sub_removed',
    title: `Sub cancelled: ${event.title}`,
    body: `${reqP?.name ?? 'The player'} took their spot back`,
    url: `/play/${event.id}`,
  })

  return NextResponse.json({ ok: true })
}

// Undo a round-robin league self-sub: remove the sub's session row and clear the
// player's 'has_sub'. Only before the session's rounds are generated.
async function undoLeague(
  db: ReturnType<typeof admin>,
  { nom, actorId, now }: { nom: Nomination; actorId: string; now: string }
) {
  const { data: session } = await db
    .from('league_sessions')
    .select('id, league_id, status')
    .eq('id', nom.league_session_id!)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'completed' || session.status === 'cancelled') {
    return NextResponse.json({ error: 'This session is closed' }, { status: 400 })
  }

  const { data: rounds } = await db.from('league_rounds').select('id').eq('session_id', session.id).limit(1)
  if (rounds && rounds.length > 0) {
    return NextResponse.json({ error: 'Rounds are already set — ask your organizer' }, { status: 400 })
  }

  // Remove the sub row placed for this cover, then clear 'has_sub' on the player's row.
  await db
    .from('league_session_players')
    .delete()
    .eq('session_id', session.id)
    .eq('user_id', nom.nominated_user_id)
    .eq('sub_for_session_player_id', nom.covered_registration_id!)
  if (nom.covered_registration_id) {
    await db
      .from('league_session_players')
      .update({ actual_status: 'not_present' })
      .eq('id', nom.covered_registration_id)
  }

  await db.from('sub_nominations').update({ status: 'cancelled', resolved_by: actorId, resolved_at: now }).eq('id', nom.id)

  const [{ data: league }, { data: reqP }] = await Promise.all([
    db.from('leagues').select('name').eq('id', session.league_id).maybeSingle(),
    db.from('profiles').select('name').eq('id', actorId).maybeSingle(),
  ])
  await createNotification({
    recipientId: nom.nominated_user_id,
    surface: 'league',
    surfaceId: session.league_id,
    kind: 'sub_removed',
    title: `Sub cancelled: ${league?.name ?? 'League'}`,
    body: `${reqP?.name ?? 'The player'} took their spot back`,
    url: `/leagues/${session.league_id}`,
  })

  return NextResponse.json({ ok: true })
}
