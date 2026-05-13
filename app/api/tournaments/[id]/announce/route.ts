import { Resend } from 'resend'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: tournament } = await db
    .from('tournaments')
    .select('id, name, organizer_id, cost_cents')
    .eq('id', params.id)
    .single()

  if (!tournament || tournament.organizer_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { subject, body, filter } = await request.json()
  if (!subject?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 })
  }

  // Build query based on filter
  let query = db
    .from('tournament_registrations')
    .select('user_id, status, payment_status, division_id')
    .eq('tournament_id', params.id)

  if (filter?.type === 'division' && filter.division_id) {
    query = query.eq('division_id', filter.division_id).eq('status', 'registered')
  } else if (filter?.type === 'waitlisted') {
    query = query.eq('status', 'waitlisted')
  } else if (filter?.type === 'unpaid') {
    query = query.eq('status', 'registered')
  } else {
    // default: all registered
    query = query.eq('status', 'registered')
  }

  const { data: regs } = await query

  if (!regs || regs.length === 0) {
    return NextResponse.json({ error: 'No players match this filter' }, { status: 400 })
  }

  let filteredRegs = regs
  if (filter?.type === 'unpaid') {
    // Get division cost_cents for each registration
    const { data: divisions } = await db
      .from('tournament_divisions')
      .select('id, cost_cents')
      .eq('tournament_id', params.id)

    const divMap = new Map((divisions ?? []).map((d: any) => [d.id, d.cost_cents]))
    filteredRegs = regs.filter(r => {
      const divCost = divMap.get(r.division_id)
      const effectiveCost = divCost != null ? divCost : (tournament.cost_cents ?? 0)
      return effectiveCost > 0 && (!r.payment_status || r.payment_status === 'unpaid')
    })
    if (filteredRegs.length === 0) {
      return NextResponse.json({ error: 'No unpaid registrations found' }, { status: 400 })
    }
  }

  const userIds = Array.from(new Set(filteredRegs.map(r => r.user_id).filter(Boolean)))

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
