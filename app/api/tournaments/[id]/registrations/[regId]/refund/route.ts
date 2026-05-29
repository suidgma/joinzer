import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { createNotification } from '@/lib/notifications/create'
import { logAudit } from '@/lib/audit/log'

type Params = { params: Promise<{ id: string; regId: string }> }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify caller is the organizer
  const { data: tournament } = await service
    .from('tournaments')
    .select('id, name, organizer_id')
    .eq('id', params.id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  if (tournament.organizer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch registration
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, payment_status, stripe_payment_intent_id, division_id, team_name')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .single()

  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  if (reg.payment_status !== 'paid') return NextResponse.json({ error: 'Registration is not in paid status' }, { status: 400 })
  if (!reg.stripe_payment_intent_id) return NextResponse.json({ error: 'No Stripe payment on record — refund manually in Stripe dashboard' }, { status: 400 })

  // Issue refund via Stripe.
  //
  // For destination charges (Connect-routed payments), we MUST also reverse
  // the transfer and refund the application fee — otherwise the connected
  // account keeps the organizer's share and Joinzer eats the customer
  // refund from its own balance.
  //
  // We branch by inspecting the original PaymentIntent: if transfer_data
  // is set, it was a destination charge.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const reverseFlags: { reverse_transfer?: boolean; refund_application_fee?: boolean } = {}
  try {
    const pi = await stripe.paymentIntents.retrieve(reg.stripe_payment_intent_id)
    if (pi.transfer_data?.destination) {
      reverseFlags.reverse_transfer = true
      reverseFlags.refund_application_fee = true
    }
  } catch {
    // If retrieval fails, fall through to a plain refund. Better that Joinzer
    // occasionally eats a refund than that a player can't get their money back.
  }

  try {
    await stripe.refunds.create({
      payment_intent: reg.stripe_payment_intent_id,
      ...reverseFlags,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Stripe refund failed' }, { status: 500 })
  }

  // Update registration status
  await service
    .from('tournament_registrations')
    .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('id', params.regId)

  // Email the player
  const [{ data: profile }, { data: division }] = await Promise.all([
    service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
    service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
  ])

  if (profile?.email) {
    const firstName = profile.name?.split(' ')[0] ?? 'there'
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
    const resend = new Resend(process.env.RESEND_API_KEY)
    resend.emails.send({
      from: 'Joinzer <support@joinzer.com>',
      to: profile.email,
      replyTo: 'martyfit50@gmail.com',
      subject: `Refund issued — ${tournament.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
          <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
            <h1 style="margin:0;font-size:20px;color:#012D0B">Refund Issued</h1>
          </div>
          <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <p style="margin:0 0 20px;font-size:15px">
              Hi ${firstName}, the organizer has issued a refund for your registration.
            </p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Tournament</td><td style="padding:6px 0;font-size:14px;font-weight:600">${tournament.name}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Division</td><td style="padding:6px 0;font-size:14px">${division?.name ?? '—'}</td></tr>
              ${reg.team_name ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Team</td><td style="padding:6px 0;font-size:14px">${reg.team_name}</td></tr>` : ''}
            </table>
            <p style="font-size:14px;color:#6b7280">Refunds typically appear on your card within 5–10 business days depending on your bank.</p>
            <a href="${siteUrl}/tournaments" style="display:inline-block;margin-top:20px;background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Browse Tournaments</a>
          </div>
        </div>
      `,
    }).catch(() => {})
  }

  await logAudit({
    actorId: user.id,
    entityType: 'payment',
    entityId: params.regId,
    action: 'registration_refunded',
    before: { payment_status: 'paid' },
    after: { payment_status: 'refunded' },
  })

  // In-app notification alongside the email
  await createNotification({
    recipientId: reg.user_id,
    surface: 'tournament',
    surfaceId: params.id,
    kind: 'tournament_refunded',
    title: `Refund issued — ${tournament.name}`,
    body: 'Your registration refund has been processed. Expect 5–10 business days.',
    url: `/tournaments/${params.id}`,
  })

  return NextResponse.json({ ok: true })
}
