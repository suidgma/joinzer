import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getSiteUrl } from '@/lib/utils/site-url'
import { resolvePriceCents } from '@/lib/payments/priceTiers'
import { computeBundle, normalizeMultiDivisionDiscount, type BundleItem } from '@/lib/payments/multiDivisionDiscount'
import { reapAbandonedTournamentOrders } from '@/lib/payments/reapAbandonedOrders'
import { isDoublesFormat } from '@/lib/taxonomy/formats'

// Gender-specific formats require both seats to match. Mirrors the single-division register route.
const GENDER_REQUIRED: Record<string, string> = {
  mens_doubles: 'male', womens_doubles: 'female',
  mens_singles: 'male', womens_singles: 'female',
}

// A registered team occupies one slot even though it is two rows; unmatched solos pair up
// (floor(n/2)). Mirrors the capacity math in the single-division register route.
function effectiveTeams(rows: { id: string; registration_type: string | null; partner_registration_id: string | null }[]): number {
  const teamRows = rows.filter((r) => r.registration_type === 'team')
  const uniqueTeams = teamRows.filter((r) => !r.partner_registration_id || r.id < r.partner_registration_id).length
  const soloRows = rows.filter((r) => r.registration_type === 'solo').length
  return uniqueTeams + Math.floor(soloRows / 2)
}

