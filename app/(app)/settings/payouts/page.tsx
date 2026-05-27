import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Stripe from 'stripe'
import PayoutsPanel, { type Status } from './_components/PayoutsPanel'

export const dynamic = 'force-dynamic'

export default async function PayoutsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profile } = await service
    .from('profiles')
    .select('stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled')
    .eq('id', user.id)
    .single()

  let status: Status = {
    connected: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    requirementsCount: 0,
  }

  if (profile?.stripe_account_id) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      const account = await stripe.accounts.retrieve(profile.stripe_account_id)
      status = {
        connected: true,
        chargesEnabled: !!account.charges_enabled,
        payoutsEnabled: !!account.payouts_enabled,
        requirementsCount: account.requirements?.currently_due?.length ?? 0,
      }
      // Keep cached flags in sync so the checkout route can rely on them.
      if (
        profile.stripe_charges_enabled !== status.chargesEnabled ||
        profile.stripe_payouts_enabled !== status.payoutsEnabled
      ) {
        await service.from('profiles').update({
          stripe_charges_enabled: status.chargesEnabled,
          stripe_payouts_enabled: status.payoutsEnabled,
        }).eq('id', user.id)
      }
    } catch {
      status = { connected: true, chargesEnabled: false, payoutsEnabled: false, requirementsCount: 0 }
    }
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/" className="text-brand-muted text-sm">← Home</Link>
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Payouts</h1>
        <p className="text-sm text-brand-muted mt-1">
          Connect your Stripe account to receive registration fees directly. Joinzer keeps a small platform fee per registration.
        </p>
      </div>
      <PayoutsPanel status={status} />
    </main>
  )
}
