import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { sendEmail } from '@/lib/email/send'
import { logAudit } from '@/lib/audit/log'
import { getSiteUrl } from '@/lib/utils/site-url'
import { normalizeMultiDivisionDiscount, bundleCancelRefundCents } from '@/lib/payments/multiDivisionDiscount'

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

  // Fetch registration — include B11 cols + division_id for scoped waitlist promotion.
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, status, payment_status, stripe_payment_intent_id, division_id, team_name, tournament_id, partner_registration_id, partner_user_id')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .single()

  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  // registration_closes_at: deadline that gates the REFUND (not the cancellation).
  const { data: tournament } = await service
    .from('tournaments')
    .select('id, name, organizer_id, registration_closes_at, no_refund_date, multi_division_discount')
    .eq('id', params.id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  // Caller must own the registration or be the tournament organizer.
  const isOwner = reg.user_id === user.id
  const isOrganizer = tournament.organizer_id === user.id
  if (!isOwner && !isOrganizer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Idempotency guard.
  if (reg.status === 'cancelled') {
    return NextResponse.json({ error: 'Already cancelled' }, { status: 409 })
  }

  let refunded = false
  let pastDeadline = false

  // ── paid → refund (or cancel-only if past deadline) ───────────────────────
  if (reg.payment_status === 'paid' && reg.stripe_payment_intent_id) {
    // Deadline gates the REFUND, not the cancellation. A dedicated no-refund date, when
    // set, is the authoritative cutoff (refunds stop at the start of that day); otherwise
    // fall back to registration_closes_at. NULL both = always within window.
    const noRefund = (tournament as any).no_refund_date ? new Date((tournament as any).no_refund_date + 'T00:00:00') : null
    const regClose = tournament.registration_closes_at ? new Date(tournament.registration_closes_at) : null
    const cutoff = noRefund ?? regClose
    const withinDeadline = !cutoff || new Date() < cutoff

    if (withinDeadline) {
      // How much to refund:
      //  - standalone reg (no order item) → the full payment (refundCents = null).
      //  - payer's own bundled division → the MARGINAL bundle value it adds now,
      //    recomputed over the divisions that remain (never the stored pro-rata
      //    net_cents), so cancelling a discounted add-on can't shrink what you paid
      //    for a division you keep, and dropping below the discount threshold reprices
      //    what remains to its fair standalone price.
      //  - partner "pay-for-both" seat (someone else's reg, full price) → its own share.
      let refundCents: number | null = null // null = refund the whole PaymentIntent

      const { data: orderItem } = await service
        .from('tournament_order_items')
        .select('order_id, net_cents, base_cents')
        .eq('registration_id', params.regId)
        .maybeSingle()

      if (orderItem) {
        const { data: order } = await service
          .from('tournament_orders')
          .select('user_id, discount_config, code_config')
          .eq('id', (orderItem as any).order_id)
          .single()
        const payerId = (order as any)?.user_id

        if (order && reg.user_id === payerId) {
          // Payer's own division — marginal recompute over the payer's still-active divisions.
          const { data: siblingItems } = await service
            .from('tournament_order_items')
            .select('base_cents, registration_id')
            .eq('order_id', (orderItem as any).order_id)
          const regIds = (siblingItems ?? []).map((i: any) => i.registration_id).filter(Boolean)
          const { data: siblingRegs } = await service
            .from('tournament_registrations')
            .select('id, user_id, status, payment_status')
            .in('id', regIds)
          const regById = new Map((siblingRegs ?? []).map((r: any) => [r.id, r]))
          // Still-active = payer's own divisions not already cancelled/refunded (this reg
          // is still 'registered' at this point, so it's included in the "before" set).
          const activeBases: number[] = (siblingItems ?? [])
            .filter((i: any) => {
              const r = regById.get(i.registration_id)
              return r && r.user_id === payerId && r.status !== 'cancelled' && r.payment_status !== 'refunded'
            })
            .map((i: any) => (i.base_cents ?? 0) as number)
          const discount = normalizeMultiDivisionDiscount(
            (order as any).discount_config ?? (tournament as any).multi_division_discount,
          )
          refundCents = bundleCancelRefundCents(activeBases, (orderItem as any).base_cents ?? 0, discount, (order as any).code_config ?? null)
        } else {
          // Partner seat (full-price standalone item) — refund its own allocated share.
          refundCents = (orderItem as any).net_cents ?? 0
        }
      }

      // Zero-value refund — nothing to send to Stripe; mark refunded and cancel below.
      if (refundCents !== null && refundCents <= 0) {
        await service
          .from('tournament_registrations')
          .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
          .eq('id', params.regId)
      } else {
        // Stripe FIRST — if this fails, no DB writes have happened, safe to abort.
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
        let stripeRefund: Stripe.Refund
        try {
          if (refundCents !== null) {
            // Partial refund of the shared payment; reverse the proportional Connect
            // transfer when this was a destination charge.
            const pi = await stripe.paymentIntents.retrieve(reg.stripe_payment_intent_id)
            const isConnect = !!(pi as any).transfer_data?.destination
            stripeRefund = await stripe.refunds.create({
              payment_intent: reg.stripe_payment_intent_id,
              amount: refundCents,
              ...(isConnect ? { reverse_transfer: true } : {}),
            })
          } else {
            stripeRefund = await stripe.refunds.create({ payment_intent: reg.stripe_payment_intent_id })
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return NextResponse.json({ error: `Refund failed: ${msg}` }, { status: 502 })
        }

        // DB update AFTER Stripe success. If this fails, money moved but record didn't — surface it.
        const { error: refundDbErr } = await service
          .from('tournament_registrations')
          .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
          .eq('id', params.regId)

        if (refundDbErr) {
          // CRITICAL: Stripe refund issued but DB record not updated.
          console.error(
            `[tournament-cancel] CRITICAL: Stripe refund ${stripeRefund.id} issued for ` +
            `registration ${params.regId} (tournament ${params.id}, user ${user.id}) but ` +
            `payment_status DB update failed: ${refundDbErr.message}. ` +
            `Manual reconciliation required.`
          )
          return NextResponse.json(
            { error: 'Refund was issued but the record could not be updated. Contact support immediately with your tournament and account details.' },
            { status: 500 }
          )
        }
      }

      refunded = true
    } else {
      // Past deadline: cancel succeeds, no Stripe call. payment_status stays 'paid'.
      pastDeadline = true
    }
  }

  // ── B11: clear partner link on the partner's row ──────────────────────────
  // Partner keeps their registered status — only the FK pointers are nulled.
  // INTENTIONAL for multi-division "pay for both": if the payer cancels their OWN entry in a
  // doubles division they covered both seats for, the partner's paid seat is NOT revoked or
  // refunded — the entry was gifted to them and remains theirs (now unpaired). The partner (or
  // organizer) can cancel that seat separately, which refunds its own item via the branch above.
  if (reg.partner_registration_id) {
    await service
      .from('tournament_registrations')
      .update({ partner_user_id: null, partner_registration_id: null })
      .eq('id', reg.partner_registration_id)
    // Best-effort: failure leaves stale FK but does not block the cancel.
  }

  // ── Invite cleanup: void any pending invitations this registrant sent ─────
  // No pending_partner status on tournament_registrations — derive from invite table directly.
  // No-op-safe: zero matching rows = zero rows updated, no error.
  // Delta: table = tournament_team_invitations; FK col = inviter_registration_id (not captain_registration_id).
  await service
    .from('tournament_team_invitations')
    .update({ status: 'expired' })
    .eq('inviter_registration_id', reg.id)
    .eq('status', 'pending')

  // ── Cancel the registration ───────────────────────────────────────────────
  const { error: cancelErr } = await service
    .from('tournament_registrations')
    .update({ status: 'cancelled' })
    .eq('id', params.regId)

  if (cancelErr) {
    console.error(`[tournament-cancel] registration cancel failed reg=${params.regId} tournament=${params.id} user=${user.id}`, cancelErr)
    return NextResponse.json({ error: cancelErr.message || 'Cancel failed' }, { status: 500 })
  }

  // ── Waitlist promotion ────────────────────────────────────────────────────
  // Scoped to the same division. Status = 'waitlisted' (NOT 'waitlist' — tournament constraint).
  // Ordering by created_at (tournament_registrations has no registered_at column).
  const { data: nextUp } = await service
    .from('tournament_registrations')
    .select('id, user_id')
    .eq('tournament_id', params.id)
    .eq('division_id', reg.division_id)
    .eq('status', 'waitlisted')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (nextUp) {
    await service
      .from('tournament_registrations')
      .update({ status: 'registered' })
      .eq('id', nextUp.id)

    const { data: promotedProfile } = await service
      .from('profiles')
      .select('name, email')
      .eq('id', nextUp.user_id)
      .single()

    if (promotedProfile?.email) {
      const siteUrl = getSiteUrl()
      const firstName = promotedProfile.name?.split(' ')[0] ?? 'there'
      sendEmail({
        to: promotedProfile.email,
        subject: `You're in! A spot opened up — ${tournament.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
            <div style="background:#8FC919;padding:24px 32px;border-radius:12px 12px 0 0">
              <h1 style="margin:0;font-size:20px;color:#012D0B">You're off the waitlist!</h1>
            </div>
            <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
              <p style="margin:0 0 20px;font-size:15px">
                Good news, ${firstName}! A spot opened up in <strong>${tournament.name}</strong> and you've been automatically moved from the waitlist to registered.
              </p>
              <a href="${siteUrl}/tournaments/${params.id}" style="background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">View Tournament</a>
              <p style="margin-top:24px;font-size:12px;color:#9ca3af">See you on the court!</p>
            </div>
          </div>
        `,
      }).catch(() => {})
    }
  }

  // ── Cancel confirmation to the cancelling player ──────────────────────────
  const [{ data: cancellerProfile }, { data: division }] = await Promise.all([
    service.from('profiles').select('name, email').eq('id', reg.user_id).single(),
    service.from('tournament_divisions').select('name').eq('id', reg.division_id).single(),
  ])

  if (cancellerProfile?.email) {
    const siteUrl = getSiteUrl()
    const firstName = cancellerProfile.name?.split(' ')[0] ?? 'there'
    const refundLine = refunded
      ? '<p style="margin:0 0 16px;font-size:14px;color:#6b7280">Your registration fee has been refunded. It typically appears within 5–10 business days depending on your bank.</p>'
      : pastDeadline
        ? '<p style="margin:0 0 16px;font-size:14px;color:#6b7280">The refund window for this tournament has closed, so your registration fee will not be refunded. Contact the organizer if you have questions.</p>'
        : ''
    sendEmail({
      to: cancellerProfile.email,
      subject: `Registration cancelled — ${tournament.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1F2A1C">
          <div style="background:#f3f4f6;padding:24px 32px;border-radius:12px 12px 0 0">
            <h1 style="margin:0;font-size:20px;color:#374151">Registration Cancelled</h1>
          </div>
          <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <p style="margin:0 0 16px;font-size:15px">Hi ${firstName}, your registration has been cancelled.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Tournament</td><td style="padding:6px 0;font-size:14px;font-weight:600">${tournament.name}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Division</td><td style="padding:6px 0;font-size:14px">${division?.name ?? '—'}</td></tr>
              ${reg.team_name ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Team</td><td style="padding:6px 0;font-size:14px">${reg.team_name}</td></tr>` : ''}
            </table>
            ${refundLine}
            <a href="${siteUrl}/tournaments/${params.id}" style="display:inline-block;background:#8FC919;color:#012D0B;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Browse Tournaments</a>
          </div>
        </div>
      `,
    }).catch(() => {})
  }

  await logAudit({
    actorId: user.id,
    entityType: 'tournament_registration',
    entityId: params.regId,
    action: refunded ? 'registration_cancelled_refunded' : pastDeadline ? 'registration_cancelled_no_refund' : 'registration_cancelled',
    before: { status: reg.status, payment_status: reg.payment_status },
    after: { status: 'cancelled', payment_status: refunded ? 'refunded' : reg.payment_status },
  })

  return NextResponse.json({ ok: true, refunded, promoted: !!nextUp })
}
