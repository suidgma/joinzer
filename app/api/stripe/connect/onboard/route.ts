import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Stripe from 'stripe'

export async function POST(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get or create a Connect account
  const { data: profile } = await service
    .from('profiles')
    .select('stripe_connect_account_id')
    .eq('id', user.id)
    .single()

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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${siteUrl}/settings/payouts?refresh=1`,
    return_url: `${siteUrl}/settings/payouts?connected=1`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: link.url, accountId })
}
