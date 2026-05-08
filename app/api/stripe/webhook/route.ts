import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'

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

      // Confirmation email
      const [{ data: reg }, { data: tournament }] = await Promise.all([
        service.from('tournament_registrations')
          .select('user_id, division_id, team_name')
          .eq('id', meta.registration_id)
          .single(),
        service.from('tournaments')
          .select('id, name, start_date')
          .eq('id', meta.tournament_id)
          .single(),
      ])

      if (reg && tournament) {
        const [{ data: profile }, { data: division }] = await Promise.all([
          service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
          service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
        ])
        if (profile?.email) {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
          const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
          const resend = new Resend(process.env.RESEND_API_KEY)
          await resend.emails.send({
            from: 'Joinzer <support@joinzer.com>',
            to: profile.email,
            replyTo: 'martyfit50@gmail.com',
            subject: `Payment confirmed — ${tournament.name}`,
            html: confirmationEmail({
              firstName: profile.name?.split(' ')[0] ?? 'there',
              heading: 'Payment Confirmed ✓',
              rows: [
                ['Tournament', tournament.name],
                ...(division?.name ? [['Division', division.name] as [string, string]] : []),
                ...(reg.team_name ? [['Team', reg.team_name] as [string, string]] : []),
                ...(amountPaid ? [['Amount paid', amountPaid] as [string, string]] : []),
              ],
              ctaLabel: 'View Tournament',
              ctaUrl: `${siteUrl}/tournaments/${tournament.id}`,
            }),
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
            html: confirmationEmail({
              firstName: profile.name?.split(' ')[0] ?? 'there',
              heading: joinAs === 'joined' ? 'You\'re in! Payment Confirmed ✓' : 'Payment Confirmed — Waitlisted',
              rows: [
                ['Session', ev.title],
                ['Date', sessionDate],
                ['Time', sessionTime],
                ...(amountPaid ? [['Amount paid', amountPaid] as [string, string]] : []),
                ...(joinAs === 'waitlist' ? [['Status', "You're on the waitlist — you'll be notified if a spot opens"] as [string, string]] : []),
              ],
              ctaLabel: 'View Session',
              ctaUrl: `${siteUrl}/events/${meta.event_id}`,
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
        service.from('leagues').select('name').eq('id', meta.league_id).single(),
        service.from('profiles').select('name, email').eq('id', meta.user_id).single(),
      ])

      if (profile?.email && league) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'
        const amountPaid = session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : ''
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: 'Joinzer <support@joinzer.com>',
          to: profile.email,
          replyTo: 'martyfit50@gmail.com',
          subject: `Payment confirmed — ${league.name}`,
          html: confirmationEmail({
            firstName: profile.name?.split(' ')[0] ?? 'there',
            heading: joinAs === 'registered' ? 'You\'re registered! Payment Confirmed ✓' : 'Payment Confirmed — Waitlisted',
            rows: [
              ['League', league.name],
              ...(amountPaid ? [['Amount paid', amountPaid] as [string, string]] : []),
              ['Status', joinAs === 'registered' ? 'Registered' : "Waitlisted — you'll be notified if a spot opens"],
            ],
            ctaLabel: 'View League',
            ctaUrl: `${siteUrl}/compete/leagues/${meta.league_id}`,
          }),
        })
      }
    }
  }

  return NextResponse.json({ received: true })
}

function confirmationEmail({
  firstName,
  heading,
  rows,
  ctaLabel,
  ctaUrl,
}: {
  firstName: string
  heading: string
  rows: [string, string][]
  ctaLabel: string
  ctaUrl: string
}) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
      <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;font-size:20px;color:#012D0B">${heading}</h1>
      </div>
      <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="margin:0 0 20px;font-size:15px">Hi ${firstName}, your payment has been received.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          ${rows.map(([label, value]) => `
            <tr>
              <td style="padding:6px 0;color:#6b7280;font-size:14px;width:40%">${label}</td>
              <td style="padding:6px 0;font-size:14px;font-weight:500">${value}</td>
            </tr>
          `).join('')}
        </table>
        <a href="${ctaUrl}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">${ctaLabel}</a>
        <p style="margin-top:24px;font-size:12px;color:#9ca3af">Keep this email as your payment receipt.</p>
      </div>
    </div>
  `
}
