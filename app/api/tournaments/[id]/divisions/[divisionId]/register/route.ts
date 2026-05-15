import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { generateIcs } from '@/lib/email/ics'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; divisionId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const team_name: string | null = body.team_name ?? null
  const registration_type: 'team' | 'solo' = body.registration_type === 'solo' ? 'solo' : 'team'

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Allow organizer to register a specific player; otherwise register self
  let targetUserId = user.id
  if (body.user_id && body.user_id !== user.id) {
    const { data: tournament } = await service
      .from('tournaments')
      .select('organizer_id')
      .eq('id', params.id)
      .single()
    if (!tournament || tournament.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the organizer can add players' }, { status: 403 })
    }
    targetUserId = body.user_id
  }

  // Fetch division
  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, tournament_id, team_type, max_entries, waitlist_enabled, status, name')
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()

  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
  if (division.status === 'closed') return NextResponse.json({ error: 'Division is closed' }, { status: 400 })

  // Solo only valid for doubles divisions
  if (registration_type === 'solo' && division.team_type !== 'doubles') {
    return NextResponse.json({ error: 'Solo registration is only available for doubles divisions' }, { status: 400 })
  }

  // Block duplicate active registration
  const { data: existing } = await service
    .from('tournament_registrations')
    .select('id')
    .eq('division_id', params.divisionId)
    .eq('user_id', targetUserId)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existing) return NextResponse.json({ error: 'Player is already registered for this division' }, { status: 409 })

  // Count team slots used:
  //   team registrations = 1 slot each
  //   matched solo pairs = 1 slot per pair (floor(solo_count / 2))
  //   unmatched solos don't consume a slot — they wait for a partner
  const { data: regCounts } = await service
    .from('tournament_registrations')
    .select('registration_type, partner_registration_id')
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')

  const teamRegs = (regCounts ?? []).filter(r => r.registration_type === 'team').length
  const soloRegs = (regCounts ?? []).filter(r => r.registration_type === 'solo').length
  const matchedSolos = (regCounts ?? []).filter(r => r.registration_type === 'solo' && r.partner_registration_id).length
  const unmatchedSolos = soloRegs - matchedSolos
  const effectiveTeams = teamRegs + Math.floor(soloRegs / 2)
  const isFull = effectiveTeams >= division.max_entries

  if (registration_type === 'team') {
    if (isFull && !division.waitlist_enabled) {
      return NextResponse.json({ error: 'Division is full and has no waitlist' }, { status: 400 })
    }
  } else {
    // Solo: can register if there's room for another team (unmatched solos don't block until matched)
    // After this solo: new effective = teamRegs + floor((soloRegs + 1) / 2)
    const newEffective = teamRegs + Math.floor((soloRegs + 1) / 2)
    if (newEffective > division.max_entries && !division.waitlist_enabled) {
      return NextResponse.json({ error: 'Division is full — no room for another solo player' }, { status: 400 })
    }
  }

  const status = isFull && division.waitlist_enabled ? 'waitlisted' : 'registered'

  const { data: registration, error: insertErr } = await service
    .from('tournament_registrations')
    .insert({
      tournament_id: params.id,
      division_id: params.divisionId,
      user_id: targetUserId,
      team_name: registration_type === 'team' ? (team_name || null) : null,
      status,
      registration_type,
    })
    .select('id, user_id, partner_user_id, partner_registration_id, team_name, status, payment_status, registration_type')
    .single()

  if (insertErr || !registration) {
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Auto-match solo players
  let matchedWith: { userId: string; name: string; email: string | null } | null = null

  if (registration_type === 'solo' && status === 'registered' && unmatchedSolos > 0) {
    // Find the oldest unmatched solo in this division (not the current user)
    const { data: soloPartner } = await service
      .from('tournament_registrations')
      .select('id, user_id')
      .eq('division_id', params.divisionId)
      .eq('status', 'registered')
      .eq('registration_type', 'solo')
      .is('partner_registration_id', null)
      .neq('user_id', targetUserId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (soloPartner) {
      // Link both registrations to each other
      await Promise.all([
        service.from('tournament_registrations').update({
          partner_user_id: soloPartner.user_id,
          partner_registration_id: soloPartner.id,
        }).eq('id', registration.id),
        service.from('tournament_registrations').update({
          partner_user_id: targetUserId,
          partner_registration_id: registration.id,
        }).eq('id', soloPartner.id),
      ])

      // Fetch both profiles for notification emails
      const { data: profiles } = await service
        .from('profiles')
        .select('id, name, email')
        .in('id', [targetUserId, soloPartner.user_id])

      const myProfile = profiles?.find(p => p.id === targetUserId)
      const partnerProfile = profiles?.find(p => p.id === soloPartner.user_id)

      matchedWith = partnerProfile ? {
        userId: partnerProfile.id,
        name: partnerProfile.name ?? 'Your partner',
        email: partnerProfile.email ?? null,
      } : null

      // Send match notification emails (fire-and-forget)
      if (myProfile && partnerProfile) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
        const tournamentUrl = `${siteUrl}/tournaments/${params.id}`

        const emailHtml = (recipientName: string, partnerName: string) => `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">You've been matched with a partner! 🎉</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 16px;font-size:15px">Hi ${recipientName.split(' ')[0]},</p>
              <p style="margin:0 0 16px;font-size:14px;color:#374151">
                Great news — you've been automatically matched with <strong>${partnerName}</strong> as your doubles partner for this tournament!
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#374151">
                We recommend reaching out to introduce yourselves and coordinate before the tournament.
              </p>
              <a href="${tournamentUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Tournament</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">You're receiving this because you registered as a solo player on Joinzer.</p>
            </div>
          </div>
        `

        const emails = []
        if (myProfile.email) {
          emails.push({
            from: 'Joinzer <support@joinzer.com>',
            to: myProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Partner match confirmed — ${partnerProfile.name}`,
            html: emailHtml(myProfile.name ?? '', partnerProfile.name ?? ''),
          })
        }
        if (partnerProfile.email) {
          emails.push({
            from: 'Joinzer <support@joinzer.com>',
            to: partnerProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Partner match confirmed — ${myProfile.name}`,
            html: emailHtml(partnerProfile.name ?? '', myProfile.name ?? ''),
          })
        }
        if (emails.length > 0) {
          resend.emails.send(emails[0]).catch(() => {})
          if (emails[1]) resend.emails.send(emails[1]).catch(() => {})
        }
      }
    }
  }

  // Confirmation email for the registering player (fire-and-forget)
  ;(async () => {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
      const tournamentUrl = `${siteUrl}/tournaments/${params.id}`

      const [{ data: tournament }, { data: profile }] = await Promise.all([
        service.from('tournaments').select('name, start_date, location_id').eq('id', params.id).single(),
        service.from('profiles').select('name, email').eq('id', targetUserId).single(),
      ])

      if (!profile?.email || !tournament) return

      const locationResult = tournament.location_id
        ? await service.from('locations').select('name').eq('id', tournament.location_id).single()
        : { data: null }
      const locationName = locationResult.data?.name ?? null

      const isWaitlist = registration.status === 'waitlisted'
      const isSolo = registration_type === 'solo'
      const firstName = profile.name?.split(' ')[0] ?? 'there'

      const rows: EmailRow[] = [
        ['Tournament', tournament.name],
        ...(locationName ? [['Location', locationName] as EmailRow] : []),
        ...(division.name ? [['Division', division.name] as EmailRow] : []),
        ...(registration.team_name ? [['Team', registration.team_name] as EmailRow] : []),
        ...(matchedWith?.name
          ? [['Partner', matchedWith.name] as EmailRow]
          : isSolo && !matchedWith
            ? [['Type', 'Solo — awaiting a partner match'] as EmailRow]
            : []),
        ['Status', isWaitlist ? "Waitlisted — you'll be notified if a spot opens" : 'Registered'],
        ['Fee', 'Free'],
      ]

      // ICS: single all-day event on tournament start_date; timed start_time deferred
      const attachments = !isWaitlist && tournament.start_date ? [{
        filename: 'joinzer-tournament.ics',
        content: Buffer.from(generateIcs([{
          uid: params.id,
          title: tournament.name,
          startDate: tournament.start_date,
          ...(locationName ? { location: locationName } : {}),
          url: tournamentUrl,
        }])),
      }] : []

      await resend.emails.send({
        from: 'Joinzer <support@joinzer.com>',
        to: profile.email,
        replyTo: 'martyfit50@gmail.com',
        subject: isWaitlist ? `Waitlist confirmed: ${tournament.name}` : `Registered: ${tournament.name}`,
        html: registrationEmail({
          heading: isWaitlist ? "You're on the waitlist!" : "You're registered!",
          firstName,
          rows,
          ctaLabel: 'View Tournament',
          ctaUrl: tournamentUrl,
          footerNote: "You're receiving this because you registered for a tournament on Joinzer.",
        }),
        ...(attachments.length > 0 ? { attachments } : {}),
      })
    } catch (err) {
      console.error('Tournament confirmation email error:', err)
    }
  })()

  return NextResponse.json({ registration, matchedWith })
}
