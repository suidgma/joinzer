import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { voidCaptainHold } from '@/lib/leagues/partner'

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params

  // Declining cancels the captain's registration and voids their Stripe hold —
  // a destructive action. It must be bound to the invited account, not merely to
  // possession of the token (the token travels in emails / notification links and
  // can leak). Mirror the accept route's auth + invitee binding.
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: inv } = await service
    .from('league_partner_invitations')
    .select('id, status, invitee_user_id')
    .eq('token', token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (inv.status !== 'pending') {
    return NextResponse.json({ error: 'Invitation is no longer pending', status: inv.status }, { status: 409 })
  }
  if (inv.invitee_user_id && inv.invitee_user_id !== user.id) {
    return NextResponse.json({ error: 'This invitation is not for your account' }, { status: 403 })
  }

  await voidCaptainHold(inv.id, 'declined')
  return NextResponse.json({ ok: true })
}
