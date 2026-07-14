import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import Stripe from 'stripe'
import { getSiteUrl } from '@/lib/utils/site-url'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await request.json()

  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch active registration. limit(1) array guard — maybeSingle() 500s on dup rows.
  const { data: regRows } = await admin
    .from('league_registrations')
    .select('id, status, payment_status, stripe_payment_intent_id, partner_registration_id, partner_user_id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .limit(1)

  const reg = regRows?.[0] ?? null

  // Idempotency: no active registration means already cancelled (or never registered).
  if (!reg) {
    return NextResponse.json({ error: 'Already cancelled' }, { status: 409 })
  }

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, registration_closes_at, no_refund_date')
    .eq('id', leagueId)
    .single()

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  let refunded = false
  let pastDeadline = false

  // ── paid → refund (or cancel-only if past deadline) ───────────────────────
  if (reg.payment_status === 'paid' && reg.stripe_payment_intent_id) {
    // Deadline gates the REFUND, not the cancellation. A dedicated no-refund date, when
    // set, is the authoritative cutoff (refunds stop at the start of that day); otherwise
    // fall back to registration_closes_at. NULL both = always within window.
    const noRefund = (league as any).no_refund_date ? new Date((league as any).no_refund_date + 'T00:00:00') : null
    const regClose = league.registration_closes_at ? new Date(league.registration_closes_at) : null
    const cutoff = noRefund ?? regClose
    const withinDeadline = !cutoff || new Date() < cutoff

    if (withinDeadline) {
      // Stripe FIRST — if this fails, no DB writes have happened, safe to abort.
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      let stripeRefund: Stripe.Refund
      try {
        stripeRefund = await stripe.refunds.create({ payment_intent: reg.stripe_payment_intent_id })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ error: `Refund failed: ${msg}` }, { status: 502 })
      }

      // DB update AFTER Stripe success. If this fails, money moved but record didn't — surface it.
      const { error: refundDbErr } = await admin
        .from('league_registrations')
        .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
        .eq('id', reg.id)

      if (refundDbErr) {
        // CRITICAL: Stripe refund was issued but DB record was not updated.
        // Return an error immediately — do NOT proceed to cancel the registration.
        // Manual reconciliation required: match stripeRefund.id to registration reg.id.
        console.error(
          `[league-cancel] CRITICAL: Stripe refund ${stripeRefund.id} issued for ` +
          `registration ${reg.id} (league ${leagueId}, user ${user.id}) but ` +
          `payment_status DB update failed: ${refundDbErr.message}. ` +
          `Manual reconciliation required.`
        )
        return NextResponse.json(
          { error: 'Refund was issued but the record could not be updated. Contact support immediately with your league and account details.' },
          { status: 500 }
        )
      }

      refunded = true
    } else {
      // Past deadline: cancel succeeds, no Stripe call. payment_status stays 'paid'.
      pastDeadline = true
    }

  // ── authorized → release auth hold ───────────────────────────────────────
  } else if (reg.payment_status === 'authorized' && reg.stripe_payment_intent_id) {
    // No money was captured, so no deadline gate applies.
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    try {
      await stripe.paymentIntents.cancel(reg.stripe_payment_intent_id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Could not release payment hold: ${msg}` }, { status: 502 })
    }

    const { error: releaseDbErr } = await admin
      .from('league_registrations')
      .update({ payment_status: 'unpaid' })
      .eq('id', reg.id)

    if (releaseDbErr) {
      // Auth hold released (no money moved) but DB didn't update.
      console.error(
        `[league-cancel] WARNING: Auth hold released for registration ${reg.id} ` +
        `(league ${leagueId}, user ${user.id}) but payment_status update failed: ${releaseDbErr.message}`
      )
      return NextResponse.json(
        { error: 'Payment hold was released but the record could not be updated. Contact support.' },
        { status: 500 }
      )
    }
  }

  // ── B11: clear partner link on the partner's row ──────────────────────────
  // Partner keeps their registered status — only the FK pointers are nulled.
  if (reg.partner_registration_id) {
    await admin
      .from('league_registrations')
      .update({ partner_user_id: null, partner_registration_id: null })
      .eq('id', reg.partner_registration_id)
    // Best-effort: failure leaves stale FK but does not block the cancel.
  }

  // ── pending_partner: void any open invitations this captain sent ──────────
  // 'expired' is the closest valid status value (CHECK: pending/accepted/declined/expired).
  if (reg.status === 'pending_partner') {
    await admin
      .from('league_partner_invitations')
      .update({ status: 'expired' })
      .eq('captain_registration_id', reg.id)
      .eq('status', 'pending')
    // Best-effort: stale invite will expire naturally if this write fails.
  }

  // ── Cancel the registration ───────────────────────────────────────────────
  const { error: cancelErr } = await admin
    .from('league_registrations')
    .update({ status: 'cancelled' })
    .eq('id', reg.id)

  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 })

  // ── Waitlist promotion (preserved from original) ──────────────────────────
  const { data: nextUp } = await admin
    .from('league_registrations')
    .select('id, user_id')
    .eq('league_id', leagueId)
    .eq('status', 'waitlist')
    .order('registered_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (nextUp) {
    await admin
      .from('league_registrations')
      .update({ status: 'registered' })
      .eq('id', nextUp.id)

    const { data: promotedProfile } = await admin
      .from('profiles')
      .select('name, email')
      .eq('id', nextUp.user_id)
      .single()

    if (promotedProfile?.email) {
      const siteUrl = getSiteUrl()
      const firstName = promotedProfile.name?.split(' ')[0] ?? 'there'
      sendEmail({
        to: promotedProfile.email,
        subject: `You're in! A spot opened up — ${league.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">You're off the waitlist!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 20px;font-size:15px">
                Good news, ${firstName}! A spot opened up in <strong>${league.name}</strong> and you've been automatically moved from the waitlist to registered.
              </p>
              <a href="${siteUrl}/leagues/${league.id}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View League</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the court!</p>
            </div>
          </div>
        `,
      }).catch(() => {})
    }
  }

  // ── Cancel confirmation to the player who just cancelled ──────────────────
  const { data: cancellerProfile } = await admin
    .from('profiles')
    .select('name, email')
    .eq('id', user.id)
    .single()

  if (cancellerProfile?.email) {
    const siteUrl = getSiteUrl()
    const firstName = cancellerProfile.name?.split(' ')[0] ?? 'there'
    const refundLine = refunded
      ? '<p style="margin:0 0 16px;font-size:15px">Your registration fee has been refunded. It typically appears within 5–10 business days.</p>'
      : pastDeadline
        ? '<p style="margin:0 0 16px;font-size:15px">The refund window for this league has closed, so your registration fee will not be refunded. Contact the organizer if you have questions.</p>'
        : ''
    sendEmail({
      to: cancellerProfile.email,
      subject: `Registration cancelled — ${league.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
          <div style="background:#f3f4f6;padding:24px 32px;border-radius:12px 12px 0 0">
            <h1 style="margin:0;font-size:20px;color:#374151">Registration Cancelled</h1>
          </div>
          <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <p style="margin:0 0 16px;font-size:15px">
              Hi ${firstName}, your registration for <strong>${league.name}</strong> has been cancelled.
            </p>
            ${refundLine}
            <a href="${siteUrl}/leagues/${leagueId}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View League</a>
            <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the courts!</p>
          </div>
        </div>
      `,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, refunded, promoted: !!nextUp })
}
