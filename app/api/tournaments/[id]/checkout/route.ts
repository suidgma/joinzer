import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { registration_id, pay_for_partner } = await req.json().catch(() => ({}))
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
    if (reg.payment_status === 'paid') {
      return NextResponse.json({ error: 'Already paid' }, { status: 409 })
    }

    // Fetch tournament + organizer's Stripe Connect status
    const { data: tournament } = await service
      .from('tournaments')
      .select('name, cost_cents, organizer_id, organizer:profiles!organizer_id(stripe_account_id, stripe_charges_enabled)')
      .eq('id', params.id)
      .single()

    if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

    type OrgEmbed = { stripe_account_id: string | null; stripe_charges_enabled: boolean }
    const rawOrg = (tournament as unknown as { organizer: OrgEmbed | OrgEmbed[] | null }).organizer
    const organizer: OrgEmbed | null = Array.isArray(rawOrg) ? (rawOrg[0] ?? null) : rawOrg
    const useConnect = !!(organizer?.stripe_account_id && organizer.stripe_charges_enabled)

    // Division-level cost takes precedence over tournament-level cost
    const { data: divisionForCost } = await service
      .from('tournament_divisions')
      .select('cost_cents')
      .eq('id', reg.division_id)
      .single()

    const unitAmount = (divisionForCost as any)?.cost_cents != null
      ? (divisionForCost as any).cost_cents
      : ((tournament as any).cost_cents ?? 0)
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

    const { data: division } = await service
      .from('tournament_divisions')
      .select('name')
      .eq('id', reg.division_id)
      .single()

    // Find partner registration if paying for both
    let partnerRegId: string | null = null
    if (pay_for_partner && reg.partner_user_id) {
      const { data: partnerReg } = await service
        .from('tournament_registrations')
        .select('id, payment_status')
        .eq('division_id', reg.division_id)
        .eq('user_id', reg.partner_user_id)
        .eq('tournament_id', params.id)
        .maybeSingle()
      if (partnerReg && partnerReg.payment_status !== 'paid') {
        partnerRegId = partnerReg.id
      }
    }

    const quantity = partnerRegId ? 2 : 1
    const label = partnerRegId
      ? `${tournament.name} — ${division?.name ?? 'Entry Fee'} (2 players)`
      : `${tournament.name} — ${division?.name ?? 'Entry Fee'}`

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'

    // Application fee: configurable platform cut when payments route to the organizer.
    // Fixed cents per registration line item, defaulting to $0.99.
    const feePerItemCents = Number(process.env.JOINZER_APPLICATION_FEE_CENTS ?? '99')
    const applicationFeeAmount = useConnect ? feePerItemCents * quantity : 0

    const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            product_data: { name: label },
          },
          quantity,
        },
      ],
      metadata: {
        registration_id,
        tournament_id: params.id,
        partner_registration_id: partnerRegId ?? '',
      },
      success_url: `${siteUrl}/tournaments/${params.id}?payment=success`,
      cancel_url: `${siteUrl}/tournaments/${params.id}?payment=cancelled`,
    }

    if (useConnect && organizer?.stripe_account_id) {
      checkoutPayload.payment_intent_data = {
        application_fee_amount: applicationFeeAmount,
        // on_behalf_of makes the connected account the merchant of record:
        //   • their statement descriptor shows on the customer's card
        //   • their EIN is on the 1099-K (not Joinzer's)
        //   • their dashboard owns the charge
        // Must match transfer_data.destination.
        on_behalf_of: organizer.stripe_account_id,
        transfer_data: { destination: organizer.stripe_account_id },
      }
    }

    const session = await stripe.checkout.sessions.create(checkoutPayload)

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: err?.message ?? 'Checkout failed' }, { status: 500 })
  }
}
