import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { generateIcs } from '@/lib/email/ics'
import { createInviteAndNotify, voidCaptainHold } from '@/lib/leagues/partner'
import { icsFilename } from '@/lib/utils/slug'
import { formatSkillRange } from '@/lib/taxonomy/formats'
import { createNotification } from '@/lib/notifications/create'

export const dynamic = 'force-dynamic'

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual Round Robin',
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  singles: 'Singles',
  custom: 'Custom',
}


export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const meta = session.metadata ?? {}
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null

    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'

    // ── Tournament registration ────────────────────────────────────────────────
    if (meta.registration_id) {
      await service
        .from('tournament_registrations')
        .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId })
        .eq('id', meta.registration_id)

      if (meta.partner_registration_id) {
        const { data: partnerUpdateData, error: partnerUpdateError } = await service
          .from('tournament_registrations')
          .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId })
          .eq('id', meta.partner_registration_id)
          .eq('payment_status', 'unpaid')
          .select('id')
        if (!partnerUpdateError && (!partnerUpdateData || partnerUpdateData.length === 0)) {
          console.warn('[B2] Partner UPDATE was a no-op — partner already paid', {
            partnerRegistrationId: meta.partner_registration_id,
            paymentIntentId,
          })
        }
      }

      if (meta.discount_code_id) {
        await service.rpc('increment_discount_uses', { code_id: meta.discount_code_id })
      }

      const [{ data: reg }, { data: tournament }] = await Promise.all([
        service.from('tournament_registrations')
          .select('user_id, division_id, team_name, partner_user_id')
          .eq('id', meta.registration_id)
          .single(),
        service.from('tournaments')
          .select('id, name, start_date, location_id')
          .eq('id', meta.tournament_id)
          .single(),
      ])

      // ── Option A: captain paid for partner by email — create partner's registration ──
      let optionAPartnerUserId: string | null = null
      let optionAPartnerRegId: string | null = null
      if (meta.partner_email && meta.partner_user_id && reg) {
        const { data: existingPartnerReg } = await service
          .from('tournament_registrations')
          .select('id')
          .eq('division_id', reg.division_id)
          .eq('user_id', meta.partner_user_id)
          .eq('tournament_id', meta.tournament_id)
          .neq('status', 'cancelled')
          .maybeSingle()

        if (!existingPartnerReg) {
          const { data: newPartnerReg } = await service
            .from('tournament_registrations')
            .insert({
              tournament_id: meta.tournament_id,
              division_id: reg.division_id,
              user_id: meta.partner_user_id,
              status: 'registered',
              registration_type: 'team',
              payment_status: 'paid',
              stripe_payment_intent_id: paymentIntentId,
            })
            .select('id')
            .single()

          if (newPartnerReg?.id) {
            optionAPartnerUserId = meta.partner_user_id
            optionAPartnerRegId = newPartnerReg.id
            await Promise.all([
              service.from('tournament_registrations').update({
                partner_user_id: meta.partner_user_id,
                partner_registration_id: newPartnerReg.id,
              }).eq('id', meta.registration_id),
              service.from('tournament_registrations').update({
                partner_user_id: reg.user_id,
                partner_registration_id: meta.registration_id,
              }).eq('id', newPartnerReg.id),
            ])
          }
        }
      }

      if (reg && tournament) {
        const partnerUserIdForEmail = optionAPartnerUserId ?? reg.partner_user_id ?? null
        const [{ data: profile }, { data: division }] = await Promise.all([
          service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
          service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
        ])

        const locationResult = tournament.location_id
          ? await service.from('locations').select('name').eq('id', tournament.location_id).single()
          : { data: null }
        const partnerResult = partnerUserIdForEmail
          ? await service.from('profiles').select('name, email').eq('id', partnerUserIdForEmail).single()
          : { data: null }
        const locationName = locationResult.data?.name ?? null
        const partnerName = (partnerResult.data as any)?.name ?? null

        const resend = new Resend(process.env.RESEND_API_KEY)
        const tournamentUrl = `${siteUrl}/tournaments/${tournament.id}`
        const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''

        if (profile?.email) {
          const rows: EmailRow[] = [
            ['Tournament', tournament.name],
            ...(locationName ? [['Location', locationName] as EmailRow] : []),
            ...(division?.name ? [['Division', division.name] as EmailRow] : []),
            ...(reg.team_name ? [['Team', reg.team_name] as EmailRow] : []),
            ...(partnerName ? [['Partner', partnerName] as EmailRow] : []),
            ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
          ]

          const attachments = tournament.start_date ? [{
            filename: icsFilename(tournament.name, 'tournament'),
            content: Buffer.from(generateIcs([{
              uid: tournament.id,
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
            subject: `Payment confirmed — ${tournament.name}`,
            html: registrationEmail({
              heading: 'Payment Confirmed ✓',
              firstName: profile.name?.split(' ')[0] ?? 'there',
              rows,
              ctaLabel: 'View Tournament',
              ctaUrl: tournamentUrl,
              footerNote: 'Keep this email as your payment receipt.',
            }),
            ...(attachments.length > 0 ? { attachments } : {}),
          })
        }

        // In-app notification for the registrant
        if (reg?.user_id) {
          await createNotification({
            recipientId: reg.user_id,
            surface: 'tournament',
            surfaceId: meta.tournament_id,
            kind: 'tournament_registration_confirmed',
            title: `Registered — ${tournament.name}`,
            body: 'Payment confirmed. See you on the court.',
            url: `/tournaments/${meta.tournament_id}`,
          })
        }

        // Email partner: "you've been registered" notification (Option A)
        if (optionAPartnerRegId && partnerResult.data) {
          const partnerEmail = (partnerResult.data as any).email
          if (partnerEmail) {
            const partnerRows: EmailRow[] = [
              ['Tournament', tournament.name],
              ...(locationName ? [['Location', locationName] as EmailRow] : []),
              ...(division?.name ? [['Division', division.name] as EmailRow] : []),
              ...(profile?.name ? [['Registered by', profile.name] as EmailRow] : []),
            ]
            const attachments = tournament.start_date ? [{
              filename: icsFilename(tournament.name, 'tournament'),
              content: Buffer.from(generateIcs([{
                uid: tournament.id,
                title: tournament.name,
                startDate: tournament.start_date,
                ...(locationName ? { location: locationName } : {}),
                url: tournamentUrl,
              }])),
            }] : []
            resend.emails.send({
              from: 'Joinzer <support@joinzer.com>',
              to: partnerEmail,
              replyTo: 'martyfit50@gmail.com',
              subject: `You're registered — ${tournament.name}`,
              html: registrationEmail({
                heading: "You're registered! ✓",
                firstName: partnerName?.split(' ')[0] ?? 'there',
                intro: `${profile?.name ?? 'Your partner'} paid your entry fee and added you to ${tournament.name}.`,
                rows: partnerRows,
                ctaLabel: 'View Tournament',
                ctaUrl: tournamentUrl,
                footerNote: 'Your entry fee was covered by your partner.',
              }),
              ...(attachments.length > 0 ? { attachments } : {}),
            }).catch(() => {})
          }
        }
      }
    }

    // ── Paid play session ──────────────────────────────────────────────────────
    else if (meta.event_type === 'session' && meta.event_id && meta.user_id) {
      const { data: ev } = await service
        .from('events')
        .select('id, title, starts_at, max_players')
        .eq('id', meta.event_id)
        .single()

      if (ev) {
        const { count } = await service
          .from('event_participants')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', meta.event_id)
          .eq('participant_status', 'joined')

        const joinAs = (count ?? 0) < ev.max_players ? 'joined' : 'waitlist'

        await service
          .from('event_participants')
          .upsert({
            event_id: meta.event_id,
            user_id: meta.user_id,
            participant_status: joinAs,
            payment_status: 'paid',
            stripe_payment_intent_id: paymentIntentId,
            joined_at: new Date().toISOString(),
          }, { onConflict: 'event_id,user_id' })

        if (joinAs === 'joined' && (count ?? 0) + 1 >= ev.max_players) {
          await service.from('events').update({ status: 'full' }).eq('id', meta.event_id)
        }

        const { data: profile } = await service
          .from('profiles')
          .select('name, email')
          .eq('id', meta.user_id)
          .single()

        if (profile?.email) {
          const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
          const sessionDate = new Date(ev.starts_at).toLocaleDateString('en-US', {
            timeZone: 'America/Los_Angeles',
            weekday: 'long', month: 'long', day: 'numeric',
          })
          const sessionTime = new Date(ev.starts_at).toLocaleTimeString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric', minute: '2-digit',
          })
          const resend = new Resend(process.env.RESEND_API_KEY)
          await resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: profile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Payment confirmed — ${ev.title}`,
            html: registrationEmail({
              firstName: profile.name?.split(' ')[0] ?? 'there',
              heading: joinAs === 'joined' ? "You're in! Payment Confirmed ✓" : 'Payment Confirmed — Waitlisted',
              rows: [
                ['Session', ev.title],
                ['Date', sessionDate],
                ['Time', sessionTime],
                ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
                ...(joinAs === 'waitlist' ? [["Status", "You're on the waitlist — you'll be notified if a spot opens"] as EmailRow] : []),
              ],
              ctaLabel: 'View Session',
              ctaUrl: `${siteUrl}/play/${meta.event_id}`,
              footerNote: 'Keep this email as your payment receipt.',
            }),
          })
        }
      }
    }

    // ── Paid league registration ───────────────────────────────────────────────
    else if (meta.event_type === 'league' && meta.league_id && meta.user_id) {
      const isDoublesTeam = meta.registration_type === 'team' && !!meta.partner_email

      if (isDoublesTeam) {
        // Auth-and-capture path: register captain as pending_partner, create invitation
        const joinAs = meta.join_as === 'waitlist' ? 'waitlist' : 'pending_partner'

        const { data: upserted } = await service
          .from('league_registrations')
          .upsert({
            league_id: meta.league_id,
            user_id: meta.user_id,
            status: joinAs,
            payment_status: 'authorized',
            stripe_payment_intent_id: paymentIntentId,
            registration_type: 'team',
            registered_at: new Date().toISOString(),
          }, { onConflict: 'league_id,user_id' })
          .select('id')
          .single()

        if (upserted?.id && joinAs === 'pending_partner') {
          await createInviteAndNotify(service, upserted.id, meta.league_id, meta.partner_email, siteUrl)
        }
      } else {
        // Standard solo/individual path
        const joinAs = meta.join_as === 'waitlist' ? 'waitlist' : 'registered'

        await service
          .from('league_registrations')
          .upsert({
            league_id: meta.league_id,
            user_id: meta.user_id,
            status: joinAs,
            payment_status: 'paid',
            stripe_payment_intent_id: paymentIntentId,
            registration_type: meta.registration_type ?? 'solo',
            registered_at: new Date().toISOString(),
          }, { onConflict: 'league_id,user_id' })

        // Confirmation email for standard path
        const [{ data: league }, { data: profile }] = await Promise.all([
          service.from('leagues')
            .select('name, format, skill_min, skill_max, location_name, start_date, end_date, schedule_description, cost_cents')
            .eq('id', meta.league_id)
            .single(),
          service.from('profiles').select('name, email').eq('id', meta.user_id).single(),
        ])

        if (profile?.email && league) {
          const leagueUrl = `${siteUrl}/leagues/${meta.league_id}`
          const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
          const isWaitlist = joinAs !== 'registered'
          const resend = new Resend(process.env.RESEND_API_KEY)

          const fmt = (d: string | null) => d
            ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
                .format(new Date(d + 'T00:00:00'))
            : null
          const startFmt = fmt(league.start_date ?? null)
          const endFmt = fmt(league.end_date ?? null)

          const rows: EmailRow[] = [
            ['League', league.name],
            ...(league.location_name ? [['Location', league.location_name] as EmailRow] : []),
            ...(league.schedule_description ? [['Schedule', league.schedule_description] as EmailRow] : []),
            ...(startFmt && endFmt
              ? [['Dates', `${startFmt} — ${endFmt}`] as EmailRow]
              : startFmt ? [['Starts', startFmt] as EmailRow] : []),
            ...(FORMAT_LABELS[league.format] ? [['Format', FORMAT_LABELS[league.format]] as EmailRow] : []),
            ...(formatSkillRange(league.skill_min, league.skill_max) ? [['Skill level', formatSkillRange(league.skill_min, league.skill_max)!] as EmailRow] : []),
            ['Status', isWaitlist ? "Waitlisted — you'll be notified if a spot opens" : 'Registered'],
            ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
          ]

          let attachments: { filename: string; content: Buffer }[] = []
          if (!isWaitlist) {
            const { data: sessions } = await service
              .from('league_sessions')
              .select('id, session_date, session_number')
              .eq('league_id', meta.league_id)
              .order('session_number', { ascending: true })
            if (sessions && sessions.length > 0) {
              const ics = generateIcs(sessions.map(s => ({
                uid: s.id,
                title: `${league.name} — Session ${s.session_number}`,
                startDate: s.session_date,
                ...(league.location_name ? { location: league.location_name } : {}),
                url: leagueUrl,
              })))
              attachments = [{ filename: icsFilename(league.name, 'league'), content: Buffer.from(ics) }]
            }
          }

          await resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: profile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Payment confirmed — ${league.name}`,
            html: registrationEmail({
              heading: isWaitlist ? 'Payment Confirmed — Waitlisted' : "You're registered! Payment Confirmed ✓",
              firstName: profile.name?.split(' ')[0] ?? 'there',
              rows,
              ctaLabel: 'View League',
              ctaUrl: leagueUrl,
              footerNote: 'Keep this email as your payment receipt.',
            }),
            ...(attachments.length > 0 ? { attachments } : {}),
          })

          // In-app notification for the registrant
          await createNotification({
            recipientId: meta.user_id,
            surface: 'league',
            surfaceId: meta.league_id,
            kind: 'league_registration_confirmed',
            title: `${isWaitlist ? 'Waitlisted' : 'Registered'} — ${league.name}`,
            body: isWaitlist ? "You're on the waitlist. We'll notify you if a spot opens." : 'Payment confirmed. See you on the court.',
            url: `/leagues/${meta.league_id}`,
          })
        }
      }
    }

    // ── Tournament solo registration (B7.3 Pattern C) ────────────────────────
    else if (meta.event_type === 'tournament_solo') {
      const { tournament_id: tId, division_id: divId, user_id: uId } = meta
      const regType: 'team' | 'solo' = meta.registration_type === 'solo' ? 'solo' : 'team'
      const teamName = meta.team_name || null

      if (!tId || !divId || !uId) {
        console.error('[webhook] tournament_solo missing required metadata', meta)
        return NextResponse.json({ received: true })
      }

      // Idempotency: skip if an active registration already exists
      const { data: existingRows } = await service
        .from('tournament_registrations')
        .select('id')
        .eq('tournament_id', tId)
        .eq('division_id', divId)
        .eq('user_id', uId)
        .neq('status', 'cancelled')
        .limit(1)
      if (existingRows && existingRows.length > 0) {
        console.warn('[webhook] tournament_solo duplicate, skipping', { tId, divId, uId })
        return NextResponse.json({ received: true })
      }

      // Re-check capacity — another player may have filled the slot while this user was in Stripe
      const [{ data: division }, { data: regCounts }] = await Promise.all([
        service.from('tournament_divisions')
          .select('id, name, format, max_entries, waitlist_enabled')
          .eq('id', divId)
          .single(),
        service.from('tournament_registrations')
          .select('registration_type, partner_registration_id')
          .eq('division_id', divId)
          .eq('status', 'registered')
          .in('payment_status', ['paid', 'waived', 'comped']),
      ])

      if (!division) {
        console.error('[webhook] tournament_solo: division not found', divId)
        return NextResponse.json({ received: true })
      }

      const tTeamRegs = (regCounts ?? []).filter(r => r.registration_type === 'team').length
      const tSoloRegs = (regCounts ?? []).filter(r => r.registration_type === 'solo').length
      const tFull = (tTeamRegs + Math.floor(tSoloRegs / 2)) >= division.max_entries
      const regStatus = tFull && division.waitlist_enabled ? 'waitlisted' : 'registered'

      if (tFull && !division.waitlist_enabled) {
        // Division filled between capacity check and payment — auto-refund so no manual intervention needed.
        // Idempotency key scopes the refund to one per payment intent; safe on webhook retries.
        console.error('[webhook] tournament_solo: division full race — auto-refunding', { tId, divId, uId, paymentIntentId })
        if (paymentIntentId) {
          const refundStripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          await refundStripe.refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `solo-race-refund-${paymentIntentId}` }
          ).catch(err =>
            console.error('[webhook] tournament_solo: auto-refund failed — MANUAL ACTION REQUIRED', { paymentIntentId, tId, divId, uId, err })
          )
        }
        return NextResponse.json({ received: true })
      }

      const { data: soloReg, error: soloInsertErr } = await service
        .from('tournament_registrations')
        .insert({
          tournament_id: tId,
          division_id: divId,
          user_id: uId,
          team_name: regType === 'team' ? teamName : null,
          status: regStatus,
          registration_type: regType,
          payment_status: 'paid',
          stripe_payment_intent_id: paymentIntentId,
        })
        .select('id, user_id, partner_user_id, partner_registration_id, registration_type, status')
        .single()

      if (soloInsertErr || !soloReg) {
        console.error('[webhook] tournament_solo INSERT failed', soloInsertErr)
        return NextResponse.json({ received: true })
      }

      if (meta.discount_code_id) {
        await service.rpc('increment_discount_uses', { code_id: meta.discount_code_id })
      }

      // Auto-match solo players. Filter paid/waived to avoid linking against Pattern A unpaid ghosts.
      if (regType === 'solo' && regStatus === 'registered') {
        const { data: soloPartner } = await service
          .from('tournament_registrations')
          .select('id, user_id')
          .eq('division_id', divId)
          .eq('status', 'registered')
          .eq('registration_type', 'solo')
          .in('payment_status', ['paid', 'waived', 'comped'])
          .is('partner_registration_id', null)
          .neq('user_id', uId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (soloPartner) {
          await Promise.all([
            service.from('tournament_registrations').update({
              partner_user_id: soloPartner.user_id,
              partner_registration_id: soloPartner.id,
            }).eq('id', soloReg.id),
            service.from('tournament_registrations').update({
              partner_user_id: uId,
              partner_registration_id: soloReg.id,
            }).eq('id', soloPartner.id),
          ])

          const { data: matchProfiles } = await service
            .from('profiles')
            .select('id, name, email')
            .in('id', [uId, soloPartner.user_id])
          const myProfile = matchProfiles?.find(p => p.id === uId)
          const partnerProfile = matchProfiles?.find(p => p.id === soloPartner.user_id)

          if (myProfile && partnerProfile) {
            const resend = new Resend(process.env.RESEND_API_KEY)
            const tournamentUrl = `${siteUrl}/tournaments/${tId}`
            const matchHtml = (recipientName: string, partnerName: string) => `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
                <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
                  <h1 style="margin:0;font-size:20px;color:#012D0B">You've been matched with a partner!</h1>
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
            if (myProfile.email) {
              resend.emails.send({
                from: 'Joinzer <support@joinzer.com>',
                to: myProfile.email,
                replyTo: 'martyfit50@gmail.com',
                subject: `Partner match confirmed — ${partnerProfile.name}`,
                html: matchHtml(myProfile.name ?? '', partnerProfile.name ?? ''),
              }).catch(() => {})
            }
            if (partnerProfile.email) {
              resend.emails.send({
                from: 'Joinzer <support@joinzer.com>',
                to: partnerProfile.email,
                replyTo: 'martyfit50@gmail.com',
                subject: `Partner match confirmed — ${myProfile.name}`,
                html: matchHtml(partnerProfile.name ?? '', myProfile.name ?? ''),
              }).catch(() => {})
            }
          }
        }
      }

      // Confirmation email
      const [{ data: soloTournament }, { data: soloProfile }, { data: soloDivision }] = await Promise.all([
        service.from('tournaments').select('name, start_date, location_id').eq('id', tId).single(),
        service.from('profiles').select('name, email').eq('id', uId).single(),
        service.from('tournament_divisions').select('name').eq('id', divId).single(),
      ])

      if (soloProfile?.email && soloTournament) {
        const locationResult = (soloTournament as any).location_id
          ? await service.from('locations').select('name').eq('id', (soloTournament as any).location_id).single()
          : { data: null }
        const locationName = locationResult.data?.name ?? null
        const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
        const isWaitlist = regStatus === 'waitlisted'
        const resend = new Resend(process.env.RESEND_API_KEY)
        const tournamentUrl = `${siteUrl}/tournaments/${tId}`

        const soloRows: EmailRow[] = [
          ['Tournament', soloTournament.name],
          ...(locationName ? [['Location', locationName] as EmailRow] : []),
          ...(soloDivision?.name ? [['Division', soloDivision.name] as EmailRow] : []),
          ...(teamName ? [['Team', teamName] as EmailRow] : []),
          ['Status', isWaitlist ? "Waitlisted — you'll be notified if a spot opens" : 'Registered'],
          ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
        ]

        const attachments = !isWaitlist && (soloTournament as any).start_date ? [{
          filename: icsFilename(soloTournament.name, 'tournament'),
          content: Buffer.from(generateIcs([{
            uid: tId,
            title: soloTournament.name,
            startDate: (soloTournament as any).start_date,
            ...(locationName ? { location: locationName } : {}),
            url: tournamentUrl,
          }])),
        }] : []

        resend.emails.send({
          from: 'Joinzer <support@joinzer.com>',
          to: soloProfile.email,
          replyTo: 'martyfit50@gmail.com',
          subject: isWaitlist ? `Waitlist confirmed: ${soloTournament.name}` : `Payment confirmed — ${soloTournament.name}`,
          html: registrationEmail({
            heading: isWaitlist ? "You're on the waitlist!" : 'Payment Confirmed ✓',
            firstName: soloProfile.name?.split(' ')[0] ?? 'there',
            rows: soloRows,
            ctaLabel: 'View Tournament',
            ctaUrl: tournamentUrl,
            footerNote: 'Keep this email as your payment receipt.',
          }),
          ...(attachments.length > 0 ? { attachments } : {}),
        }).catch(() => {})
      }
    }

    // ── Tournament partner invite acceptance (B7.4 Pattern C) ──────────────────
    else if (meta.event_type === 'tournament_partner_accept') {
      const invId = meta.invitation_id
      const tId = meta.tournament_id
      const divId = meta.division_id
      const uId = meta.user_id
      const inviterRegId = meta.inviter_registration_id

      if (!invId || !tId || !divId || !uId || !inviterRegId) {
        console.error('[webhook] tournament_partner_accept missing required metadata', meta)
        return NextResponse.json({ received: true })
      }

      // Idempotency: webhook retry guard — skip if registration already exists for this PI
      if (paymentIntentId) {
        const { data: existingByPi } = await service
          .from('tournament_registrations')
          .select('id')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .limit(1)
        if (existingByPi && existingByPi.length > 0) {
          console.warn('[webhook] tournament_partner_accept duplicate PI, skipping', { paymentIntentId, invId, uId })
          return NextResponse.json({ received: true })
        }
      }

      // Inviter still registered? If they cancelled, refund invitee and abort.
      const { data: inviterReg } = await service
        .from('tournament_registrations')
        .select('id, user_id')
        .eq('id', inviterRegId)
        .neq('status', 'cancelled')
        .maybeSingle()

      if (!inviterReg) {
        console.warn('[webhook] tournament_partner_accept: inviter registration gone — refunding invitee', { inviterRegId, uId, paymentIntentId })
        if (paymentIntentId) {
          const refundStripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          await refundStripe.refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `partner-inviter-gone-${paymentIntentId}` }
          ).catch(err =>
            console.error('[webhook] tournament_partner_accept: inviter-gone refund failed — MANUAL ACTION REQUIRED', { paymentIntentId, invId, uId, err })
          )
        }
        return NextResponse.json({ received: true })
      }

      // Atomic double-accept guard: only the first webhook to arrive wins this UPDATE.
      // Two Stripe sessions from a double-tap race have different PIs; the Stripe idempotency key
      // cannot catch this — this row-level UPDATE is the guard. 0 rows = loser → refund.
      const { data: acceptedRows, error: acceptErr } = await service
        .from('tournament_team_invitations')
        .update({ status: 'accepted', invitee_user_id: uId })
        .eq('id', invId)
        .eq('status', 'pending')
        .select('id')

      if (acceptErr) {
        // Can't determine state safely — don't refund, log for manual review.
        console.error('[webhook] tournament_partner_accept: invitation UPDATE error — CRITICAL, no refund issued', { invId, uId, paymentIntentId, err: acceptErr.message })
        return NextResponse.json({ received: true })
      }

      if (!acceptedRows || acceptedRows.length === 0) {
        // Double-accept loser — invitation already resolved by a concurrent webhook
        console.warn('[webhook] tournament_partner_accept: double-accept loser — refunding', { invId, uId, paymentIntentId })
        if (paymentIntentId) {
          const refundStripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          await refundStripe.refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `partner-stale-${paymentIntentId}` }
          ).catch(err =>
            console.error('[webhook] tournament_partner_accept: stale-invite refund failed — MANUAL ACTION REQUIRED', { paymentIntentId, invId, uId, err })
          )
        }
        return NextResponse.json({ received: true })
      }

      // INSERT invitee's registration
      const { data: newPartnerReg, error: partnerInsertErr } = await service
        .from('tournament_registrations')
        .insert({
          tournament_id: tId,
          division_id: divId,
          user_id: uId,
          status: 'registered',
          registration_type: 'team',
          payment_status: 'paid',
          stripe_payment_intent_id: paymentIntentId,
        })
        .select('id')
        .single()

      if (partnerInsertErr || !newPartnerReg) {
        // INSERT failed after invitation already accepted — mark expired to prevent retry loops, refund.
        console.error('[webhook] tournament_partner_accept: INSERT failed after invitation accepted — CRITICAL', { invId, uId, paymentIntentId, err: partnerInsertErr?.message })
        await service
          .from('tournament_team_invitations')
          .update({ status: 'expired' })
          .eq('id', invId)
        if (paymentIntentId) {
          const refundStripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          await refundStripe.refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `partner-insert-failed-${paymentIntentId}` }
          ).catch(err =>
            console.error('[webhook] tournament_partner_accept: insert-failed refund failed — MANUAL ACTION REQUIRED', { paymentIntentId, invId, uId, err })
          )
        }
        return NextResponse.json({ received: true })
      }

      // Cross-link both registrations: partner_user_id + partner_registration_id
      await Promise.all([
        service.from('tournament_registrations').update({
          partner_user_id: uId,
          partner_registration_id: newPartnerReg.id,
        }).eq('id', inviterRegId),
        service.from('tournament_registrations').update({
          partner_user_id: inviterReg.user_id,
          partner_registration_id: inviterRegId,
        }).eq('id', newPartnerReg.id),
      ])

      // Emails: invitee payment receipt + inviter partner-confirmed notification
      const [{ data: partnerTournament }, { data: inviteeProfile }, { data: inviterProfile }, { data: inviteeDivision }] = await Promise.all([
        service.from('tournaments').select('name, start_date, location_id').eq('id', tId).single(),
        service.from('profiles').select('name, email').eq('id', uId).single(),
        service.from('profiles').select('name, email').eq('id', inviterReg.user_id).single(),
        service.from('tournament_divisions').select('name').eq('id', divId).single(),
      ])

      if (partnerTournament) {
        const tournamentUrl = `${siteUrl}/tournaments/${tId}`
        const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
        const locationResult = (partnerTournament as any).location_id
          ? await service.from('locations').select('name').eq('id', (partnerTournament as any).location_id).single()
          : { data: null }
        const locationName = locationResult.data?.name ?? null
        const resend = new Resend(process.env.RESEND_API_KEY)

        if (inviteeProfile?.email) {
          const inviteeRows: EmailRow[] = [
            ['Tournament', partnerTournament.name],
            ...(locationName ? [['Location', locationName] as EmailRow] : []),
            ...(inviteeDivision?.name ? [['Division', inviteeDivision.name] as EmailRow] : []),
            ...(inviterProfile?.name ? [['Partner', inviterProfile.name] as EmailRow] : []),
            ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
          ]

          const attachments = (partnerTournament as any).start_date ? [{
            filename: icsFilename(partnerTournament.name, 'tournament'),
            content: Buffer.from(generateIcs([{
              uid: tId,
              title: partnerTournament.name,
              startDate: (partnerTournament as any).start_date,
              ...(locationName ? { location: locationName } : {}),
              url: tournamentUrl,
            }])),
          }] : []

          resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: inviteeProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Payment confirmed — ${partnerTournament.name}`,
            html: registrationEmail({
              heading: 'Payment Confirmed ✓',
              firstName: inviteeProfile.name?.split(' ')[0] ?? 'there',
              rows: inviteeRows,
              ctaLabel: 'View Tournament',
              ctaUrl: tournamentUrl,
              footerNote: 'Keep this email as your payment receipt.',
            }),
            ...(attachments.length > 0 ? { attachments } : {}),
          }).catch(() => {})
        }

        if (inviterProfile?.email) {
          resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: inviterProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Partner confirmed — ${partnerTournament.name}`,
            html: registrationEmail({
              heading: "You're set! Partner Confirmed ✓",
              firstName: inviterProfile.name?.split(' ')[0] ?? 'there',
              intro: `${inviteeProfile?.name ?? 'Your partner'} accepted your invitation and completed their registration.`,
              rows: [
                ['Tournament', partnerTournament.name],
                ...(inviteeDivision?.name ? [['Division', inviteeDivision.name] as EmailRow] : []),
                ['Partner', inviteeProfile?.name ?? '—'],
              ],
              ctaLabel: 'View Tournament',
              ctaUrl: tournamentUrl,
              footerNote: '',
            }),
          }).catch(() => {})
        }
      }
    }

    // ── League partner payment ─────────────────────────────────────────────────
    else if (meta.event_type === 'league_partner' && meta.invitation_id && meta.user_id) {
      const { data: inv } = await service
        .from('league_partner_invitations')
        .select('id, captain_registration_id, league_id, invitee_email, status')
        .eq('id', meta.invitation_id)
        .eq('status', 'pending')
        .single()

      if (!inv) {
        // Invitation already resolved (race with cron or double-fire) — refund partner
        if (paymentIntentId) {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          await stripe.refunds.create({ payment_intent: paymentIntentId }).catch((err) =>
            console.error('[webhook] partner refund on stale invite failed:', err)
          )
        }
        return NextResponse.json({ received: true })
      }

      const { data: captainReg } = await service
        .from('league_registrations')
        .select('stripe_payment_intent_id, user_id')
        .eq('id', inv.captain_registration_id)
        .single()

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

      // Capture captain's held payment
      let captureOk = false
      if (captainReg?.stripe_payment_intent_id) {
        try {
          await stripe.paymentIntents.capture(captainReg.stripe_payment_intent_id)
          captureOk = true
        } catch (err) {
          console.error('[webhook] captain capture failed:', err)
        }
      } else {
        // No hold exists (free league path shouldn't reach here, but treat as ok)
        captureOk = true
      }

      if (!captureOk) {
        // Refund partner, reset invitation to retryable pending
        if (paymentIntentId) {
          await stripe.refunds.create({ payment_intent: paymentIntentId }).catch((err) =>
            console.error('[webhook] partner refund after capture failure:', err)
          )
        }
        // Email both parties
        const [captainProfileResult, { data: league }] = await Promise.all([
          captainReg?.user_id
            ? service.from('profiles').select('name, email').eq('id', captainReg.user_id).single()
            : Promise.resolve({ data: null }),
          service.from('leagues').select('name, id').eq('id', inv.league_id).single(),
        ])
        const captainProfile = captainProfileResult.data
        const resend = new Resend(process.env.RESEND_API_KEY)

        if (captainProfile?.email && league) {
          resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: captainProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Action needed — ${league.name} registration`,
            html: registrationEmail({
              heading: 'Payment capture failed',
              firstName: captainProfile.name?.split(' ')[0] ?? 'there',
              intro: `Your partner ${inv.invitee_email} paid, but we were unable to capture your registration fee. Your partner has been refunded. Please try registering again.`,
              rows: [['League', league.name]],
              ctaLabel: 'Try again',
              ctaUrl: `${siteUrl}/leagues/${league.id}`,
              footerNote: '',
            }),
          }).catch(() => {})
        }

        const { data: partnerProfile } = await service.from('profiles').select('name, email').eq('id', meta.user_id).single()
        if (partnerProfile?.email && league) {
          resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: partnerProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `You've been refunded — ${league.name}`,
            html: registrationEmail({
              heading: 'Payment refunded',
              firstName: partnerProfile.name?.split(' ')[0] ?? 'there',
              intro: `There was a problem processing your partner's registration fee. Your payment has been refunded. Your partner will be in touch to retry.`,
              rows: [['League', league.name]],
              ctaLabel: 'View League',
              ctaUrl: `${siteUrl}/leagues/${league.id}`,
              footerNote: '',
            }),
          }).catch(() => {})
        }

        return NextResponse.json({ received: true })
      }

      // Both payments succeeded — register partner, finalize captain, link both
      const { data: league } = await service.from('leagues')
        .select('name, format, skill_min, skill_max, location_name, start_date, end_date, schedule_description')
        .eq('id', inv.league_id).single()

      const { data: partnerReg } = await service
        .from('league_registrations')
        .upsert({
          league_id: inv.league_id,
          user_id: meta.user_id,
          status: 'registered',
          payment_status: 'paid',
          stripe_payment_intent_id: paymentIntentId,
          registration_type: 'team',
          registered_at: new Date().toISOString(),
        }, { onConflict: 'league_id,user_id' })
        .select('id')
        .single()

      if (partnerReg?.id) {
        // Cross-link registrations
        await Promise.all([
          service.from('league_registrations').update({
            status: 'registered',
            payment_status: 'paid',
            partner_user_id: meta.user_id,
            partner_registration_id: partnerReg.id,
          }).eq('id', inv.captain_registration_id),
          service.from('league_registrations').update({
            partner_user_id: captainReg?.user_id ?? null,
            partner_registration_id: inv.captain_registration_id,
          }).eq('id', partnerReg.id),
          service.from('league_partner_invitations').update({ status: 'accepted' }).eq('id', inv.id),
        ])
      }

      // Email both players
      const [captainProfileResult, partnerProfileResult] = await Promise.all([
        captainReg?.user_id
          ? service.from('profiles').select('name, email').eq('id', captainReg.user_id).single()
          : Promise.resolve({ data: null }),
        service.from('profiles').select('name, email').eq('id', meta.user_id).single(),
      ])
      const captainProfile = captainProfileResult.data
      const partnerProfile = partnerProfileResult.data

      if (league) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const leagueUrl = `${siteUrl}/leagues/${inv.league_id}`
        const fmt = (d: string | null) => d
          ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' })
              .format(new Date(d + 'T00:00:00'))
          : null

        const sharedRows: EmailRow[] = [
          ['League', league.name],
          ...(league.location_name ? [['Location', league.location_name] as EmailRow] : []),
          ...(league.schedule_description ? [['Schedule', league.schedule_description] as EmailRow] : []),
          ...(fmt(league.start_date ?? null) ? [['Starts', fmt(league.start_date ?? null)!] as EmailRow] : []),
        ]

        if (captainProfile?.email) {
          resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: captainProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `You're registered! — ${league.name}`,
            html: registrationEmail({
              heading: "You're registered! ✓",
              firstName: captainProfile.name?.split(' ')[0] ?? 'there',
              intro: `${partnerProfile?.name ?? 'Your partner'} accepted your invitation and paid. You're both registered for ${league.name}.`,
              rows: [...sharedRows, ['Partner', partnerProfile?.name ?? inv.invitee_email]],
              ctaLabel: 'View League',
              ctaUrl: leagueUrl,
              footerNote: 'Keep this email as your payment receipt.',
            }),
          }).catch(() => {})
        }

        if (partnerProfile?.email) {
          resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: partnerProfile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Payment confirmed — ${league.name}`,
            html: registrationEmail({
              heading: 'Payment Confirmed ✓',
              firstName: partnerProfile.name?.split(' ')[0] ?? 'there',
              intro: `You and ${captainProfile?.name ?? 'your partner'} are registered for ${league.name}.`,
              rows: [...sharedRows, ['Partner', captainProfile?.name ?? 'Your captain']],
              ctaLabel: 'View League',
              ctaUrl: leagueUrl,
              footerNote: 'Keep this email as your payment receipt.',
            }),
          }).catch(() => {})
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
