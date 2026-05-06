import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

type Params = { params: { sessionId: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Verify caller is the league organizer
  const { data: session } = await db
    .from('league_sessions')
    .select('id, session_number, session_date, league_id')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: league } = await db
    .from('leagues')
    .select('id, name, location_name, created_by')
    .eq('id', session.league_id)
    .single()
  if (!league || league.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch all registered players with emails
  const { data: registrations } = await db
    .from('league_registrations')
    .select('user_id, profile:profiles(id, name, email)')
    .eq('league_id', session.league_id)
    .eq('status', 'registered')

  const recipients = (registrations ?? [])
    .map((r) => r.profile as unknown as { id: string; name: string; email: string | null } | null)
    .filter((p): p is { id: string; name: string; email: string } => !!p && !!p.email)
    .filter((p) => p.id !== user.id) // Don't send to organizer

  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const dateStr = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric',
  })
  const leagueUrl = `https://joinzer.com/compete/leagues/${league.id}`

  const resend = new Resend(process.env.RESEND_API_KEY)
  const emails = recipients.map((p) => ({
    from: 'Joinzer <support@joinzer.com>',
    to: p.email,
    replyTo: 'martyfit50@gmail.com',
    subject: `Reminder: ${league.name} — Session ${session.session_number}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">Session reminder</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 16px;font-size:18px">${league.name}</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📅 Date</td><td style="padding:6px 0;font-size:14px">${dateStr}</td></tr>
            ${league.location_name ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📍 Location</td><td style="padding:6px 0;font-size:14px">${league.location_name}</td></tr>` : ''}
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🏓 Session</td><td style="padding:6px 0;font-size:14px">Session ${session.session_number}</td></tr>
          </table>
          <p style="margin:16px 0;font-size:14px;color:#374151">Please mark your attendance so your organizer knows who to expect.</p>
          <div style="margin-top:8px">
            <a href="${leagueUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Check In →</a>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this because you're registered for a league on Joinzer.</p>
        </div>
      </div>
    `,
  }))

  const { error } = await resend.batch.send(emails)
  if (error) {
    console.error('Reminder email error:', error)
    return NextResponse.json({ error: 'Failed to send reminders' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent: emails.length })
}
