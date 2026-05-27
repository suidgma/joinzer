import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { registration_id, partner_email } = body

  if (!registration_id || !partner_email) {
    return NextResponse.json({ error: 'registration_id and partner_email are required' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify the registration belongs to the caller
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, tournament_id, division_id')
    .eq('id', registration_id)
    .eq('division_id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()

  if (!reg || reg.user_id !== user.id) {
    return NextResponse.json({ error: 'Registration not found or not yours' }, { status: 403 })
  }

  // Cancel any existing pending invitation for this registration
  await service
    .from('tournament_team_invitations')
    .update({ status: 'expired' })
    .eq('inviter_registration_id', registration_id)
    .eq('status', 'pending')

  // Look up if invitee already has an account
  const { data: inviteeProfile } = await service
    .from('profiles')
    .select('id, name')
    .ilike('email', partner_email.trim())
    .maybeSingle()

  // Create invitation record
  const { data: invitation, error: invErr } = await service
    .from('tournament_team_invitations')
    .insert({
      tournament_id: params.id,
      division_id: params.divisionId,
      inviter_registration_id: registration_id,
      invitee_email: partner_email.trim().toLowerCase(),
      invitee_user_id: inviteeProfile?.id ?? null,
    })
    .select('id, token')
    .single()

  if (invErr || !invitation) {
    return NextResponse.json({ error: invErr?.message ?? 'Failed to create invitation' }, { status: 500 })
  }

  // Fetch context for email
  const [{ data: inviterProfile }, { data: tournament }, { data: division }] = await Promise.all([
    service.from('profiles').select('name').eq('id', user.id).single(),
    service.from('tournaments').select('name, start_date').eq('id', params.id).single(),
    service.from('tournament_divisions').select('name').eq('id', params.divisionId).single(),
  ])

  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'}/tournaments/invite/${invitation.token}`
  const inviterName = inviterProfile?.name ?? 'A player'
  const tournamentName = tournament?.name ?? 'a tournament'
  const divisionName = division?.name ?? 'a division'

  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'Joinzer <support@joinzer.com>',
    to: partner_email.trim(),
    replyTo: 'martyfit50@gmail.com',
    subject: `${inviterName} wants you as their partner`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
        <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;font-size:20px;color:#012D0B">Partner Invitation</h1>
        </div>
        <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 20px;font-size:15px">
            <strong>${inviterName}</strong> has invited you to be their partner in:
          </p>
          <h2 style="margin:0 0 4px;font-size:18px">${tournamentName}</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280">${divisionName}</p>
          <p style="margin:0 0 24px;font-size:14px">
            Accept to confirm your spot as their doubles partner. You'll need to create a Joinzer account if you don't have one.
          </p>
          <div style="display:flex;gap:12px;margin-bottom:24px">
            <a href="${acceptUrl}?action=accept" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Accept Invitation</a>
            <a href="${acceptUrl}?action=decline" style="background:#f3f4f6;color:#374151;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;margin-left:8px">Decline</a>
          </div>
          <p style="margin:0;font-size:12px;color:#9ca3af">
            This invitation expires after 7 days. If you don't know ${inviterName}, you can safely ignore this email.
          </p>
        </div>
      </div>
    `,
  })

  return NextResponse.json({ ok: true, invitation_id: invitation.id })
}
