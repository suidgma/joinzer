import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const cookieStorePromise = await cookies()

  // Verify the caller is an authenticated user
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() { return (await cookieStorePromise).getAll() },
        async setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          const cookieStore = await cookieStorePromise
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use service role only for reading all opted-in profiles
  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { title, locationName, startsAt, durationMinutes, maxPlayers, eventId, creatorId } =
    await request.json()

  // Fetch all opted-in users except the creator
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, name')
    .eq('notify_new_sessions', true)
    .neq('id', creatorId)
    .not('email', 'is', null)

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const date = new Date(startsAt).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const time = new Date(startsAt).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit',
  })
  const hours = Math.floor(durationMinutes / 60)
  const mins = durationMinutes % 60
  const duration = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  const eventUrl = `https://joinzer.com/events/${eventId}`

  // Send in batches to stay within Resend limits
  const emails = profiles
    .filter((p) => p.email)
    .map((p) => {
      const unsubscribeUrl = `https://joinzer.com/api/unsubscribe?uid=${p.id}`
      return {
        from: 'Joinzer <support@joinzer.com>',
        to: p.email as string,
        replyTo: 'martyfit50@gmail.com',
        subject: `New session: ${title}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">New session posted!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <h2 style="margin:0 0 16px;font-size:18px">${title}</h2>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📍 Location</td><td style="padding:6px 0;font-size:14px">${locationName}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">📅 Date</td><td style="padding:6px 0;font-size:14px">${date}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">🕐 Time</td><td style="padding:6px 0;font-size:14px">${time}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">⏱ Duration</td><td style="padding:6px 0;font-size:14px">${duration}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">👥 Capacity</td><td style="padding:6px 0;font-size:14px">${maxPlayers} players</td></tr>
              </table>
              <div style="margin-top:24px">
                <a href="${eventUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Session</a>
              </div>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">
                You're receiving this because you opted in to new session notifications on Joinzer.
                <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe</a>
              </p>
            </div>
          </div>
        `,
      }
    })

  const { error } = await resend.batch.send(emails)

  if (error) {
    console.error('Resend batch error:', error)
    return NextResponse.json({ error: 'Failed to send notifications' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent: emails.length })
}
