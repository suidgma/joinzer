import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getSiteUrl } from '@/lib/utils/site-url'
import { resolvePriceCents } from '@/lib/payments/priceTiers'
import { computeBundle, normalizeMultiDivisionDiscount, type BundleItem } from '@/lib/payments/multiDivisionDiscount'

// Reserve-then-pay bundled checkout: register for 2+ divisions of one tournament in
// a single payment, with the organizer's multi-division discount on the total.
//
// v1 scope: the player's own SOLO entries (singles + solo-into-doubles for later
// matching). Pay-for-both / partner bundling is deferred (Phase 5c); discount codes
// on bundles are not applied yet. Reservations are created up front (status
// 'registered', payment_status 'unpaid') to hold capacity; the webhook flips them to
// paid, and an abandoned-order cron cancels the unpaid reservations.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const divisionIds: string[] = Array.isArray(body.division_ids)
      ? ([...new Set(body.division_ids.filter((x: unknown) => typeof x === 'string'))] as string[])
      : []
    if (divisionIds.length < 2) {
      return NextResponse.json({ error: 'Select at least two divisions to bundle.' }, { status: 400 })
    }

    const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: tournament } = await service
      .from('tournaments')
      .select('id, name, cost_cents, price_tiers, multi_division_discount, organizer_id, registration_status, registration_closes_at')
      .eq('id', params.id)
      .single()
    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
    if (tournament.registration_status === 'closed') {
      return NextResponse.json({ error: 'Registration is closed' }, { status: 400 })
    }
    if ((tournament as any).registration_closes_at && new Date() > new Date((tournament as any).registration_closes_at)) {
      return NextResponse.json({ error: 'Registration is closed' }, { status: 400 })
    }

    const { data: divisions } = await service
      .from('tournament_divisions')
      .select('id, name, cost_cents, max_entries')
      .eq('tournament_id', params.id)
      .in('id', divisionIds)
    const divs = (divisions ?? []) as any[]
    if (divs.length !== divisionIds.length) {
      return NextResponse.json({ error: 'One or more divisions were not found.' }, { status: 400 })
    }

    // Already-registered guard + capacity (v1 rejects a full division rather than
    // charging for a waitlist spot; the cross-sell UI only offers open divisions).
    const { data: existingRegs } = await service
      .from('tournament_registrations')
      .select('id, division_id, user_id, status')
      .eq('tournament_id', params.id)
      .in('division_id', divisionIds)
      .neq('status', 'cancelled')
    const regsByDiv = new Map<string, any[]>()
    for (const r of existingRegs ?? []) {
      if (!regsByDiv.has(r.division_id)) regsByDiv.set(r.division_id, [])
      regsByDiv.get(r.division_id)!.push(r)
    }
    for (const d of divs) {
      const rs = regsByDiv.get(d.id) ?? []
      if (rs.some((r) => r.user_id === user.id)) {
        return NextResponse.json({ error: `You're already registered for ${d.name}.` }, { status: 409 })
      }
      const filled = rs.filter((r) => r.status === 'registered').length
      if (d.max_entries && filled >= d.max_entries) {
        return NextResponse.json({ error: `${d.name} is full.` }, { status: 409 })
      }
    }

    // Per-division base price: a division fee override is flat; otherwise the
    // tier-resolved (early-bird) tournament fee.
    const now = new Date()
    const items: BundleItem[] = divs.map((d) => ({
      divisionId: d.id,
      baseCents: d.cost_cents != null
        ? d.cost_cents
        : resolvePriceCents((tournament as any).cost_cents ?? 0, (tournament as any).price_tiers, now),
    }))
    const discount = normalizeMultiDivisionDiscount((tournament as any).multi_division_discount)
    const bundle = computeBundle(items, discount)
    const isFree = bundle.totalCents <= 0

    const { data: order, error: orderErr } = await service
      .from('tournament_orders')
      .insert({
        tournament_id: params.id,
        user_id: user.id,
        status: 'pending',
        subtotal_cents: bundle.subtotalCents,
        multi_div_discount_cents: bundle.multiDivDiscountCents,
        code_discount_cents: 0,
        total_cents: bundle.totalCents,
      })
      .select('id')
      .single()
    if (orderErr || !order) {
      return NextResponse.json({ error: orderErr?.message ?? 'Could not create order' }, { status: 500 })
    }

    // Reserve N registrations (the player's own solo entries) + order items.
    const regRows = divs.map((d) => ({
      tournament_id: params.id,
      division_id: d.id,
      user_id: user.id,
      status: 'registered',
      registration_type: 'solo',
      payment_status: isFree ? 'waived' : 'unpaid',
    }))
    const { data: createdRegs, error: regErr } = await service
      .from('tournament_registrations')
      .insert(regRows)
      .select('id, division_id')
    if (regErr || !createdRegs) {
      await service.from('tournament_orders').delete().eq('id', order.id)
      return NextResponse.json({ error: regErr?.message ?? 'Could not reserve your spots' }, { status: 500 })
    }
    const regByDiv = new Map((createdRegs as any[]).map((r) => [r.division_id, r.id]))
    const baseByDiv = new Map(bundle.items.map((i) => [i.divisionId, i.baseCents]))
    const netByDiv = new Map(bundle.items.map((i) => [i.divisionId, i.netCents]))
    await service.from('tournament_order_items').insert(
      divs.map((d) => ({
        order_id: order.id,
        division_id: d.id,
        registration_id: regByDiv.get(d.id) ?? null,
        base_cents: baseByDiv.get(d.id) ?? 0,
        net_cents: netByDiv.get(d.id) ?? 0,
        outcome: isFree ? 'registered' : null,
      })),
    )

    if (isFree) {
      await service.from('tournament_orders').update({ status: 'paid' }).eq('id', order.id)
      return NextResponse.json({ free: true })
    }

    // Route through the organizer's Connect account when enabled (destination charge).
    const { data: organizerProfile } = await service
      .from('profiles')
      .select('stripe_connect_account_id, stripe_charges_enabled')
      .eq('id', (tournament as any).organizer_id)
      .single()
    const connectAccountId = (organizerProfile as any)?.stripe_charges_enabled
      ? (organizerProfile as any)?.stripe_connect_account_id
      : null

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const siteUrl = getSiteUrl()
    const applicationFeeAmount = connectAccountId ? Math.round(bundle.totalCents * 0.05) : undefined
    const label = `${tournament.name} — ${divs.length} divisions`

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'usd', unit_amount: bundle.totalCents, product_data: { name: label } }, quantity: 1 },
      ],
      ...(connectAccountId
        ? {
            payment_intent_data: {
              application_fee_amount: applicationFeeAmount,
              on_behalf_of: connectAccountId,
              transfer_data: { destination: connectAccountId },
            },
          }
        : {}),
      metadata: { event_type: 'tournament_order', order_id: order.id, tournament_id: params.id },
      success_url: `${siteUrl}/tournaments/${params.id}?payment=success`,
      cancel_url: `${siteUrl}/tournaments/${params.id}?payment=cancelled`,
    })

    await service.from('tournament_orders').update({ stripe_session_id: stripeSession.id }).eq('id', order.id)
    return NextResponse.json({ url: stripeSession.url })
  } catch (err: any) {
    console.error('[tournament-order] checkout error:', err)
    return NextResponse.json({ error: err?.message ?? 'Checkout failed' }, { status: 500 })
  }
}