// Reserve-then-pay bundled checkout: register for 2+ divisions of one tournament in a
// single payment, with the organizer's multi-division discount on the total.
//
// v1 scope: the player's own entries across divisions, PLUS optional "pay for both"
// (Phase 5c) — for a doubles division the player may cover a partner's entry in the same
// payment (the partner must already have a Joinzer account). The bundle discount applies
// to the player's own division entries; a partner seat is charged at full price. Discount
// codes on bundles are not applied yet. Reservations are created up front (status
// 'registered', payment_status 'unpaid'/'waived') to hold capacity; the webhook flips them
// to paid, and an abandoned-order cron cancels the unpaid reservations.
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
    // Optional "pay for both": { [divisionId]: partnerEmail } for doubles divisions in the bundle.
    const partnersRaw: Record<string, unknown> =
      body.partners && typeof body.partners === 'object' && !Array.isArray(body.partners) ? body.partners : {}

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

    // Release abandoned bundle reservations before the capacity check / registration:
    //   (1) this user's OWN pending bundle(s) for this tournament (any age) — so a retry isn't
    //       blocked by their prior unpaid reservations, and
    //   (2) ANYONE's pending bundle older than 30 min — so stale holds stop falsely filling a
    //       division. (The capacity count below intentionally includes unpaid reservations to
    //       hold spots during the reserve-then-pay window, so only stale ones must be reaped;
    //       the single-division register route already ignores unpaid, so it's unaffected.)
    // Race-safe: a bundle whose Checkout session is already completed/paid is left for the webhook.
    {
      const reapStripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      await reapAbandonedTournamentOrders({ db: service, stripe: reapStripe, tournamentId: params.id, userId: user.id, olderThanMinutes: 0 })
      await reapAbandonedTournamentOrders({ db: service, stripe: reapStripe, tournamentId: params.id, olderThanMinutes: 30 })
    }

    const { data: divisions } = await service
      .from('tournament_divisions')
      .select('id, name, cost_cents, max_entries, format')
      .eq('tournament_id', params.id)
      .in('id', divisionIds)
    const divs = (divisions ?? []) as any[]
    if (divs.length !== divisionIds.length) {
      return NextResponse.json({ error: 'One or more divisions were not found.' }, { status: 400 })
    }
    const divById = new Map(divs.map((d) => [d.id, d]))

    // Normalize partner requests → only doubles divisions actually in the bundle.
    const partnerEmailByDiv = new Map<string, string>()
    for (const [divId, raw] of Object.entries(partnersRaw)) {
      if (!divisionIds.includes(divId) || typeof raw !== 'string' || !raw.trim()) continue
      const d = divById.get(divId)
      if (!d) continue
      if (!isDoublesFormat(d.format)) {
        return NextResponse.json({ error: `Paying for a partner is only available for doubles divisions.` }, { status: 400 })
      }
      partnerEmailByDiv.set(divId, raw.trim().toLowerCase())
    }

    const { data: payerProfile } = await service.from('profiles').select('gender').eq('id', user.id).single()
    const payerGender = (payerProfile as any)?.gender ?? null

    // Existing (non-cancelled) registrations across the chosen divisions — for the
    // already-registered guard and team-slot capacity.
    const { data: existingRegs } = await service
      .from('tournament_registrations')
      .select('id, division_id, user_id, status, registration_type, partner_registration_id')
      .eq('tournament_id', params.id)
      .in('division_id', divisionIds)
      .neq('status', 'cancelled')
    const regsByDiv = new Map<string, any[]>()
    for (const r of existingRegs ?? []) {
      if (!regsByDiv.has(r.division_id)) regsByDiv.set(r.division_id, [])
      regsByDiv.get(r.division_id)!.push(r)
    }

    // Resolve each partner (must have an account, not the payer, not already registered, gender ok).
    const partnerByDiv = new Map<string, { userId: string; email: string }>()
    const profileByEmail = new Map<string, { id: string; gender: string | null } | null>()
    for (const [divId, email] of partnerEmailByDiv) {
      if (!profileByEmail.has(email)) {
        const { data } = await service.from('profiles').select('id, gender').ilike('email', email).maybeSingle()
        profileByEmail.set(email, (data as any) ?? null)
      }
      const prof = profileByEmail.get(email)!
      const d = divById.get(divId)!
      if (!prof) {
        return NextResponse.json({ error: `No Joinzer account found for ${email}. They'll need an account, or you can register them separately.` }, { status: 404 })
      }
      if (prof.id === user.id) {
        return NextResponse.json({ error: `You can't add yourself as your own partner in ${d.name}.` }, { status: 400 })
      }
      if ((regsByDiv.get(divId) ?? []).some((r) => r.user_id === prof.id)) {
        return NextResponse.json({ error: `Your partner is already registered for ${d.name}.` }, { status: 409 })
      }
      const need = GENDER_REQUIRED[d.format]
      if (need && prof.gender !== need) {
        return NextResponse.json({ error: `Your partner doesn't meet the gender requirement for ${d.name}.` }, { status: 400 })
      }
      partnerByDiv.set(divId, { userId: prof.id, email })
    }

    // Payer eligibility + capacity per division.
    for (const d of divs) {
      const rs = regsByDiv.get(d.id) ?? []
      if (rs.some((r) => r.user_id === user.id)) {
        return NextResponse.json({ error: `You're already registered for ${d.name}.` }, { status: 409 })
      }
      const need = GENDER_REQUIRED[d.format]
      if (need && payerGender !== need) {
        return NextResponse.json({ error: `You don't meet the gender requirement for ${d.name}.` }, { status: 400 })
      }
      if (d.max_entries) {
        const registered = rs.filter((r) => r.status === 'registered')
        // A pay-for-both doubles entry (or a singles entry) adds one team slot; a solo-into-
        // doubles entry doesn't fill a slot until it pairs. Reject only when already full.
        if (effectiveTeams(registered) >= d.max_entries) {
          return NextResponse.json({ error: `${d.name} is full.` }, { status: 409 })
        }
      }
    }

    // Per-division base price: a division fee override is flat; otherwise the tier-resolved
    // (early-bird) tournament fee.
    const now = new Date()
    const baseOf = (d: any): number =>
      d.cost_cents != null ? d.cost_cents : resolvePriceCents((tournament as any).cost_cents ?? 0, (tournament as any).price_tiers, now)

    // Bundle discount applies to the player's own division entries only.
    const items: BundleItem[] = divs.map((d) => ({ divisionId: d.id, baseCents: baseOf(d) }))
    const discount = normalizeMultiDivisionDiscount((tournament as any).multi_division_discount)

    // Optional discount code stacks AFTER the bundle discount, on the player's own entries only
    // (partner "pay-for-both" seats stay full price). Validated server-side — the client total is
    // never trusted. Silently ignored if missing/invalid/expired/exhausted (mirrors single-division).
    const rawCode: string | null =
      typeof body.discount_code === 'string' && body.discount_code.trim() ? body.discount_code.trim() : null
    let discountCodeId: string | null = null
    let codeConfig: { type: 'percent' | 'flat'; value: number } | null = null
    let codeDiscountCents = 0
    if (rawCode) {
      const { data: codeRow } = await service
        .from('tournament_discount_codes')
        .select('id, discount_type, discount_value, max_uses, uses_count, expires_at, is_active')
        .eq('tournament_id', params.id)
        .eq('code', rawCode.toUpperCase())
        .eq('is_active', true)
        .maybeSingle()
      if (codeRow) {
        const nowIso = new Date().toISOString()
        const expired = codeRow.expires_at && codeRow.expires_at < nowIso
        const exhausted = codeRow.max_uses != null && codeRow.uses_count >= codeRow.max_uses
        if (!expired && !exhausted) {
          const preCode = computeBundle(items, discount)
          const afterBundle = preCode.subtotalCents - preCode.multiDivDiscountCents
          codeDiscountCents = codeRow.discount_type === 'percent'
            ? Math.round(afterBundle * codeRow.discount_value / 100)
            : Math.min(codeRow.discount_value, afterBundle)
          discountCodeId = codeRow.id
          codeConfig = { type: codeRow.discount_type, value: codeRow.discount_value }
        }
      }
    }

    const bundle = computeBundle(items, discount, codeDiscountCents)
    // Partner seats are full price (a friend's entry isn't an "additional division").
    let partnerTotal = 0
    for (const divId of partnerByDiv.keys()) partnerTotal += baseOf(divById.get(divId))
    const subtotalCents = bundle.subtotalCents + partnerTotal
    const totalCents = bundle.totalCents + partnerTotal
    const isFree = totalCents <= 0

    const { data: order, error: orderErr } = await service
      .from('tournament_orders')
      .insert({
        tournament_id: params.id,
        user_id: user.id,
        status: 'pending',
        subtotal_cents: subtotalCents,
        multi_div_discount_cents: bundle.multiDivDiscountCents,
        code_discount_cents: bundle.codeDiscountCents,
        discount_code_id: discountCodeId,
        total_cents: totalCents,
        // Freeze the discount terms so per-division refunds recompute against what
        // was actually purchased, even if the organizer edits the discount/code later.
        discount_config: discount ?? null,
        code_config: codeConfig,
      })
      .select('id')
      .single()
    if (orderErr || !order) {
      return NextResponse.json({ error: orderErr?.message ?? 'Could not create order' }, { status: 500 })
    }

    // Reserve the payer's own registration in each division. A pay-for-both doubles entry
    // and a singles entry are 'team'; an unpartnered doubles entry is 'solo' (awaiting a match).
    const payStatus = isFree ? 'waived' : 'unpaid'
    const myRows = divs.map((d) => ({
      tournament_id: params.id,
      division_id: d.id,
      user_id: user.id,
      status: 'registered',
      registration_type: partnerByDiv.has(d.id) ? 'team' : (isDoublesFormat(d.format) ? 'solo' : 'team'),
      payment_status: payStatus,
    }))
    const { data: myRegs, error: myErr } = await service
      .from('tournament_registrations')
      .insert(myRows)
      .select('id, division_id')
    if (myErr || !myRegs) {
      await service.from('tournament_orders').delete().eq('id', order.id)
      return NextResponse.json({ error: myErr?.message ?? 'Could not reserve your spots' }, { status: 500 })
    }
    const myRegByDiv = new Map((myRegs as any[]).map((r) => [r.division_id, r.id]))

    // Reserve each covered partner's registration (their own row, this player pays for it).
    const partnerRegByDiv = new Map<string, string>()
    if (partnerByDiv.size > 0) {
      const partnerRows = [...partnerByDiv.entries()].map(([divId, p]) => ({
        tournament_id: params.id,
        division_id: divId,
        user_id: p.userId,
        status: 'registered',
        registration_type: 'team',
        payment_status: payStatus,
      }))
      const { data: partnerRegs, error: pErr } = await service
        .from('tournament_registrations')
        .insert(partnerRows)
        .select('id, division_id')
      if (pErr || !partnerRegs) {
        // Roll back the reservations + order so nothing is left half-created.
        await service.from('tournament_registrations').delete().in('id', [...myRegByDiv.values()])
        await service.from('tournament_orders').delete().eq('id', order.id)
        return NextResponse.json({ error: pErr?.message ?? "Could not reserve your partner's spot" }, { status: 500 })
      }
      for (const r of partnerRegs as any[]) partnerRegByDiv.set(r.division_id, r.id)

      // Cross-link each pair (mirrors register_doubles_pair).
      const links: Promise<unknown>[] = []
      for (const [divId, p] of partnerByDiv) {
        const myId = myRegByDiv.get(divId)!
        const pId = partnerRegByDiv.get(divId)!
        links.push(
          service.from('tournament_registrations').update({ partner_user_id: p.userId, partner_registration_id: pId }).eq('id', myId) as unknown as Promise<unknown>,
          service.from('tournament_registrations').update({ partner_user_id: user.id, partner_registration_id: myId }).eq('id', pId) as unknown as Promise<unknown>,
        )
      }
      await Promise.all(links)
    }

    // Order items: one per own-seat (discounted net) + one per partner-seat (full base).
    const baseByDiv = new Map(bundle.items.map((i) => [i.divisionId, i.baseCents]))
    const netByDiv = new Map(bundle.items.map((i) => [i.divisionId, i.netCents]))
    const itemRows: any[] = divs.map((d) => ({
      order_id: order.id,
      division_id: d.id,
      registration_id: myRegByDiv.get(d.id) ?? null,
      base_cents: baseByDiv.get(d.id) ?? 0,
      net_cents: netByDiv.get(d.id) ?? 0,
      outcome: isFree ? 'registered' : null,
    }))
    for (const [divId] of partnerByDiv) {
      const base = baseByDiv.get(divId) ?? 0
      itemRows.push({
        order_id: order.id,
        division_id: divId,
        registration_id: partnerRegByDiv.get(divId) ?? null,
        base_cents: base,
        net_cents: base,
        outcome: isFree ? 'registered' : null,
      })
    }
    await service.from('tournament_order_items').insert(itemRows)

    if (isFree) {
      // No webhook fires for a free order, so credit the code here if one brought it to $0.
      if (discountCodeId) await service.rpc('increment_discount_uses', { code_id: discountCodeId })
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
    const applicationFeeAmount = connectAccountId ? Math.round(totalCents * 0.05) : undefined
    const seatCount = divs.length + partnerByDiv.size
    const label = partnerByDiv.size > 0
      ? `${tournament.name} — ${divs.length} divisions (${seatCount} entries)`
      : `${tournament.name} — ${divs.length} divisions`

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        { price_data: { currency: 'usd', unit_amount: totalCents, product_data: { name: label } }, quantity: 1 },
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
