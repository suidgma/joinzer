export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { reapAbandonedTournamentOrders } from '@/lib/payments/reapAbandonedOrders'

// Expire abandoned multi-division orders. A 'pending' order older than 30 minutes is
// marked 'expired' and its reserved-but-unpaid registrations are cancelled, freeing the
// held spots. Race-safe: the order update re-checks status='pending' and the reg cancel
// re-checks payment_status='unpaid', so an order the webhook just marked paid is left
// alone. Shared with the on-demand reaper in the bundle orders route. CRON_SECRET-guarded.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { expired, regsCancelled } = await reapAbandonedTournamentOrders({ db, olderThanMinutes: 30 })
  return NextResponse.json({ expired, regsCancelled })
}
