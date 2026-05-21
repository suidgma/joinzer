import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { generateIcs } from '@/lib/email/ics'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { icsFilename } from '@/lib/utils/slug'

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
  const discount_code: string | null = body.discount_code?.trim() || null

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

  // ── Doubles team add (organiser-only) ────────────────────────────────
  if (body.partner_user_id) {
    // Require organiser regardless of whether P1 is self
    if (targetUserId === user.id) {
      const { data: tourn } = await service
        .from('tournaments')
        .select('organizer_id')
        .eq('id', params.id)
        .single()
      if (!tourn || tourn.organizer_id !== user.id) {
        return NextResponse.json({ error: 'Only the organizer can add a doubles team' }, { status: 403 })
      }
    }

    const p2UserId: string = body.partner_user_id
    const { data: rpcResult, error: rpcError } = await service.rpc('register_doubles_pair', {
      p_tournament_id: params.id,
      p_division_id: params.divisionId,
      p_player1_id: targetUserId,
      p_player2_id: p2UserId,
      p_team_name: team_name ?? null,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ''
      const knownCodes = [
        'division_not_found', 'division_closed', 'not_doubles_format',
        'already_registered', 'gender_mismatch', 'division_full',
      ]
      const code = knownCodes.find(c => msg.includes(c)) ?? 'registration_failed'
      const httpStatus = code === 'division_not_found' ? 404 : code === 'registration_failed' ? 500 : 400
      return NextResponse.json({ error: code }, { status: httpStatus })
    }

    const { reg1_id, reg2_id } = rpcResult as { reg1_id: string; reg2_id: string; status: string }
    const { data: regs } = await service
      .from('tournament_registrations')
      .select('id, user_id, partner_user_id, partner_registration_id, team_name, status, payment_status, registration_type')
      .in('id', [reg1_id, reg2_id])

    const reg1 = regs?.find(r => r.id === reg1_id) ?? null
    const reg2 = regs?.find(r => r.id === reg2_id) ?? null
    return NextResponse.json({ reg1, reg2 })
  }

  // Fetch division
  const { data: division } = await service
    .from('tournament_divisions')
    .select('id, tournament_id, format, max_entries, waitlist_enabled, status, name, cost_cents')
    .eq('id', params.divisionId)
    .eq('tournament_id', params.id)
    .single()

  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 })
  if (division.status === 'closed') return NextResponse.json({ error: 'Division is closed' }, { status: 400 })

  // Solo only valid for doubles divisions
  if (registration_type === 'solo' && !isDoublesFormat(division.format)) {
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

  // Hard deadline for player self-registration; organizer manual adds bypass this.
  // Also capture fields needed for Stripe Connect check on paid solo path.
  let tournamentForPay: { name: string; organizer_id: string; start_date: string | null; location_id: string | null } | null = null
  if (targetUserId === user.id) {
    const { data: tEntry } = await service
      .from('tournaments')
      .select('name, organizer_id, start_date, location_id, registration_closes_at')
      .eq('id', params.id)
      .single()
    if (tEntry?.registration_closes_at && new Date() > new Date(tEntry.registration_closes_at)) {
      return NextResponse.json({ error: 'Registration is closed' }, { status: 400 })
    }
    if (tEntry) {
      tournamentForPay = {
        name: tEntry.name,
        organizer_id: tEntry.organizer_id,
        start_date: (tEntry as any).start_date ?? null,
        location_id: (tEntry as any).location_id ?? null,
      }
    }
  }

  // Count team slots used:
  //   team registrations = 1 slot each
  //   matched solo pairs = 1 slot per pair (floor(solo_count / 2))
  //   unmatched solos don't consume a slot — they wait for a partner
  const { data: regCounts } = await service
    .from('tournament_registrations')
    .select('registration_type, partner_registration_id')
    .eq('division_id', params.divisionId)
    .eq('status', 'registered')
    .in('payment_status', ['paid', 'waived'])

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
  const isOrganizerAdd = targetUserId !== user.id

  // ── B7.3: Solo self-service paid registration → Stripe Checkout (no INSERT yet) ──
  // Team registrations stay Pattern A (INSERT-then-pay) to preserve the partner-invite flow.
  // Waitlisted solos INSERT immediately regardless of cost — no point charging for a queued spot.
  if (!isOrganizerAdd && registration_type === 'solo' && status === 'registered') {
    const costCents: number | null = (division as any).cost_cents ?? null

    if (costCents === null) {
      return NextResponse.json({ error: 'Division registration fee is not configured' }, { status: 400 })
    }

    if (costCents > 0) {
      if (!tournamentForPay) {
        return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
      }

      const { data: organizerProfile } = await service
        .from('profiles')
        .select('stripe_connect_account_id, stripe_charges_enabled')
        .eq('id', tournamentForPay.organizer_id)
        .single()
      const connectAccountId = (organizerProfile as any)?.stripe_charges_enabled
        ? (organizerProfile as any)?.stripe_connect_account_id
        : null

      let unitAmount = costCents
      let discountCodeId: string | null = null
      if (discount_code) {
        const { data: codeRow } = await service
          .from('tournament_discount_codes')
          .select('id, discount_type, discount_value, max_uses, uses_count, expires_at, is_active')
          .eq('tournament_id', params.id)
          .eq('code', discount_code.toUpperCase())
          .eq('is_active', true)
          .maybeSingle()
        if (codeRow) {
          const now = new Date().toISOString()
          const expired = codeRow.expires_at && codeRow.expires_at < now
          const exhausted = codeRow.max_uses != null && codeRow.uses_count >= codeRow.max_uses
          if (!expired && !exhausted) {
            discountCodeId = codeRow.id
            if (codeRow.discount_type === 'percent') {
              unitAmount = Math.round(costCents * (1 - codeRow.discount_value / 100))
            } else {
              unitAmount = Math.max(0, costCents - codeRow.discount_value)
            }
          }
        }
      }

      if (unitAmount > 0) {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
        const label = `${tournamentForPay.name} — ${division.name ?? 'Entry Fee'}`
        const applicationFeeAmount = connectAccountId ? Math.round(unitAmount * 0.05) : undefined

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              unit_amount: unitAmount,
              product_data: { name: discountCodeId ? `${label} (discount applied)` : label },
            },
            quantity: 1,
          }],
          ...(connectAccountId ? {
            payment_intent_data: {
              application_fee_amount: applicationFeeAmount,
              transfer_data: { destination: connectAccountId },
            },
          } : {}),
          metadata: {
            event_type: 'tournament_solo',
            tournament_id: params.id,
            division_id: params.divisionId,
            user_id: user.id,
            registration_type,
            team_name: team_name ?? '',
            discount_code_id: discountCodeId ?? '',
          },
          success_url: `${siteUrl}/tournaments/${params.id}?payment=success`,
          cancel_url: `${siteUrl}/tournaments/${params.id}?payment=cancelled`,
        })

        return NextResponse.json({ url: session.url })
      }

      // Discount brought cost to 0 — fall through to free INSERT
      if (discountCodeId) {
        await service.rpc('increment_discount_uses', { code_id: discountCodeId })
      }
    }
    // cost_cents === 0 or discounted to 0: fall through to INSERT with waived
  }

  // If we reach here for a self-registered solo registered slot, it's free (cost 0 or discounted).
  // Waive payment so the pay button doesn't appear.
  const insertPaymentStatus: 'waived' | undefined = (
    !isOrganizerAdd && registration_type === 'solo' && status === 'registered'
  ) ? 'waived' : undefined

  const { data: registration, error: insertErr } = await service
    .from('tournament_registrations')
    .insert({
      tournament_id: params.id,
      division_id: params.divisionId,
      user_id: targetUserId,
      team_name: registration_type === 'team' ? (team_name || null) : null,
      status,
      registration_type,
      ...(insertPaymentStatus ? { payment_status: insertPaymentStatus } : {}),
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
        service.from('tournaments').select('name, start_date, location_id, cost_cents').eq('id', params.id).single(),
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

      const effectiveCostCents = (division as any).cost_cents != null
        ? (division as any).cost_cents
        : ((tournament as any).cost_cents ?? 0)

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
        ...(!isWaitlist ? [['Fee', effectiveCostCents > 0 ? `$${(effectiveCostCents / 100).toFixed(2)} — payment required` : 'Free'] as EmailRow] : []),
      ]

      // ICS: single all-day event on tournament start_date; timed start_time deferred
      const attachments = !isWaitlist && tournament.start_date ? [{
        filename: icsFilename(tournament.name, 'tournament'),
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
