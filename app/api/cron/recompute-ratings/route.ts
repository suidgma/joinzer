export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { recomputeAllRatings } from '@/lib/rating/recompute'

// Nightly: recompute all Joinzer ratings from the full match history (idempotent full
// replace → player_ratings + profiles cache). Protected by CRON_SECRET (Vercel sends it
// automatically for scheduled crons). See docs/phases/rating-engine-phase2.md §7.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  try {
    const summary = await recomputeAllRatings(db, { asOf: new Date().toISOString() })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
