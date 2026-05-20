import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { voidCaptainHold } from '@/lib/leagues/partner'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
