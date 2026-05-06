import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { registration_id } = await req.json().catch(() => ({}))
  if (!registration_id) return NextResponse.json({ error: 'registration_id required' }, { status: 400 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Verify registration belongs to caller and is unpaid
  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, payment_status, division_id')
    .eq('id', registration_id)
    .eq('tournament_id', params.id)
    .single()

  if (!reg || reg.user_id !== user.id) {
    return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  }
  if (reg.payment_status === 'paid') {
    return NextResponse.json({ error: 'Already paid' }, { status: 409 })
  }

  // Fetch tournament for price + name
  const { data: tournament } = await service
    .from('tournaments')
    .select('name, cost_cents')
    .eq('id', params.id)
    .single()

  if (!tournament) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })

  const amount = tournament.cost_cents ?? 0
  if (amount <= 0) {
    // Free — just mark paid directly
    await service
      .from('tournament_registrations')
      .update({ payment_status: 'waived' })
      .eq('id', registration_id)
    return NextResponse.json({ free: true })
  }

  const { data: division } = await service
    .from('tournament_divisions')
    .select('name')
    .eq('id', reg.division_id)
    .single()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinzer.com'

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amount,
          product_data: {
            name: `${tournament.name} — ${division?.name ?? 'Entry Fee'}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      registration_id,
      tournament_id: params.id,
    },
    success_url: `${siteUrl}/tournaments/${params.id}?payment=success`,
    cancel_url: `${siteUrl}/tournaments/${params.id}?payment=cancelled`,
  })

  return NextResponse.json({ url: session.url })
}
