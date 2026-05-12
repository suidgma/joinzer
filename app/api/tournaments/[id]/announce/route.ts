import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Verify caller is the organizer
  const { data: tournament } = await db
    .from('tournaments')
    .select('id, name, organizer_id')
    .eq('id', params.id)
    .single()

  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { subject, body } = await request.json()
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  // Get all registered player user_ids
  const { data: regs } = await db
    .from('tournament_registrations')
    .select('user_id')
    .eq('tournament_id', params.id)
    .eq('status', 'registered')

  if (!regs || regs.length === 0) {
    return NextResponse.json({ error: 'No registered players to email' }, { status: 400 })
  }

  const userIds = Array.from(new Set(regs.map(r => r.user_id).filter(Boolean)))

  // Fetch emails from auth.users via admin API
  const emailMap: Record<string, string> = {}
  for (const uid of userIds) {
    const { data } = await db.auth.admin.getUserById(uid)
    if (data?.user?.email) emailMap[uid] = data.user.email
  }

  const emails = Object.values(emailMap).filter(Boolean)
  if (emails.length === 0) {
    return NextResponse.json({ error: 'Could not resolve any player emails' }, { status: 500 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const tournamentUrl = `https://joinzer.com/tournaments/${params.id}`

  const { error } = await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: emails,
    subject: `[${tournament.name}] ${subject.trim()}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:18px;color:#012D0B">${tournament.name}</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <div style="white-space:pre-wrap;font-size:15px;line-height:1.6;color:#1F2A1C">${body.trim()}</div>
          <div style="margin-top:28px">
            <a href="${tournamentUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View Tournament</a>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#9ca3af">You received this because you are registered for ${tournament.name} on Joinzer.</p>
        </div>
      </div>
    `,
  })

  if (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent: emails.length })
}
