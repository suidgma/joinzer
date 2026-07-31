import { Resend } from 'resend'
import { withBrandHeader } from '@/lib/email/send'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe'
import { buildNewSessionEmailHtml } from '@/lib/email/newSessionEmail'
import { authorizeNewSessionNotification, isEventId } from '@/lib/events/notifyAuthorization'
import { getSiteUrl } from '@/lib/utils/site-url'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// POST /api/notify-new-session — emails every opted-in profile that a session was posted.
// Body: { eventId }. Creator of that event only.
//
// This fans out to the whole opted-in user base from support@joinzer.com, so it is the
// highest-blast-radius endpoint an ordinary player can reach. Two rules hold it shut
// (docs/security.md — the API route is the security boundary, ADR-03):
//
//   1. The caller is authenticated AND authorized as the event's creator. It used to check
//      only that *someone* was signed in, and read `creatorId` from the request body.
//   2. Everything the email renders is read from the database by `eventId` and escaped on
//      the way into the template. `title` and `locationName` used to come from the body
//      straight into the HTML, so any signed-in account could mail arbitrary markup —
//      including links — to everyone who had opted in.

type NotifiableSession = {
  id: string
  title: string
  starts_at: string
  duration_minutes: number
  max_players: number
  creator_user_id: string
  location_id: string
}

export async function POST(request: NextRequest) {
  const authClient = createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const eventId = (body as { eventId?: unknown }).eventId
  if (!isEventId(eventId)) {
    return NextResponse.json({ error: 'A valid eventId is required' }, { status: 400 })
  }

  // Service role: the ownership check below is the guard, not RLS. Reading the event through
  // the caller's own client would conflate "you may not do this" with "this does not exist".
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('id, title, starts_at, duration_minutes, max_players, creator_user_id, location_id')
    .eq('id', eventId)
    .maybeSingle()

  // A failed lookup is not a missing session. `maybeSingle` reports zero rows as `data: null`
  // with no error, so an error here means the query itself failed — reporting that as a 404
  // would send the caller hunting for a deleted event during what is actually a DB outage.
  if (eventError) {
    console.error('notify-new-session: event lookup failed', eventError)
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
  }

  const decision = authorizeNewSessionNotification(
    (eventRow ?? null) as NotifiableSession | null,
    user.id
  )
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status })
  }
  const session = decision.event

  // Only after authorization: the venue name and the recipient list.
  const [{ data: location }, { data: profiles }] = await Promise.all([
    supabase.from('locations').select('name').eq('id', session.location_id).maybeSingle(),
    supabase
      .from('profiles')
      .select('id, email')
      .eq('notify_new_sessions', true)
      .neq('id', user.id)
      .not('email', 'is', null),
  ])

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const eventUrl = `${getSiteUrl()}/play/${session.id}`

  // Send in batches to stay within Resend limits
  const emails = profiles
    .filter((p) => p.email)
    .map((p) => {
      // Signed + canonical-host. The bare `?uid=` form this replaced let anyone holding a
      // profile id opt that user out.
      const unsubscribeUrl = buildUnsubscribeUrl(p.id as string)
      return {
        from: 'Joinzer <support@joinzer.com>',
        to: p.email as string,
        replyTo: 'martyfit50@gmail.com',
        // Plain text, not HTML — escaping the subject would render literal entities in the
        // inbox list. The HTML body is where the escaping has to happen.
        subject: `New session: ${session.title}`,
        html: withBrandHeader(
          buildNewSessionEmailHtml({
            title: session.title,
            locationName: location?.name ?? '',
            startsAt: session.starts_at,
            durationMinutes: session.duration_minutes,
            maxPlayers: session.max_players,
            eventUrl,
            unsubscribeUrl,
          })
        ),
      }
    })

  // Constructed here rather than at the top of the handler so an unauthorized request never
  // reaches the Resend client at all.
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.batch.send(emails)

  if (error) {
    console.error('Resend batch error:', error)
    return NextResponse.json({ error: 'Failed to send notifications' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent: emails.length })
}
