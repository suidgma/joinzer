import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await request.json()

  // Cancel the requesting user's registration
  const { error: cancelErr } = await supabase
    .from('league_registrations')
    .update({ status: 'cancelled' })
    .eq('league_id', leagueId)
    .eq('user_id', user.id)

  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 })

  // Promote the oldest waitlisted player using service role (bypasses RLS)
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: nextUp } = await admin
    .from('league_registrations')
    .select('id, user_id')
    .eq('league_id', leagueId)
    .eq('status', 'waitlist')
    .order('registered_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (nextUp) {
    await admin
      .from('league_registrations')
      .update({ status: 'registered' })
      .eq('id', nextUp.id)

    // Email the promoted player
    const [{ data: league }, { data: profile }] = await Promise.all([
      admin.from('leagues').select('id, name').eq('id', leagueId).single(),
      admin.from('profiles').select('name, email').eq('id', nextUp.user_id).single(),
    ])

    if (profile?.email && league) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
      const firstName = profile.name?.split(' ')[0] ?? 'there'
      const resend = new Resend(process.env.RESEND_API_KEY)
      resend.emails.send({
        from: 'Joinzer <support@joinzer.com>',
        to: profile.email,
        replyTo: 'martyfit50@gmail.com',
        subject: `You're in! A spot opened up — ${league.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">You're off the waitlist!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 20px;font-size:15px">
                Good news, ${firstName}! A spot opened up in <strong>${league.name}</strong> and you've been automatically moved from the waitlist to registered.
              </p>
              <a href="${siteUrl}/compete/leagues/${league.id}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View League</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the court!</p>
            </div>
          </div>
        `,
      }).catch(() => {}) // non-blocking
    }
  }

  return NextResponse.json({ ok: true, promoted: !!nextUp })
}
