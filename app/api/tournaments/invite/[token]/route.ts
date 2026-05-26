import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// GET — return invitation details (for the acceptance page to display)
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('tournament_team_invitations')
    .select(`
      id, status, invitee_email,
      tournament:tournaments!tournament_id(id, name, start_date),
      division:tournament_divisions!division_id(id, name, cost_cents),
      inviter_reg:tournament_registrations!inviter_registration_id(
        user_id, team_name
      )
    `)
    .eq('token', params.token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  // Fetch inviter name separately (flat query avoids PostgREST FK hint issues)
  const inviterReg = inv.inviter_reg as any
  const { data: inviterProfile } = await service
    .from('profiles')
    .select('name')
    .eq('id', inviterReg?.user_id)
    .maybeSingle()

  return NextResponse.json({
    invitation: {
      id: inv.id,
      status: inv.status,
      invitee_email: inv.invitee_email,
      tournament: inv.tournament,
      division: inv.division,
      inviter_name: inviterProfile?.name ?? 'Unknown',
      team_name: inviterReg?.team_name ?? null,
    }
  })
}

// POST — accept or decline
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json().catch(() => ({}))
  if (!['accept', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('tournament_team_invitations')
    .select('id, status, tournament_id, division_id, inviter_registration_id, invitee_email')
    .eq('token', params.token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (inv.status !== 'pending') return NextResponse.json({ error: `Invitation already ${inv.status}` }, { status: 409 })

  if (action === 'decline') {
    await service
      .from('tournament_team_invitations')
      .update({ status: 'declined', invitee_user_id: user.id })
      .eq('id', inv.id)
    return NextResponse.json({ ok: true, action: 'declined' })
  }

  // Accept — check invitee not already registered in this division
  const { data: existing } = await service
    .from('tournament_registrations')
    .select('id')
    .eq('division_id', inv.division_id)
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'You are already registered for this division' }, { status: 409 })
  }

  // Count active registered slots (same filter as capacity check in register route)
  const { count } = await service
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('division_id', inv.division_id)
    .eq('status', 'registered')
    .in('payment_status', ['paid', 'waived', 'comped'])

  const [{ data: division }, { data: tournament }] = await Promise.all([
    service.from('tournament_divisions')
      .select('max_entries, waitlist_enabled, status, cost_cents, name')
      .eq('id', inv.division_id)
      .single(),
    service.from('tournaments')
      .select('id, name, start_date, location_id, organizer_id, cost_cents')
      .eq('id', inv.tournament_id)
      .single(),
  ])

  if (!division || division.status === 'closed') {
    return NextResponse.json({ error: 'Division is closed' }, { status: 400 })
  }
  if (!tournament) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  }

  const isFull = (count ?? 0) >= division.max_entries
  if (isFull && !division.waitlist_enabled) {
    return NextResponse.json({ error: 'Division is full' }, { status: 400 })
  }

  const regStatus = isFull ? 'waitlisted' : 'registered'
  // division.cost_cents is nullable; tournament.cost_cents is NOT NULL — tournament is the safe fallback.
  const costCents: number = (division as any).cost_cents ?? (tournament as any).cost_cents ?? 0

  // ── Paid registered path → Stripe Checkout ────────────────────────────────
  // Waitlisted always inserts inline — no charge for a queued spot.
  if (regStatus === 'registered') {
    if (costCents > 0) {
      // Atomic claim: sets invitee_user_id so only one Stripe session is created per invite.
      // Same user can re-claim their own (abandoned-payment re-entry).
      // A different user winning the atomic UPDATE here would block this one — correct, tokens are per-invitee.
      const { data: claimedRows, error: claimErr } = await service
        .from('tournament_team_invitations')
        .update({ invitee_user_id: user.id })
        .eq('id', inv.id)
        .eq('status', 'pending')
        .or(`invitee_user_id.is.null,invitee_user_id.eq.${user.id}`)
        .select('id')

      if (claimErr || !claimedRows || claimedRows.length === 0) {
        return NextResponse.json({ error: 'Invitation already claimed' }, { status: 409 })
      }

      const { data: organizerProfile } = await service
        .from('profiles')
        .select('stripe_connect_account_id, stripe_charges_enabled')
        .eq('id', (tournament as any).organizer_id)
        .single()
      const connectAccountId = (organizerProfile as any)?.stripe_charges_enabled
        ? (organizerProfile as any)?.stripe_connect_account_id
        : null

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
      const stripeSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: costCents,
            product_data: {
              name: `${tournament.name} — ${(division as any).name} (Partner Registration)`,
            },
          },
          quantity: 1,
        }],
        ...(connectAccountId ? {
          payment_intent_data: {
            application_fee_amount: Math.round(costCents * 0.05),
            transfer_data: { destination: connectAccountId },
          },
        } : {}),
        metadata: {
          event_type: 'tournament_partner_accept',
          invitation_id: inv.id,
          tournament_id: inv.tournament_id,
          division_id: inv.division_id,
          user_id: user.id,
          inviter_registration_id: inv.inviter_registration_id,
          reg_status: regStatus,
        },
        success_url: `${siteUrl}/tournaments/${inv.tournament_id}?payment=success`,
        cancel_url: `${siteUrl}/tournaments/invite/${params.token}?payment=cancelled`,
      })
      return NextResponse.json({ url: stripeSession.url })
    }
    // costCents === 0: fall through to inline INSERT with payment_status: 'waived'
  }

  // ── Free registered or waitlisted → transactional RPC ───────────────────────────
  // Fixes stuck-state bug: previously invite flipped to 'accepted' before registration
  // INSERT; if INSERT failed, invite was stuck accepted with no registration and no retry.
  // RPC makes both atomic: failure on either rolls back both, invitation stays 'pending'.
  const { data: rpcResult, error: rpcErr } = await service.rpc('accept_free_partner_invite', {
    p_token:   params.token,
    p_user_id: user.id,
  })

  if (rpcErr) {
    const msg = rpcErr.message ?? ''
    if (msg.includes('invitation_not_claimable'))
      return NextResponse.json({ error: 'Invitation already accepted or expired' }, { status: 409 })
    if (msg.includes('division_closed'))
      return NextResponse.json({ error: 'Division is closed' }, { status: 400 })
    if (msg.includes('already_registered'))
      return NextResponse.json({ error: 'You are already registered for this division' }, { status: 409 })
    if (msg.includes('division_full'))
      return NextResponse.json({ error: 'Division is full' }, { status: 400 })
    if (msg.includes('inviter_registration_gone'))
      return NextResponse.json({ error: 'Your partner is no longer registered — contact the organizer' }, { status: 409 })
    return NextResponse.json({ error: rpcErr.message ?? 'Registration failed' }, { status: 500 })
  }

  const rpc = rpcResult as { reg_id: string; tournament_id: string; status: string }

  return NextResponse.json({
    ok: true,
    action: 'accepted',
    tournament_id: rpc.tournament_id,
    registration_id: rpc.reg_id,
  })
}
