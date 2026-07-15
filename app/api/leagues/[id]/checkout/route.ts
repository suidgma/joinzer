import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getSiteUrl } from '@/lib/utils/site-url'
import { resolvePriceCents } from '@/lib/payments/priceTiers'
import { organizerCanCharge } from '@/lib/payments/paidEventGate'

const DOUBLES_FORMATS = ['mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles']

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const partnerEmail: string | null = body.partner_email ?? null

    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: league } = await service
      .from('leagues')
      .select('id, name, cost_cents, price_tiers, format, registration_status, registration_closes_at, max_players, created_by')
      .eq('id', params.id)
      .single()

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    if ((league as any).registration_closes_at && new Date() > new Date((league as any).registration_closes_at)) {
      return NextResponse.json({ error: 'Registration is closed' }, { status: 400 })
    }

    if (league.registration_status !== 'open' && league.registration_status !== 'waitlist_only') {
      return NextResponse.json({ error: 'Registration is not open' }, { status: 400 })
    }

    const costCents = resolvePriceCents((league as any).cost_cents ?? 0, (league as any).price_tiers, new Date())
    if (costCents <= 0) return NextResponse.json({ error: 'This league is free — use the regular register flow' }, { status: 400 })

    // Backstop: an unapproved organizer can't collect money even if a paid league slipped past the create/edit gate.
    if (!(await organizerCanCharge(service, (league as any).created_by))) {
      return NextResponse.json({ error: "This organizer isn't set up to accept payments yet." }, { status: 403 })
    }

    const registrationType: 'team' | 'solo' = body.registration_type === 'solo' ? 'solo' : 'team'
    const isDoublesTeam = DOUBLES_FORMATS.includes(league.format) && registrationType === 'team'

    if (isDoublesTeam && !partnerEmail) {
      return NextResponse.json({ error: 'Partner email is required for doubles team registration' }, { status: 400 })
    }

    // Check if already registered/paid
    const { data: existing } = await service
      .from('league_registrations')
      .select('status, payment_status')
      .eq('league_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing?.payment_status === 'paid' && existing?.status === 'registered') {
      return NextResponse.json({ error: 'Already registered and paid' }, { status: 409 })
    }
    if (existing?.status === 'pending_partner') {
      return NextResponse.json({ error: 'Already waiting for partner confirmation' }, { status: 409 })
    }

    // Capacity check — pending_partner holds a spot
    const { count } = await service
      .from('league_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', params.id)
      .in('status', ['registered', 'pending_partner'])

    const isFull = (league as any).max_players != null && (count ?? 0) >= (league as any).max_players
    const joinAs = isFull ? 'waitlist' : 'registered'

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const siteUrl = getSiteUrl()

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: costCents,
          product_data: { name: `${league.name} — Registration Fee` },
        },
        quantity: 1,
      }],
      metadata: {
        event_type: 'league',
        league_id: params.id,
        user_id: user.id,
        join_as: joinAs,
        registration_type: registrationType,
        ...(partnerEmail ? { partner_email: partnerEmail } : {}),
      },
      success_url: `${siteUrl}/leagues/${params.id}?payment=success`,
      cancel_url: `${siteUrl}/leagues/${params.id}?payment=cancelled`,
    }

    // Auth-and-capture for doubles team: hold captain's funds until partner pays
    if (isDoublesTeam) {
      sessionParams.payment_intent_data = { capture_method: 'manual' }
    }

    const stripeSession = await stripe.checkout.sessions.create(sessionParams)
    return NextResponse.json({ url: stripeSession.url })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
