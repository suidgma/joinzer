import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Pulls fresh status from Stripe and syncs cached flags on profiles.
// Called when the organizer returns from onboarding, or any time the UI
// needs to know whether they can collect payouts.
export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await service
    .from('profiles')
    .select('stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  if (!profile.stripe_account_id) {
    return NextResponse.json({ connected: false, charges_enabled: false, payouts_enabled: false })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  let account: Stripe.Account
  try {
    account = await stripe.accounts.retrieve(profile.stripe_account_id)
  } catch {
    return NextResponse.json(
      { connected: true, charges_enabled: false, payouts_enabled: false, error: 'Stripe account not retrievable' },
      { status: 200 }
    )
  }

  // Sync cached flags so checkout doesn't have to round-trip Stripe on every purchase.
  await service.from('profiles').update({
    stripe_charges_enabled: account.charges_enabled ?? false,
    stripe_payouts_enabled: account.payouts_enabled ?? false,
  }).eq('id', user.id)

  return NextResponse.json({
    connected: true,
    charges_enabled: !!account.charges_enabled,
    payouts_enabled: !!account.payouts_enabled,
    details_submitted: !!account.details_submitted,
    requirements: account.requirements?.currently_due ?? [],
  })
}
