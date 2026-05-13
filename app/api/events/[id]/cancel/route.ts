import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify captain
  const { data: event } = await admin
    .from('events')
    .select('id, title, starts_at, status, captain_user_id, location:locations!location_id(name)')
    .eq('id', params.id)
    .single()

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  if (event.captain_user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (event.status === 'cancelled') return NextResponse.json({ ok: true }) // already cancelled

  // Cancel the event
  const { error: updateErr } = await admin
    .from('events')
    .update({ status: 'cancelled' })
    .eq('id', params.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Fetch all joined participants with emails (exclude the captain themselves)
  const { data: participants } = await admin
    .from('event_participants')
    .select('user_id, profile:profiles!user_id(name, email)')
    .eq('event_id', params.id)
    .eq('participant_status', 'joined')
    .neq('user_id', user.id)

  if (!participants || participants.length === 0) {
    return NextResponse.json({ ok: true })
  }

  const startsAt = new Date(event.starts_at)
  const date = startsAt.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const time = startsAt.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit',
  })
  const loc = (event as any).location
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'

  const emails = participants
    .map((p) => {
      const profile = (p.profile as unknown) as { name: string; email: string | null } | null
      if (!profile?.email) return null
      const firstName = profile.name?.split(' ')[0] ?? 'there'
      return {
        from: 'Joinzer <support@joinzer.com>',
        to: profile.email,
        replyTo: 'martyfit50@gmail.com',
        subject: `Cancelled: ${event.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#ef4444;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#ffffff">Session Cancelled</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 20px;font-size:15px">
                Hey ${firstName}, the following session has been <strong>cancelled</strong> by the captain.
              </p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Session</td><td style="padding:6px 0;font-size:14px;font-weight:600">${event.title}</td></tr>
                ${loc ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Location</td><td style="padding:6px 0;font-size:14px">${loc.name}</td></tr>` : ''}
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Date</td><td style="padding:6px 0;font-size:14px">${date}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Time</td><td style="padding:6px 0;font-size:14px">${time}</td></tr>
              </table>
              <a href="${siteUrl}/events" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Find Another Session</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">Sorry for the inconvenience — see you on the courts soon!</p>
            </div>
          </div>
        `,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  if (emails.length > 0) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    resend.batch.send(emails).catch(() => {}) // non-blocking
  }

  return NextResponse.json({ ok: true })
}
