import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { createNotification } from '@/lib/notifications/create'
import { getSiteUrl } from '@/lib/utils/site-url'

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('league_partner_invitations')
    .select('id, league_id, captain_registration_id, invitee_user_id, status, expires_at')
    .eq('token', token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (inv.status !== 'pending') {
    return NextResponse.json({ error: 'Invitation is no longer pending', status: inv.status }, { status: 409 })
  }
  if (new Date() > new Date(inv.expires_at)) {
    return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
  }
  if (inv.invitee_user_id && inv.invitee_user_id !== user.id) {
    return NextResponse.json({ error: 'This invitation is not for your account' }, { status: 403 })
  }

  const { data: league } = await service
    .from('leagues')
    .select('id, name, cost_cents')
    .eq('id', inv.league_id)
    .single()

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const costCents = (league as any).cost_cents ?? 0
  const siteUrl = getSiteUrl()

  if (costCents > 0) {
    // Guard: block if user already has any non-cancelled registration in this league.
    // Using .limit(1) array select (not .maybeSingle) so two stale rows can't 500 this route.
    const { data: existingRegs } = await service
      .from('league_registrations')
      .select('id, status')
      .eq('league_id', inv.league_id)
      .eq('user_id', user.id)
      .neq('status', 'cancelled')
      .limit(1)

    if (existingRegs && existingRegs.length > 0) {
      return NextResponse.json(
        { error: 'You already have an active registration in this league. Cancel it before accepting a partner invitation.' },
        { status: 409 }
      )
    }

    // Paid league — partner pays via Stripe; webhook handles final state
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
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
        event_type: 'league_partner',
        invitation_id: inv.id,
        league_id: inv.league_id,
        user_id: user.id,
      },
      success_url: `${siteUrl}/leagues/${inv.league_id}?payment=success`,
      cancel_url: `${siteUrl}/leagues/${inv.league_id}/partner-accept?token=${token}`,
    })
    return NextResponse.json({ url: stripeSession.url })
  }

  // Free league — accept inline
  const { data: existing } = await service
    .from('league_registrations')
    .select('id')
    .eq('league_id', inv.league_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    // Free-only branch — paid partners are created by the Stripe webhook as 'paid'.
    const { error } = await service.from('league_registrations').insert({
      league_id: inv.league_id,
      user_id: user.id,
      status: 'registered',
      payment_status: 'waived',
      registration_type: 'team',
      registered_at: new Date().toISOString(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: partnerReg } = await service
    .from('league_registrations')
    .select('id')
    .eq('league_id', inv.league_id)
    .eq('user_id', user.id)
    .single()

  const { data: captainReg } = await service
    .from('league_registrations')
    .select('user_id')
    .eq('id', inv.captain_registration_id)
    .single()

  if (partnerReg?.id) {
    await Promise.all([
      service.from('league_registrations').update({
        status: 'registered',
        partner_user_id: user.id,
        partner_registration_id: partnerReg.id,
      }).eq('id', inv.captain_registration_id),
      service.from('league_registrations').update({
        partner_user_id: captainReg?.user_id ?? null,
        partner_registration_id: inv.captain_registration_id,
      }).eq('id', partnerReg.id),
      service.from('league_partner_invitations').update({ status: 'accepted' }).eq('id', inv.id),
    ])

    // Notify the captain that their partner accepted
    if (captainReg?.user_id) {
      const { data: acceptingProfile } = await service
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .single()

      await createNotification({
        recipientId: captainReg.user_id,
        surface: 'league',
        surfaceId: inv.league_id,
        kind: 'league_partner_accepted',
        title: `${acceptingProfile?.name ?? 'Your partner'} accepted your invite`,
        body: `${league.name} — you're registered as a team.`,
        url: `/leagues/${inv.league_id}`,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
