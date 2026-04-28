import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueName, format, skillLevel, locationName, startDate, endDate, leagueId, status } =
    await request.json()

  const leagueUrl = `https://joinzer.com/compete/leagues/${leagueId}`
  const isWaitlist = status === 'waitlist'

  const { error } = await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: user.email,
    replyTo: 'martyfit50@gmail.com',
    subject: isWaitlist ? `Waitlist confirmed: ${leagueName}` : `Registered: ${leagueName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">
            ${isWaitlist ? "You're on the waitlist!" : "You're registered!"}
          </h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 16px;font-size:18px">${leagueName}</h2>
          <table style="width:100%;border-collapse:collapse">
            ${format ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🏓 Format</td><td style="padding:6px 0;font-size:14px">${format}</td></tr>` : ''}
            ${skillLevel ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🎯 Skill Level</td><td style="padding:6px 0;font-size:14px">${skillLevel}</td></tr>` : ''}
            ${locationName ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📍 Location</td><td style="padding:6px 0;font-size:14px">${locationName}</td></tr>` : ''}
            ${startDate ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📅 Starts</td><td style="padding:6px 0;font-size:14px">${startDate}</td></tr>` : ''}
            ${endDate ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🏁 Ends</td><td style="padding:6px 0;font-size:14px">${endDate}</td></tr>` : ''}
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">✅ Status</td><td style="padding:6px 0;font-size:14px">${isWaitlist ? 'Waitlisted — you\'ll be notified if a spot opens' : 'Registered'}</td></tr>
          </table>
          <div style="margin-top:24px">
            <a href="${leagueUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View League</a>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this because you registered for a league on Joinzer.</p>
        </div>
      </div>
    `,
  })

  if (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
