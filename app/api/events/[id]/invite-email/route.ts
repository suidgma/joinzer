import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { getSiteUrl } from '@/lib/utils/site-url'

// POST /api/events/[id]/invite-email — invite someone who isn't in the directory
// by email. Sends a link to the session; they sign up / log in and join. Captain
// (or creator) only. Body: { email }.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: event } = await supabase
    .from('events')
    .select('id, title, starts_at, captain_user_id, creator_user_id, captain:profiles!captain_user_id(name)')
    .eq('id', id)
    .single()
  if (!event) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (event.captain_user_id !== user.id && event.creator_user_id !== user.id) {
    return NextResponse.json({ error: 'Only the captain can invite players' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const url = `${getSiteUrl()}/play/${id}`
  const dateStr = new Date(event.starts_at).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric',
  })
  const captainName = (event.captain as unknown as { name?: string } | null)?.name ?? 'A captain'

  await sendEmail({
    to: email,
    subject: `You're invited: ${event.title}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1F2A1C">
        <p style="font-size:15px;margin:0 0 12px">${captainName} invited you to a pickleball session on Joinzer.</p>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:0 0 16px">
          <p style="font-size:16px;font-weight:600;margin:0 0 4px">${event.title}</p>
          <p style="color:#6b7280;font-size:14px;margin:0">${dateStr}</p>
        </div>
        <p style="margin:0 0 16px">
          <a href="${url}" style="display:inline-block;background:#8FC919;color:#012D0B;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600">View &amp; join</a>
        </p>
        <p style="color:#9ca3af;font-size:12px;margin:0">New to Joinzer? Sign up with this email address to join the session.</p>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}
