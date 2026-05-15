import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: league } = await service
      .from('leagues')
      .select('id, name, cost_cents, registration_status, registration_closes_at, max_players')
      .eq('id', params.id)
      .single()

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    if ((league as any).registration_closes_at && new Date() > new Date((league as any).registration_closes_at)) {
      return NextResponse.json({ error: 'Registration is closed' }, { status: 400 })
    }

    if (league.registration_status !== 'open' && league.registration_status !== 'waitlist_only') {
      return NextResponse.json({ error: 'Registration is not open' }, { status: 400 })
    }

    const costCents = (league as any).cost_cents ?? 0
    if (costCents <= 0) return NextResponse.json({ error: 'This league is free — use the regular register flow' }, { status: 400 })

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

    // Determine join status (registered vs waitlist) based on capacity
    const { count } = await service
      .from('league_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', params.id)
      .eq('status', 'registered')

    const isFull = (league as any).max_players != null && (count ?? 0) >= (league as any).max_players
    const joinAs = isFull ? 'waitlist' : 'registered'

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'

    const stripeSession = await stripe.checkout.sessions.create({
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
      },
      success_url: `${siteUrl}/compete/leagues/${params.id}?payment=success`,
      cancel_url: `${siteUrl}/compete/leagues/${params.id}?payment=cancelled`,
    })

    return NextResponse.json({ url: stripeSession.url })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
