import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { getSiteUrl } from '@/lib/utils/site-url'

export async function POST(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Gate: only organizers approved for paid events may set up payouts (book-a-call approval).
  const { data: profile } = await service
    .from('profiles')
    .select('stripe_connect_account_id, can_create_paid_events')
    .eq('id', user.id)
    .single()

  if (!profile?.can_create_paid_events) {
    return NextResponse.json(
      { error: "Payments aren't enabled on your account yet — book a quick call and we'll set you up.", needsApproval: true },
      { status: 403 },
    )
  }

  let accountId = profile?.stripe_connect_account_id

  if (!accountId) {
    const { data: authUser } = await service.auth.admin.getUserById(user.id)
    const account = await stripe.accounts.create({
      type: 'express',
      email: authUser?.user?.email,
      capabilities: { transfers: { requested: true } },
    })
    accountId = account.id
    await service.from('profiles').update({ stripe_connect_account_id: accountId }).eq('id', user.id)
  }

  const siteUrl = getSiteUrl()
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${siteUrl}/settings/payouts?refresh=1`,
    return_url: `${siteUrl}/settings/payouts?connected=1`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: link.url, accountId })
}
