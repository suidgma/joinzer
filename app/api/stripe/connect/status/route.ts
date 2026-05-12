import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'

export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await service
    .from('profiles')
    .select('stripe_connect_account_id, stripe_charges_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_connect_account_id) {
    return NextResponse.json({ connected: false, chargesEnabled: false })
  }

  // Sync latest status from Stripe
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id)
  const chargesEnabled = account.charges_enabled ?? false

  if (chargesEnabled !== profile.stripe_charges_enabled) {
    await service.from('profiles').update({ stripe_charges_enabled: chargesEnabled }).eq('id', user.id)
  }

  return NextResponse.json({
    connected: true,
    chargesEnabled,
    accountId: profile.stripe_connect_account_id,
  })
}
