import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createNotifications } from '@/lib/notifications/create'

// POST /api/events/[id]/invite — the captain invites players to a play session.
// Body: { userIds: string[] }. Each gets an in-app notification (+ push) linking
// to the session; they join themselves via the normal flow (so free/paid/capacity
// are all handled by join). Captain (or creator) only.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: event } = await supabase
    .from('events')
    .select('id, title, starts_at, captain_user_id, creator_user_id')
    .eq('id', id)
    .single()
  if (!event) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (event.captain_user_id !== user.id && event.creator_user_id !== user.id) {
    return NextResponse.json({ error: 'Only the captain can invite players' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const userIds: string[] = Array.isArray(body.userIds)
    ? body.userIds.filter((u: unknown) => typeof u === 'string').slice(0, 30)
    : []
  const recipients = [...new Set(userIds)].filter((u) => u !== user.id)
  if (recipients.length === 0) return NextResponse.json({ error: 'No players selected' }, { status: 400 })

  const dateStr = new Date(event.starts_at).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric',
  })

  await createNotifications(recipients.map((recipientId) => ({
    recipientId,
    surface: 'event' as const,
    surfaceId: id,
    kind: 'event_invite',
    title: `You're invited: ${event.title}`,
    body: `${dateStr} — tap to join`,
    url: `/play/${id}`,
  })))

  return NextResponse.json({ ok: true, invited: recipients.length })
}
