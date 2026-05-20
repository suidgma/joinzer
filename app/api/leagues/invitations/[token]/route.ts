import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET(
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
    .select('id, league_id, invitee_email, expires_at, status, captain_registration_id')
    .eq('token', token)
    .single()

  if (!inv) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  const [{ data: league }, { data: captainReg }] = await Promise.all([
    service.from('leagues').select('name').eq('id', inv.league_id).single(),
    service.from('league_registrations').select('user_id').eq('id', inv.captain_registration_id).single(),
  ])

  let captainName: string | null = null
  if (captainReg?.user_id) {
    const { data: profile } = await service.from('profiles').select('name').eq('id', captainReg.user_id).single()
    captainName = profile?.name ?? null
  }

  return NextResponse.json({
    league_name: league?.name ?? null,
    league_id: inv.league_id,
    captain_name: captainName,
    invitee_email: inv.invitee_email,
    expires_at: inv.expires_at,
    status: inv.status,
  })
}
