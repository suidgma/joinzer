import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { getSiteUrl } from '@/lib/utils/site-url'
import Stripe from 'stripe'
import { isWithinRefundWindow } from '@/lib/payments/refundWindow'

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // ── Refund a paid participant who leaves within the refund window ──────────
  // The no-refund date (falling back to registration close) gates the REFUND, not
  // the leave — a player can always leave; whether they're refunded depends on the
  // cutoff. Refund BEFORE leave_event so a Stripe failure aborts cleanly (nothing
  // changed, they stay joined). leave_event only marks the row 'left', so the
  // refunded payment_status survives; a retry sees 'refunded' and won't double-refund.
  let refunded = false
  const { data: myPart } = await admin
    .from('event_participants')
    .select('payment_status, stripe_payment_intent_id')
    .eq('event_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (myPart?.payment_status === 'paid' && myPart.stripe_payment_intent_id) {
    const { data: ev } = await admin
      .from('events')
      .select('no_refund_date, registration_closes_at')
      .eq('id', params.id)
      .single()
    if (isWithinRefundWindow((ev as any)?.no_refund_date, (ev as any)?.registration_closes_at)) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      try {
        await stripe.refunds.create({ payment_intent: myPart.stripe_payment_intent_id })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ error: `Refund failed: ${msg}` }, { status: 502 })
      }
      const { error: refundDbErr } = await admin
        .from('event_participants')
        .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
        .eq('event_id', params.id)
        .eq('user_id', user.id)
      if (refundDbErr) {
        console.error(
          `[event-leave] CRITICAL: Stripe refund issued for event ${params.id} user ${user.id} ` +
          `but payment_status DB update failed: ${refundDbErr.message}. Manual reconciliation required.`
        )
        return NextResponse.json({ error: 'Refund was issued but the record could not be updated. Contact support.' }, { status: 500 })
      }
      refunded = true
    }
  }

  // Peek at oldest waitlisted player BEFORE calling the RPC so we know who will be promoted
  const { data: nextUp } = await admin
    .from('event_participants')
    .select('user_id')
    .eq('event_id', params.id)
    .eq('participant_status', 'waitlist')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Call leave_event RPC — handles leave + promotion atomically
  const { error: rpcError } = await supabase.rpc('leave_event', { p_event_id: params.id })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }

  // If someone was on the waitlist, email them
  if (nextUp?.user_id) {
    const [{ data: event }, { data: profile }] = await Promise.all([
      admin.from('events')
        .select('id, title, starts_at, duration_minutes, location:locations!location_id(name)')
        .eq('id', params.id)
        .single(),
      admin.from('profiles')
        .select('name, email')
        .eq('id', nextUp.user_id)
        .single(),
    ])

    if (profile?.email && event) {
      const loc = (event as any).location
      const startsAt = new Date(event.starts_at)
      const date = startsAt.toLocaleDateString('en-US', {
        timeZone: 'America/Los_Angeles',
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
      const time = startsAt.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric', minute: '2-digit',
      })
      const siteUrl = getSiteUrl()
      const firstName = profile.name?.split(' ')[0] ?? 'there'

      sendEmail({
        to: profile.email,
        subject: `You're in! A spot opened up — ${event.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">You're off the waitlist!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 20px;font-size:15px">
                Good news, ${firstName}! A spot opened up and you've been automatically moved from the waitlist to <strong>joined</strong>.
              </p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Session</td><td style="padding:6px 0;font-size:14px;font-weight:600">${event.title}</td></tr>
                ${loc ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Location</td><td style="padding:6px 0;font-size:14px">${loc.name}</td></tr>` : ''}
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Date</td><td style="padding:6px 0;font-size:14px">${date}</td></tr>
                <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Time</td><td style="padding:6px 0;font-size:14px">${time}</td></tr>
              </table>
              <a href="${siteUrl}/play/${event.id}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Session</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the court!</p>
            </div>
          </div>
        `,
      }).catch(() => {}) // non-blocking
    }
  }

  return NextResponse.json({ ok: true, refunded })
}
