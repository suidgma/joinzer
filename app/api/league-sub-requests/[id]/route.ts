import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { Resend } from 'resend'

type Params = { params: { id: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH — claim | approve | cancel
// Body: { action: 'claim' | 'approve' | 'cancel' }
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json().catch(() => ({ action: null }))
  if (!['claim', 'approve', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'action must be claim, approve, or cancel' }, { status: 400 })
  }

  const db = admin()

  // Fetch the sub request + league to check permissions
  const { data: sr } = await db
    .from('league_sub_requests')
    .select(`
      id, status, requesting_player_id, claimed_by_user_id, league_id,
      league:leagues!league_id(name, created_by),
      session:league_sessions!league_session_id(session_date, session_number)
    `)
    .eq('id', params.id)
    .single()

  if (!sr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const league = sr.league as unknown as { name: string; created_by: string } | null
  const isOrganizer = league?.created_by === user.id
  const isRequester = sr.requesting_player_id === user.id

  let update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (action === 'claim') {
    if (sr.status !== 'open') return NextResponse.json({ error: 'Sub request is no longer open' }, { status: 409 })
    if (isRequester) return NextResponse.json({ error: 'You cannot claim your own sub request' }, { status: 400 })
    update = { ...update, status: 'claimed', claimed_by_user_id: user.id }
  }

  if (action === 'approve') {
    if (!isOrganizer) return NextResponse.json({ error: 'Only the organizer can approve sub requests' }, { status: 403 })
    if (!['claimed', 'open'].includes(sr.status)) {
      return NextResponse.json({ error: 'Sub request cannot be approved in its current state' }, { status: 409 })
    }
    update = { ...update, status: 'approved', approved_by_user_id: user.id }
  }

  if (action === 'cancel') {
    if (!isRequester && !isOrganizer) {
      return NextResponse.json({ error: 'Only the requester or organizer can cancel' }, { status: 403 })
    }
    if (!['open', 'claimed'].includes(sr.status)) {
      return NextResponse.json({ error: 'Sub request cannot be cancelled' }, { status: 409 })
    }
    update = { ...update, status: 'cancelled' }
  }

  const { data: updated, error } = await db
    .from('league_sub_requests')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Send notifications (fire-and-forget)
  sendClaimNotification(sr, updated, action, user.id).catch(console.error)

  return NextResponse.json(updated)
}

async function sendClaimNotification(
  sr: Record<string, unknown>,
  updated: Record<string, unknown>,
  action: string,
  actorId: string
) {
  const db = admin()
  const resend = new Resend(process.env.RESEND_API_KEY)
  const league = sr.league as { name: string; created_by: string }
  const session = sr.session as { session_date: string; session_number: number }

  const dateStr = session
    ? new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })
    : ''

  const leagueUrl = `https://joinzer.com/compete/leagues/${sr.league_id}`

  if (action === 'claim') {
    // Notify requester + organizer
    const [{ data: requester }, { data: claimer }, { data: organizer }] = await Promise.all([
      db.from('profiles').select('email, name').eq('id', sr.requesting_player_id as string).single(),
      db.from('profiles').select('name').eq('id', actorId).single(),
      db.from('profiles').select('email').eq('id', league.created_by).single(),
    ])

    const claimerName = claimer?.name ?? 'Someone'
    const emails = []

    if (requester?.email) {
      emails.push({
        from: 'Joinzer <support@joinzer.com>', to: requester.email, replyTo: 'martyfit50@gmail.com',
        subject: `Sub claimed: ${league.name} Session ${session.session_number}`,
        html: emailHtml(`${claimerName} can sub for you!`,
          `${claimerName} has volunteered to sub for you in <strong>${league.name}</strong>${dateStr ? ` on ${dateStr}` : ''}. Your organizer will confirm.`,
          leagueUrl, 'View League'),
      })
    }
    if (organizer?.email) {
      emails.push({
        from: 'Joinzer <support@joinzer.com>', to: organizer.email, replyTo: 'martyfit50@gmail.com',
        subject: `Sub volunteer: ${league.name}`,
        html: emailHtml('Sub volunteer',
          `${claimerName} has volunteered to sub in <strong>${league.name}</strong>${dateStr ? ` on ${dateStr}` : ''}. Approve them in the roster.`,
          `${leagueUrl}/roster`, 'View Roster'),
      })
    }
    if (emails.length) await resend.batch.send(emails).catch(console.error)
  }

  if (action === 'approve') {
    const [{ data: claimer }, { data: requester }] = await Promise.all([
      updated.claimed_by_user_id
        ? db.from('profiles').select('email, name').eq('id', updated.claimed_by_user_id as string).single()
        : Promise.resolve({ data: null }),
      db.from('profiles').select('email, name').eq('id', sr.requesting_player_id as string).single(),
    ])

    const emails = []
    if (claimer?.email) {
      emails.push({
        from: 'Joinzer <support@joinzer.com>', to: claimer.email, replyTo: 'martyfit50@gmail.com',
        subject: `You're approved to sub: ${league.name}`,
        html: emailHtml("You're approved!", `Your sub spot in <strong>${league.name}</strong>${dateStr ? ` on ${dateStr}` : ''} has been confirmed by the organizer.`, leagueUrl, 'View League'),
      })
    }
    if (requester?.email) {
      emails.push({
        from: 'Joinzer <support@joinzer.com>', to: requester.email, replyTo: 'martyfit50@gmail.com',
        subject: `Sub confirmed: ${league.name}`,
        html: emailHtml('Sub confirmed', `Your sub has been approved for <strong>${league.name}</strong>${dateStr ? ` on ${dateStr}` : ''}. You're all set!`, leagueUrl, 'View League'),
      })
    }
    if (emails.length) await resend.batch.send(emails).catch(console.error)
  }
}

function emailHtml(heading: string, body: string, ctaUrl: string, ctaLabel: string) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
      <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;font-size:20px;color:#012D0B">${heading}</h1>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="margin:0 0 24px;font-size:14px;color:#374151">${body}</p>
        <a href="${ctaUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${ctaLabel}</a>
        <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this from Joinzer.</p>
      </div>
    </div>
  `
}
