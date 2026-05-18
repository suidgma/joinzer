import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { Resend } from 'resend'

type Params = { params: Promise<{ id: string; regId: string }> }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch registration
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, status, payment_status, stripe_payment_intent_id, division_id, team_name, tournament_id')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .single()

  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  // Caller must own the registration or be the tournament organizer
  const { data: tournament } = await service
    .from('tournaments')
    .select('id, name, organizer_id')
    .eq('id', params.id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  const isOwner = reg.user_id === user.id
  const isOrganizer = tournament.organizer_id === user.id
  if (!isOwner && !isOrganizer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (reg.status === 'cancelled') {
    return NextResponse.json({ error: 'Already cancelled' }, { status: 409 })
  }

  // Auto-refund if paid and a Stripe payment intent exists
  let refunded = false
  if (reg.payment_status === 'paid' && reg.stripe_payment_intent_id) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    try {
      await stripe.refunds.create({ payment_intent: reg.stripe_payment_intent_id })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? 'Stripe refund failed — registration not cancelled' }, { status: 500 })
    }

    await service
      .from('tournament_registrations')
      .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
      .eq('id', params.regId)

    refunded = true
  }

  // Cancel the registration
  await service
    .from('tournament_registrations')
    .update({ status: 'cancelled' })
    .eq('id', params.regId)

  // Send refund email if applicable (fire-and-forget)
  if (refunded) {
    ;(async () => {
      try {
        const [{ data: profile }, { data: division }] = await Promise.all([
          service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
          service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
        ])

        if (!profile?.email) return

        const firstName = profile.name?.split(' ')[0] ?? 'there'
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: 'Joinzer <support@joinzer.com>',
          to: profile.email,
          replyTo: 'martyfit50@gmail.com',
          subject: `Registration cancelled & refund issued — ${tournament.name}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
              <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
                <h1 style="margin:0;font-size:20px;color:#012D0B">Registration Cancelled</h1>
              </div>
              <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
                <p style="margin:0 0 20px;font-size:15px">Hi ${firstName}, your registration has been cancelled and a full refund has been issued.</p>
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
        })
      } catch (err) {
        console.error('Cancel+refund email error:', err)
      }
    })()
  }

  return NextResponse.json({ ok: true, refunded })
}
