import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'

// POST /api/sub-nominations — a PLAYER picks an existing Joinzer user to sub for them.
// The sub takes effect IMMEDIATELY (no organizer approval — the point is less work for
// organizers, not more). We still record the swap in sub_nominations as an audit trail
// and notify the organizer + the sub. Surface-dispatched; Phase 1 implements 'play'.
//
// sub_nominations is deny-all RLS, so every read/write here goes through the service
// role — which means THIS ROUTE is the authorization boundary: we re-derive the
// caller's right to act from the server, never trust the client.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const nominatedUserId = typeof body.nominatedUserId === 'string' ? body.nominatedUserId : ''
  const note = body.note ? String(body.note).slice(0, 300) : null
  if (!nominatedUserId) return NextResponse.json({ error: 'Pick a substitute' }, { status: 400 })
  if (nominatedUserId === user.id) {
    return NextResponse.json({ error: "You can't sub in for yourself" }, { status: 400 })
  }

  const db = admin()
  const { data: nominee } = await db.from('profiles').select('id, name').eq('id', nominatedUserId).maybeSingle()
  if (!nominee) return NextResponse.json({ error: 'Substitute not found' }, { status: 400 })

  if (body.surface === 'play') {
    return createPlayNomination(db, { userId: user.id, eventId: body.eventId, nominee, note })
  }
  // Leagues + Tournaments are wired in later phases.
  return NextResponse.json({ error: 'Unsupported surface' }, { status: 400 })
}

async function createPlayNomination(
  db: ReturnType<typeof admin>,
  { userId, eventId, nominee, note }: { userId: string; eventId?: string; nominee: { id: string; name: string }; note: string | null }
) {
  if (!eventId) return NextResponse.json({ error: 'Missing session' }, { status: 400 })

  const { data: event } = await db
    .from('events')
    .select('id, title, starts_at, status, price_cents, captain_user_id')
    .eq('id', eventId)
    .single()
  if (!event) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (event.status === 'cancelled' || event.status === 'completed') {
    return NextResponse.json({ error: 'This session is closed' }, { status: 400 })
  }
  if (new Date(event.starts_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'This session has already started' }, { status: 400 })
  }

  // The requester must currently be a joined player; the nominee must not already be in.
  const { data: parts } = await db
    .from('event_participants')
    .select('user_id, participant_status')
    .eq('event_id', eventId)
  const active = (parts ?? []).filter((p) => p.participant_status !== 'left')
  const me = active.find((p) => p.user_id === userId)
  if (!me || me.participant_status !== 'joined') {
    return NextResponse.json({ error: 'Only a joined player can add a sub' }, { status: 403 })
  }
  if (active.some((p) => p.user_id === nominee.id)) {
    return NextResponse.json({ error: `${nominee.name} is already in this session` }, { status: 400 })
  }

  // Apply the swap immediately: the requester leaves, the sub takes their joined slot
  // (1:1, capacity preserved). No organizer approval required.
  const paid = (event.price_cents ?? 0) > 0
  await db.from('event_participants')
    .update({ participant_status: 'left' })
    .eq('event_id', eventId)
    .eq('user_id', userId)
  const { error: upErr } = await db.from('event_participants').upsert(
    {
      event_id: eventId,
      user_id: nominee.id,
      participant_status: 'joined',
      payment_status: paid ? 'unpaid' : 'free',
    },
    { onConflict: 'event_id,user_id' }
  )
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Record the applied swap (audit trail).
  const nowIso = new Date().toISOString()
  await db.from('sub_nominations').insert({
    surface: 'play',
    event_id: eventId,
    requesting_user_id: userId,
    nominated_user_id: nominee.id,
    note,
    status: 'approved',
    resolved_by: userId,
    resolved_at: nowIso,
  })

  // Notify the organizer (FYI) and the sub.
  const { data: reqProfile } = await db.from('profiles').select('name').eq('id', userId).maybeSingle()
  await Promise.all([
    createNotification({
      recipientId: event.captain_user_id,
      surface: 'event',
      surfaceId: eventId,
      kind: 'sub_added',
      title: `Sub added: ${event.title}`,
      body: `${reqProfile?.name ?? 'A player'} subbed in ${nominee.name} for their spot`,
      url: `/play/${eventId}`,
    }),
    createNotification({
      recipientId: nominee.id,
      surface: 'event',
      surfaceId: eventId,
      kind: 'sub_added',
      title: `You're subbing in: ${event.title}`,
      body: `You're on the roster in place of ${reqProfile?.name ?? 'a player'}`,
      url: `/play/${eventId}`,
    }),
  ])

  return NextResponse.json({ ok: true })
}
