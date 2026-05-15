import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { registrationEmail, type EmailRow } from '@/lib/email/templates'
import { generateIcs, type IcsEvent } from '@/lib/email/ics'

export const dynamic = 'force-dynamic'

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
          .select('user_id, division_id, team_name, partner_user_id, registration_type')
          .eq('id', meta.registration_id)
          .single(),
        service.from('tournaments')
          .select('id, name, start_date, start_time, location:locations!location_id(name)')
          .eq('id', meta.tournament_id)
          .single(),
      ])

      if (reg && tournament) {
        const [{ data: profile }, { data: division }, partnerResult] = await Promise.all([
          service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
          service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
          reg.partner_user_id
            ? service.from('profiles').select('name').eq('id', reg.partner_user_id).single()
            : Promise.resolve({ data: null }),
        ])
        if (profile?.email) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
          const tournamentUrl = `${siteUrl}/tournaments/${tournament.id}`
          const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
          const locationName = (tournament.location as any)?.name ?? null
          const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' }) : null
          const partnerName = (partnerResult.data as any)?.name ?? null

          const rows: EmailRow[] = [
            ['Tournament', tournament.name],
            ...(division?.name ? [['Division', division.name] as EmailRow] : []),
            ...(reg.team_name ? [['Team', reg.team_name] as EmailRow] : []),
            ...(reg.registration_type === 'solo'
              ? [[
                  'Partner',
                  partnerName ?? 'Solo — awaiting a partner match',
                ] as EmailRow]
              : []),
            ...(locationName ? [['Location', locationName] as EmailRow] : []),
            ...(fmtDate(tournament.start_date) ? [['Date', fmtDate(tournament.start_date)!] as EmailRow] : []),
            ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
          ]

          const startDatetime = tournament.start_date && tournament.start_time
            ? `${tournament.start_date}T${tournament.start_time}:00`
            : tournament.start_date ?? null

          const icsEvents: IcsEvent[] = startDatetime
            ? [{ uid: `tournament-${tournament.id}`, title: tournament.name, startDate: startDatetime, location: locationName ?? undefined, url: tournamentUrl }]
            : []

          const resend = new Resend(process.env.RESEND_API_KEY)
          try {
            await resend.emails.send({
              from: 'Joinzer <support@joinzer.com>',
              to: profile.email,
              replyTo: 'martyfit50@gmail.com',
              subject: `Payment confirmed — ${tournament.name}`,
              html: registrationEmail({
                firstName: profile.name?.split(' ')[0] ?? 'there',
                heading: 'Payment Confirmed ✓',
                intro: 'your payment has been received.',
                rows,
                ctaLabel: 'View Tournament',
                ctaUrl: tournamentUrl,
                footerNote: 'Keep this email as your payment receipt.',
              }),
              ...(icsEvents.length > 0
                ? { attachments: [{ filename: 'tournament.ics', content: generateIcs(icsEvents), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }
                : {}),
            })
          } catch (err) {
            console.error('Paid tournament confirmation email error:', err)
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
              intro: 'your payment has been received.',
              rows: [
                ['Session', ev.title],
                ['Date', sessionDate],
                ['Time', sessionTime],
                ...(amountPaid ? [['Amount paid', amountPaid] as [string, string]] : []),
                ...(joinAs === 'waitlist' ? [['Status', "You're on the waitlist — you'll be notified if a spot opens"] as [string, string]] : []),
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
      const [{ data: league }, { data: profile }, { data: leagueSessions }] = await Promise.all([
        service.from('leagues').select('name, location_name, start_date, end_date, play_time, format, skill_level').eq('id', meta.league_id).single(),
        service.from('profiles').select('name, email').eq('id', meta.user_id).single(),
        joinAs === 'registered'
          ? service.from('league_sessions').select('id, session_number, session_date').eq('league_id', meta.league_id).not('status', 'eq', 'cancelled').order('session_number')
          : Promise.resolve({ data: [] }),
      ])

      if (profile?.email && league) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
        const leagueUrl = `${siteUrl}/compete/leagues/${meta.league_id}`
        const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
        const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric' }) : null
        const FORMAT_LABELS: Record<string, string> = {
          individual_round_robin: 'Individual Round Robin',
          mens_doubles: "Men's Doubles", womens_doubles: "Women's Doubles",
          mixed_doubles: 'Mixed Doubles', coed_doubles: 'Coed Doubles', custom: 'Custom',
        }
        const SKILL_LABELS: Record<string, string> = {
          beginner: 'Beginner', beginner_plus: 'Beginner Plus', intermediate: 'Intermediate',
          intermediate_plus: 'Intermediate Plus', advanced: 'Advanced',
        }

        const rows: EmailRow[] = [
          ['League', league.name],
          ...(league.format ? [['Format', FORMAT_LABELS[league.format] ?? league.format] as EmailRow] : []),
          ...(league.skill_level ? [['Skill Level', SKILL_LABELS[league.skill_level] ?? league.skill_level] as EmailRow] : []),
          ...(league.location_name ? [['Location', league.location_name] as EmailRow] : []),
          ...(fmtDate(league.start_date) ? [['Starts', fmtDate(league.start_date)!] as EmailRow] : []),
          ...(fmtDate(league.end_date) ? [['Ends', fmtDate(league.end_date)!] as EmailRow] : []),
          ['Status', joinAs === 'registered' ? 'Registered' : "Waitlisted — you'll be notified if a spot opens"],
          ...(amountPaid ? [['Amount paid', amountPaid] as EmailRow] : []),
        ]

        const sessions = (leagueSessions ?? []) as { id: string; session_number: number; session_date: string }[]
        const icsEvents: IcsEvent[] = sessions.length > 0
          ? sessions.map((s) => ({
              uid: `league-${meta.league_id}-session-${s.id}`,
              title: `${league.name} — Session ${s.session_number}`,
              startDate: s.session_date,
              location: league.location_name ?? undefined,
              description: (league as any).play_time ? `Time: ${(league as any).play_time}` : undefined,
              url: leagueUrl,
            }))
          : league.start_date
          ? [{ uid: `league-${meta.league_id}`, title: league.name, startDate: league.start_date, location: league.location_name ?? undefined, url: leagueUrl }]
          : []

        const resend = new Resend(process.env.RESEND_API_KEY)
        try {
          await resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: profile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Payment confirmed — ${league.name}`,
            html: registrationEmail({
              firstName: profile.name?.split(' ')[0] ?? 'there',
              heading: joinAs === 'registered' ? "You're registered! Payment Confirmed ✓" : 'Payment Confirmed — Waitlisted',
              intro: 'your payment has been received.',
              rows,
              ctaLabel: 'View League',
              ctaUrl: leagueUrl,
              footerNote: 'Keep this email as your payment receipt.',
            }),
            ...(icsEvents.length > 0 && joinAs === 'registered'
              ? { attachments: [{ filename: 'league-schedule.ics', content: generateIcs(icsEvents), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }
              : {}),
          })
        } catch (err) {
          console.error('Paid league confirmation email error:', err)
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}

