import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { voidCaptainHold } from '@/lib/leagues/partner'
import { assertCronSecret } from '@/lib/cron/auth'

export const dynamic = 'force-dynamic'
// Each expired invitation does a Stripe cancel + an email, so the loop needs the same
// headroom as the other fan-out crons.
export const maxDuration = 60

// Scheduled daily at 12:00 UTC (vercel.json). Invitations expire on a 72h window, so daily
// granularity adds at most 24h of latency. Without this schedule an expired invitation
// never resolves at all — the only other caller of voidCaptainHold is the decline route —
// so the captain's Stripe hold and registration hang indefinitely.
export async function GET(req: NextRequest) {
  const unauthorized = assertCronSecret(req, 'league-partner-timeout')
  if (unauthorized) return unauthorized

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: expired } = await service
    .from('league_partner_invitations')
    .select('id')
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())

  if (!expired || expired.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let processed = 0
  for (const inv of expired) {
    try {
      await voidCaptainHold(inv.id, 'expired')
      processed++
    } catch (err) {
      console.error('[cron/league-partner-timeout] failed for invitation', inv.id, err)
    }
  }

  return NextResponse.json({ processed })
}
