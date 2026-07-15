import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getSiteUrl } from '@/lib/utils/site-url'
import { resolvePriceCents } from '@/lib/payments/priceTiers'
import { organizerCanCharge } from '@/lib/payments/paidEventGate'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { registration_id, pay_for_partner, discount_code, partner_email } = await req.json().catch(() => ({}))
    if (!registration_id) return NextResponse.json({ error: 'registration_id required' }, { status: 400 })

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Verify registration belongs to caller and is unpaid
    const { data: reg } = await service
      .from('tournament_registrations')
      .select('id, user_id, payment_status, division_id, partner_user_id')
      .eq('id', registration_id)
      .eq('tournament_id', params.id)
      .single()

    if (!reg || reg.user_id !== user.id) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
    }
    if (reg.payment_status === 'paid' || reg.payment_status === 'comped') {
      return NextResponse.json({ error: 'Already paid' }, { status: 409 })
    }

    // Fetch tournament for price + name + organizer
    const { data: tournament } = await service
      .from('tournaments')
      .select('name, cost_cents, price_tiers, organizer_id')
      .eq('id', params.id)
      .single()

    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

    // Check if organizer has Stripe Connect enabled
    const { data: organizerProfile } = await service
      .from('profiles')
      .select('stripe_connect_account_id, stripe_charges_enabled')
      .eq('id', (tournament as any).organizer_id)
      .single()
    const connectAccountId = (organizerProfile as any)?.stripe_charges_enabled
      ? (organizerProfile as any)?.stripe_connect_account_id
      : null

    // Division-level cost takes precedence over tournament-level cost
    const { data: divisionForCost } = await service
      .from('tournament_divisions')
      .select('cost_cents')
      .eq('id', reg.division_id)
      .single()

    // Division-level fee is a flat override; the tournament fee honors early-bird tiers.
    const unitAmount = (divisionForCost as any)?.cost_cents != null
      ? (divisionForCost as any).cost_cents
      : resolvePriceCents((tournament as any).cost_cents ?? 0, (tournament as any).price_tiers, new Date())
    if (unitAmount <= 0) {
      // Free — mark both as waived
      await service.from('tournament_registrations').update({ payment_status: 'waived' }).eq('id', registration_id)
      if (pay_for_partner && reg.partner_user_id) {
        const { data: partnerReg } = await service
          .from('tournament_registrations')
          .select('id')
          .eq('division_id', reg.division_id)
          .eq('user_id', reg.partner_user_id)
          .eq('tournament_id', params.id)
          .maybeSingle()
        if (partnerReg) {
          await service.from('tournament_registrations').update({ payment_status: 'waived' }).eq('id', partnerReg.id)
        }
      }
      return NextResponse.json({ free: true })
    }

    // Backstop: an unapproved organizer can't collect money even if a paid event slipped past the create/edit gate.
    if (!(await organizerCanCharge(service, (tournament as any).organizer_id))) {
      return NextResponse.json({ error: "This organizer isn't set up to accept payments yet." }, { status: 403 })
    }

    const { data: division } = await service
      .from('tournament_divisions')
      .select('name')
      .eq('id', reg.division_id)
      .single()

    // Resolve partner for "pay for both" — two paths:
    // A) partner_email provided (no partner linked yet): look up by email, no existing reg required
    // B) partner already cross-linked on the registration (legacy / invite-accept flow)
    let partnerRegId: string | null = null      // existing partner reg to mark paid
    let partnerUserId: string | null = null     // new partner user_id (Option A)
    let partnerEmailMeta: string | null = null  // stored in session metadata for webhook

    if (pay_for_partner) {
      if (partner_email && !reg.partner_user_id) {
        // Option A: captain pays for partner by email
        const normalised = (partner_email as string).trim().toLowerCase()
        const { data: partnerProfile } = await service
          .from('profiles')
          .select('id')
          .eq('email', normalised)
          .maybeSingle()
        if (!partnerProfile) {
          return NextResponse.json(
            { error: `No Joinzer account found for ${normalised}. They need to create an account first.` },
            { status: 404 }
          )
        }
        if (partnerProfile.id === user.id) {
          return NextResponse.json({ error: 'You cannot add yourself as a partner' }, { status: 400 })
        }
        const { data: alreadyReg } = await service
          .from('tournament_registrations')
          .select('id')
          .eq('division_id', reg.division_id)
          .eq('user_id', partnerProfile.id)
          .eq('tournament_id', params.id)
          .neq('status', 'cancelled')
          .maybeSingle()
        if (alreadyReg) {
          return NextResponse.json(
            { error: 'This player is already registered in this division' },
            { status: 409 }
          )
        }
        partnerUserId = partnerProfile.id
        partnerEmailMeta = normalised
      } else if (reg.partner_user_id) {
        // Option B: partner already linked, pay for their existing registration
        const { data: partnerReg } = await service
          .from('tournament_registrations')
          .select('id, payment_status')
          .eq('division_id', reg.division_id)
          .eq('user_id', reg.partner_user_id)
          .eq('tournament_id', params.id)
          .maybeSingle()
        if (partnerReg?.payment_status === 'paid' || partnerReg?.payment_status === 'comped') {
          return NextResponse.json(
            { error: "Your partner's registration has already been paid", code: 'PARTNER_ALREADY_PAID' },
            { status: 409 }
          )
        }
        if (partnerReg) partnerRegId = partnerReg.id
      }
    }

    // Validate discount code if provided
    let discountedAmount = unitAmount
    let discountCodeId: string | null = null
    if (discount_code?.trim()) {
      const { data: codeRow } = await service
        .from('tournament_discount_codes')
        .select('id, discount_type, discount_value, max_uses, uses_count, expires_at, is_active')
        .eq('tournament_id', params.id)
        .eq('code', discount_code.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle()
      if (codeRow) {
        const now = new Date().toISOString()
        const expired = codeRow.expires_at && codeRow.expires_at < now
        const exhausted = codeRow.max_uses != null && codeRow.uses_count >= codeRow.max_uses
        if (!expired && !exhausted) {
          discountCodeId = codeRow.id
          if (codeRow.discount_type === 'percent') {
            discountedAmount = Math.round(unitAmount * (1 - codeRow.discount_value / 100))
          } else {
            discountedAmount = Math.max(0, unitAmount - codeRow.discount_value)
          }
        }
      }
    }

    // If discounted to free, mark waived
    if (discountedAmount <= 0) {
      await service.from('tournament_registrations').update({ payment_status: 'waived' }).eq('id', registration_id)
      if (partnerRegId) {
        await service.from('tournament_registrations').update({ payment_status: 'waived' }).eq('id', partnerRegId)
      }
      if (discountCodeId) {
        await service.rpc('increment_discount_uses', { code_id: discountCodeId })
      }
      return NextResponse.json({ free: true })
    }

    const payingForTwo = !!(partnerRegId || partnerUserId)
    const quantity = payingForTwo ? 2 : 1
    const label = payingForTwo
      ? `${tournament.name} — ${division?.name ?? 'Entry Fee'} (2 players)`
      : `${tournament.name} — ${division?.name ?? 'Entry Fee'}`

    const siteUrl = getSiteUrl()

    // 5% platform fee when routing through Connect
    const applicationFeeAmount = connectAccountId
      ? Math.round(discountedAmount * quantity * 0.05)
      : undefined

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: discountedAmount,
            product_data: {
              name: discountCodeId
                ? `${label} (discount applied)`
                : label,
            },
          },
          quantity,
        },
      ],
      ...(connectAccountId ? {
        payment_intent_data: {
          application_fee_amount: applicationFeeAmount,
          // on_behalf_of makes the connected account the merchant of record:
          //   • their statement descriptor shows on the customer's card statement
          //   • their EIN is on the 1099-K (not Joinzer's)
          //   • their dashboard owns the charge
          // Must match transfer_data.destination.
          on_behalf_of: connectAccountId,
          transfer_data: { destination: connectAccountId },
        },
      } : {}),
      metadata: {
        registration_id,
        tournament_id: params.id,
        partner_registration_id: partnerRegId ?? '',
        partner_user_id: partnerUserId ?? '',
        partner_email: partnerEmailMeta ?? '',
        discount_code_id: discountCodeId ?? '',
      },
      success_url: `${siteUrl}/tournaments/${params.id}?payment=success`,
      cancel_url: `${siteUrl}/tournaments/${params.id}?payment=cancelled`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: err?.message ?? 'Checkout failed' }, { status: 500 })
  }
}
