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
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { registration_id, tournament_id } = session.metadata ?? {}

    if (registration_id) {
      const service = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      // Mark paid
      await service
        .from('tournament_registrations')
        .update({ payment_status: 'paid' })
        .eq('id', registration_id)

      // Fetch context for confirmation email
      const [{ data: reg }, { data: tournament }] = await Promise.all([
        service.from('tournament_registrations')
          .select('user_id, division_id, team_name')
          .eq('id', registration_id)
          .single(),
        service.from('tournaments')
          .select('id, name, start_date')
          .eq('id', tournament_id)
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
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
                <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
                  <h1 style="margin:0;font-size:20px;color:#012D0B">Payment Confirmed ✓</h1>
                </div>
                <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
                  <p style="margin:0 0 20px;font-size:15px">
                    Hi ${profile.name?.split(' ')[0] ?? 'there'}, your registration payment has been received.
                  </p>
                  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Tournament</td><td style="padding:6px 0;font-size:14px;font-weight:600">${tournament.name}</td></tr>
                    <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Division</td><td style="padding:6px 0;font-size:14px">${division?.name ?? '—'}</td></tr>
                    ${reg.team_name ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Team</td><td style="padding:6px 0;font-size:14px">${reg.team_name}</td></tr>` : ''}
                    ${amountPaid ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Amount paid</td><td style="padding:6px 0;font-size:14px;color:#16a34a;font-weight:600">${amountPaid}</td></tr>` : ''}
                  </table>
                  <a href="${siteUrl}/tournaments/${tournament.id}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Tournament</a>
                  <p style="margin-top:24px;font-size:12px;color:#9ca3af">
                    Keep this email as your payment receipt. See you on the court!
                  </p>
                </div>
              </div>
            `,
          })
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
