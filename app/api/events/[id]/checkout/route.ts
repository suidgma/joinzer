import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: event } = await service
      .from('events')
      .select('id, title, starts_at, price_cents, status, max_players, session_type')
      .eq('id', params.id)
      .single()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.status === 'cancelled' || event.status === 'completed') {
      return NextResponse.json({ error: 'Event is not open for joining' }, { status: 409 })
    }

    const priceCents = event.price_cents ?? 0
    if (priceCents <= 0) return NextResponse.json({ error: 'This event is free — use the regular join flow' }, { status: 400 })

    // Check they haven't already paid
    const { data: existing } = await service
      .from('event_participants')
      .select('participant_status, payment_status')
      .eq('event_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing?.payment_status === 'paid') {
      return NextResponse.json({ error: 'Already paid for this session' }, { status: 409 })
    }
    if (existing?.participant_status === 'joined' || existing?.participant_status === 'waitlist') {
      return NextResponse.json({ error: 'Already registered for this session' }, { status: 409 })
    }

    // Check capacity — let Stripe handle it but show error early
    const { count } = await service
      .from('event_participants')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', params.id)
      .eq('participant_status', 'joined')

    const isFull = (count ?? 0) >= event.max_players

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'

    const sessionDate = new Date(event.starts_at).toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short', month: 'short', day: 'numeric',
    })

    const label = `${event.title} — ${sessionDate}`

    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: priceCents,
          product_data: { name: label },
        },
        quantity: 1,
      }],
      metadata: {
        event_type: 'session',
        event_id: params.id,
        user_id: user.id,
        join_as: isFull ? 'waitlist' : 'joined',
      },
      success_url: `${siteUrl}/events/${params.id}?payment=success`,
      cancel_url: `${siteUrl}/events/${params.id}?payment=cancelled`,
    })

    return NextResponse.json({ url: stripeSession.url })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
