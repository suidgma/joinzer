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

  // Peek at oldest waitlisted player BEFORE calling the RPC so we know who will be promoted
  const { data: nextUp } = await admin
    .from('event_participants')
    .select('user_id')
    .eq('event_id', params.id)
    .eq('participant_status', 'waitlist')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Call leave_event RPC — handles leave + promotion atomically
  const { error: rpcError } = await supabase.rpc('leave_event', { p_event_id: params.id })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }

  // If someone was on the waitlist, email them
  if (nextUp?.user_id) {
    const [{ data: event }, { data: profile }] = await Promise.all([
      admin.from('events')
        .select('id, title, starts_at, duration_minutes, location:locations!location_id(name)')
        .eq('id', params.id)
        .single(),
      admin.from('profiles')
        .select('name, email')
        .eq('id', nextUp.user_id)
        .single(),
    ])

    if (profile?.email && event) {
      const loc = (event as any).location
      const startsAt = new Date(event.starts_at)
      const date = startsAt.toLocaleDateString('en-US', {
        timeZone: 'America/Los_Angeles',
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
      const time = startsAt.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric', minute: '2-digit',
      })
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
      const firstName = profile.name?.split(' ')[0] ?? 'there'

      const resend = new Resend(process.env.RESEND_API_KEY)
      resend.emails.send({
        from: 'Joinzer <support@joinzer.com>',
        to: profile.email,
        replyTo: 'martyfit50@gmail.com',
        subject: `You're in! A spot opened up — ${event.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">You're off the waitlist!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 20px;font-size:15px">
                Good news, ${firstName}! A spot opened up and you've been automatically moved from the waitlist to <strong>joined</strong>.
              </p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Session</td><td style="padding:6px 0;font-size:14px;font-weight:600">${event.title}</td></tr>
                ${loc ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Location</td><td style="padding:6px 0;font-size:14px">${loc.name}</td></tr>` : ''}
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Date</td><td style="padding:6px 0;font-size:14px">${date}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Time</td><td style="padding:6px 0;font-size:14px">${time}</td></tr>
              </table>
              <a href="${siteUrl}/events/${event.id}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Session</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the court!</p>
            </div>
          </div>
        `,
      }).catch(() => {}) // non-blocking
    }
  }

  return NextResponse.json({ ok: true })
}
