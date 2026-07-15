import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

// Release abandoned multi-division bundle orders: a 'pending' order whose reservations were
// never paid. Cancels its still-unpaid reservations (freeing the held division spots) and
// marks the order 'expired'.
//
// Used in three places:
//   - the daily cron (all tournaments, no Stripe client),
//   - the bundle orders route to unblock a user's own retry (userId, any age), and
//   - the bundle orders route to free capacity held by anyone's stale holds (>30 min).
//
// Race-safety: both writes re-check state (order still 'pending', reg still 'unpaid'), so an
// order the webhook JUST marked paid is left untouched. If a Stripe client is passed, the
// Checkout session is inspected first: a completed/paid session is a real in-flight payment
// and its order is skipped entirely; an open session is expired so it can never be paid after
// we've freed the spot.
export async function reapAbandonedTournamentOrders(opts: {
  db: SupabaseClient
  stripe?: Stripe | null
  tournamentId?: string
  userId?: string
  olderThanMinutes?: number
}): Promise<{ expired: number; regsCancelled: number }> {
  const { db, stripe = null, tournamentId, userId, olderThanMinutes = 30 } = opts
  const cutoff = new Date(Date.now() - Math.max(0, olderThanMinutes) * 60_000).toISOString()

  let query = db
    .from('tournament_orders')
    .select('id, stripe_session_id')
    .eq('status', 'pending')
    .lte('created_at', cutoff)
  if (tournamentId) query = query.eq('tournament_id', tournamentId)
  if (userId) query = query.eq('user_id', userId)

  const { data: stale } = await query
  const orders = (stale ?? []) as { id: string; stripe_session_id: string | null }[]
  if (orders.length === 0) return { expired: 0, regsCancelled: 0 }

  // Decide which orders are safe to release (and expire their abandoned sessions).
  const releasable: string[] = []
  for (const o of orders) {
    if (stripe && o.stripe_session_id) {
      try {
        const sess = await stripe.checkout.sessions.retrieve(o.stripe_session_id)
        // A completed/paid session is a real payment for the webhook — leave this order alone.
        if (sess.status === 'complete' || sess.payment_status === 'paid') continue
        // An open session is genuinely abandoned — expire it so it can never be paid later.
        if (sess.status === 'open') await stripe.checkout.sessions.expire(o.stripe_session_id)
      } catch {
        continue // couldn't inspect/expire → don't risk releasing a possibly-live order
      }
    }
    releasable.push(o.id)
  }
  if (releasable.length === 0) return { expired: 0, regsCancelled: 0 }

  const { data: items } = await db
    .from('tournament_order_items')
    .select('registration_id')
    .in('order_id', releasable)
  const regIds = (items ?? []).map((i: any) => i.registration_id).filter(Boolean)

  let regsCancelled = 0
  if (regIds.length > 0) {
    const { data: cancelled } = await db
      .from('tournament_registrations')
      .update({ status: 'cancelled' })
      .in('id', regIds)
      .eq('payment_status', 'unpaid') // never cancel a paid seat
      .select('id')
    regsCancelled = (cancelled ?? []).length
  }
  await db
    .from('tournament_orders')
    .update({ status: 'expired' })
    .in('id', releasable)
    .eq('status', 'pending') // don't clobber an order the webhook just marked paid

  return { expired: releasable.length, regsCancelled }
}
