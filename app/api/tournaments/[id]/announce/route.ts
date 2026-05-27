import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canManageTournament } from '@/lib/tournament/access'

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: tournament } = await db
    .from('tournaments')
    .select('id, name, organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  const allowed = await canManageTournament(db, params.id, user.id)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { subject, body, division_ids } = await request.json() as {
    subject?: string; body?: string; division_ids?: string[]
  }
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  // Get registered player user_ids, optionally filtered by division
  let regQuery = db
    .from('tournament_registrations')
    .select('user_id, partner_user_id, division_id')
    .eq('tournament_id', params.id)
    .eq('status', 'registered')

  if (Array.isArray(division_ids) && division_ids.length > 0) {
    regQuery = regQuery.in('division_id', division_ids)
  }

  const { data: regs } = await regQuery

  if (!regs || regs.length === 0) {
    return NextResponse.json({ error: 'No registered players to email' }, { status: 400 })
  }

  const userIds = Array.from(new Set(
    regs.flatMap(r => [r.user_id, r.partner_user_id]).filter((id): id is string => !!id)
  ))

  // Fetch emails in parallel (was N+1 sequential — slow at 80+ players)
  const results = await Promise.all(
    userIds.map(uid => db.auth.admin.getUserById(uid).then(r => r.data?.user?.email ?? null))
  )
  const emails = results.filter((e): e is string => !!e)
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
