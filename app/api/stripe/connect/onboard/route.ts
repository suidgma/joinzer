import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Creates a Stripe Express account if the organizer doesn't have one yet,
// then returns a short-lived onboarding URL. The Stripe-hosted flow handles
// identity verification, bank account, ToS acceptance.
export async function POST(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await service
    .from('profiles')
    .select('id, email, name, stripe_account_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let accountId = profile.stripe_account_id as string | null

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: profile.email ?? user.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        product_description: 'Pickleball tournament registrations',
      },
      metadata: { user_id: user.id },
    })
    accountId = account.id
    await service.from('profiles').update({ stripe_account_id: accountId }).eq('id', user.id)
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${siteUrl}/settings/payouts?refresh=1`,
    return_url: `${siteUrl}/settings/payouts?connected=1`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: accountLink.url, accountId })
}
