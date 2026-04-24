import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { invitedUserId, eventId } = await request.json()

  // Fetch inviter's profile
  const { data: inviter } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single()

  // Fetch invited player's profile + email
  const { data: invited } = await supabase
    .from('profiles')
    .select('name, email')
    .eq('id', invitedUserId)
    .single()

  // Fetch session details
  const { data: event } = await supabase
    .from('events')
    .select('id, title, starts_at, duration_minutes, max_players, location:locations!location_id(name)')
    .eq('id', eventId)
    .single()

  if (!invited?.email || !event || !inviter) {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 })
  }

  const eventUrl = `https://joinzer.com/events/${event.id}`
  const date = new Date(event.starts_at).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'long', day: 'numeric',
  })
  const time = new Date(event.starts_at).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit',
  })
  const locationName = (event.location as unknown as { name: string } | null)?.name ?? 'TBD'

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: invited.email,
    replyTo: 'martyfit50@gmail.com',
    subject: `${inviter.name} wants you to join their session`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">You've been invited to play!</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 20px;font-size:15px">
            Hey ${invited.name.split(' ')[0]}, <strong>${inviter.name}</strong> saw you're available and wants you to join their pickleball session.
          </p>
          <h2 style="margin:0 0 16px;font-size:18px">${event.title}</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📍 Location</td><td style="padding:6px 0;font-size:14px">${locationName}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📅 Date</td><td style="padding:6px 0;font-size:14px">${date}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🕐 Time</td><td style="padding:6px 0;font-size:14px">${time}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">👥 Capacity</td><td style="padding:6px 0;font-size:14px">${event.max_players} players</td></tr>
          </table>
          <div style="margin-top:24px">
            <a href="${eventUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Session</a>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af">
            You're receiving this because another Joinzer player invited you. Log in to join the session.
          </p>
        </div>
      </div>
    `,
  })

  if (error) {
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
