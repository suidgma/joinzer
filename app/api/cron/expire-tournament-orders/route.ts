export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

// Expire abandoned multi-division orders. A 'pending' order older than 30 minutes is
// marked 'expired' and its reserved-but-unpaid registrations are cancelled, freeing the
// held spots. Race-safe: the order update re-checks status='pending' and the reg cancel
// re-checks payment_status='unpaid', so an order the webhook just marked paid is left
// alone. CRON_SECRET-guarded.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString()

  const { data: stale } = await db
    .from('tournament_orders')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
  const orderIds = (stale ?? []).map((o: any) => o.id)
  if (orderIds.length === 0) return NextResponse.json({ expired: 0 })

  const { data: items } = await db
    .from('tournament_order_items')
    .select('registration_id')
    .in('order_id', orderIds)
  const regIds = (items ?? []).map((i: any) => i.registration_id).filter(Boolean)
  if (regIds.length > 0) {
    await db
      .from('tournament_registrations')
      .update({ status: 'cancelled' })
      .in('id', regIds)
      .eq('payment_status', 'unpaid') // never cancel a paid registration
  }
  await db
    .from('tournament_orders')
    .update({ status: 'expired' })
    .in('id', orderIds)
    .eq('status', 'pending') // don't clobber an order the webhook just marked paid

  return NextResponse.json({ expired: orderIds.length, regsCancelled: regIds.length })
}
