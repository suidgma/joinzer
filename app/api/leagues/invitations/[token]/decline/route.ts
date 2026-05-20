import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { voidCaptainHold } from '@/lib/leagues/partner'

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('league_partner_invitations')
    .select('id, status')
    .eq('token', token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (inv.status !== 'pending') {
    return NextResponse.json({ error: 'Invitation is no longer pending', status: inv.status }, { status: 409 })
  }

  await voidCaptainHold(inv.id, 'declined')
  return NextResponse.json({ ok: true })
}
