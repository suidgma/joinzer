import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotifications } from '@/lib/notifications/create'

// POST /api/events/[id]/participants — the captain adds players straight into the
// session (they become participants without joining themselves). Capacity-aware:
// fills 'joined' up to max_players, then 'waitlist'. Captain (or creator) only.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: event } = await supabase
    .from('events')
    .select('id, title, starts_at, max_players, price_cents, captain_user_id, creator_user_id')
    .eq('id', id)
    .single()
  if (!event) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (event.captain_user_id !== user.id && event.creator_user_id !== user.id) {
    return NextResponse.json({ error: 'Only the captain can add players' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const userIds: string[] = Array.isArray(body.userIds)
    ? body.userIds.filter((u: unknown) => typeof u === 'string').slice(0, 30)
    : []
  const requested = [...new Set(userIds)].filter((u) => u !== user.id)
  if (requested.length === 0) return NextResponse.json({ error: 'No players selected' }, { status: 400 })

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: existing } = await db.from('event_participants').select('user_id, participant_status').eq('event_id', id)
  const active = new Set(((existing ?? []) as { user_id: string; participant_status: string }[])
    .filter((p) => p.participant_status !== 'left').map((p) => p.user_id))
  let joinedCount = ((existing ?? []) as { participant_status: string }[]).filter((p) => p.participant_status === 'joined').length

  const toAdd = requested.filter((u) => !active.has(u))
  if (toAdd.length === 0) return NextResponse.json({ ok: true, added: 0, waitlisted: 0 })

  const paid = (event.price_cents ?? 0) > 0
  const cap = event.max_players ?? Number.POSITIVE_INFINITY
  const rows = toAdd.map((userId) => {
    const status = joinedCount < cap ? 'joined' : 'waitlist'
    if (status === 'joined') joinedCount++
    return { event_id: id, user_id: userId, participant_status: status, payment_status: paid ? 'unpaid' : 'free' }
  })

  const { error } = await db.from('event_participants').upsert(rows, { onConflict: 'event_id,user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const dateStr = new Date(event.starts_at).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
  })
  await createNotifications(toAdd.map((recipientId) => ({
    recipientId,
    surface: 'event' as const,
    surfaceId: id,
    kind: 'event_added',
    title: `You've been added: ${event.title}`,
    body: `${dateStr} — you're on the roster`,
    url: `/play/${id}`,
  })))

  return NextResponse.json({
    ok: true,
    added: rows.filter((r) => r.participant_status === 'joined').length,
    waitlisted: rows.filter((r) => r.participant_status === 'waitlist').length,
  })
}
