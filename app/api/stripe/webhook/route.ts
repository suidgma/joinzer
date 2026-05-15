import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { generateIcs } from '@/lib/email/ics'

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

const SKILL_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  beginner_plus: 'Beginner Plus',
  intermediate: 'Intermediate',
  intermediate_plus: 'Intermediate Plus',
  advanced: 'Advanced',
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

    // ── Tournament registration ────────────────────────────────────────────────
    if (meta.registration_id) {
      await service
        .from('tournament_registrations')
        .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId })
        .eq('id', meta.registration_id)

      if (meta.partner_registration_id) {
        await service
          .from('tournament_registrations')
          .update({ payment_status: 'paid', stripe_payment_intent_id: paymentIntentId })
          .eq('id', meta.partner_registration_id)
      }

      if (meta.discount_code_id) {
        await service.rpc('increment_discount_uses', { code_id: meta.discount_code_id })
      }

      // Confirmation email
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

      if (reg && tournament) {
        const [{ data: profile }, { data: division }] = await Promise.all([
          service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
          service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
        ])

        const locationResult = tournament.location_id
          ? await service.from('locations').select('name').eq('id', tournament.location_id).single()
          : { data: null }
        const partnerResult = reg.partner_user_id
          ? await service.from('profiles').select('name').eq('id', reg.partner_user_id).single()
          : { data: null }
        const locationName = locationResult.data?.name ?? null
        const partnerName = partnerResult.data?.name ?? null

        if (profile?.email) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
          const tournamentUrl = `${siteUrl}/tournaments/${tournament.id}`
          const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
          const resend = new Resend(process.env.RESEND_API_KEY)

          const rows: EmailRow[] = [
            ['Tournament', tournament.name],
            ...(locationName ? [['Location', locationName] as EmailRow] : []),
            ...(division?.name ? [['Division', division.name] as EmailRow] : []),
            ...(reg.team_name ? [['Team', reg.team_name] as EmailRow] : []),
            ...(partnerName ? [['Partner', partnerName] as EmailRow] : []),
            ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
          ]

          const attachments = tournament.start_date ? [{
            filename: 'joinzer-tournament.ics',
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
        // Re-check capacity at webhook time (final gatekeeper)
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

        // Mark event full if needed
        if (joinAs === 'joined' && (count ?? 0) + 1 >= ev.max_players) {
          await service.from('events').update({ status: 'full' }).eq('id', meta.event_id)
        }

        // Confirmation email
        const { data: profile } = await service
          .from('profiles')
          .select('name, email')
          .eq('id', meta.user_id)
          .single()

        if (profile?.email) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
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
                ...(joinAs === 'waitlist' ? [['Status', "You're on the waitlist — you'll be notified if a spot opens"] as EmailRow] : []),
              ],
              ctaLabel: 'View Session',
              ctaUrl: `${siteUrl}/events/${meta.event_id}`,
              footerNote: 'Keep this email as your payment receipt.',
            }),
          })
        }
      }
    }

    // ── Paid league registration ───────────────────────────────────────────────
    else if (meta.event_type === 'league' && meta.league_id && meta.user_id) {
      const joinAs = meta.join_as === 'waitlist' ? 'waitlist' : 'registered'

      await service
        .from('league_registrations')
        .upsert({
          league_id: meta.league_id,
          user_id: meta.user_id,
          status: joinAs,
          payment_status: 'paid',
          stripe_payment_intent_id: paymentIntentId,
          registered_at: new Date().toISOString(),
        }, { onConflict: 'league_id,user_id' })

      // Confirmation email
      const [{ data: league }, { data: profile }] = await Promise.all([
        service.from('leagues')
          .select('name, format, skill_level, location_name, start_date, end_date, schedule_description, cost_cents')
          .eq('id', meta.league_id)
          .single(),
        service.from('profiles').select('name, email').eq('id', meta.user_id).single(),
      ])

      if (profile?.email && league) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
        const leagueUrl = `${siteUrl}/compete/leagues/${meta.league_id}`
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
          ...(SKILL_LABELS[league.skill_level] ? [['Skill level', SKILL_LABELS[league.skill_level]] as EmailRow] : []),
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
            attachments = [{ filename: 'joinzer-league.ics', content: Buffer.from(ics) }]
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
      }
    }
  }

  return NextResponse.json({ received: true })
}
