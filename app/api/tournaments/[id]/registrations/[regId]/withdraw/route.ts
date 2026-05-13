import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { maybePromoteWaitlisted } from '@/lib/tournament/waitlist'
import { canManage } from '@/lib/tournament/access'

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; regId: string }> }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: reg } = await service
    .from('tournament_registrations')
    .select('id, user_id, division_id, status, tournament_id')
    .eq('id', params.regId)
    .eq('tournament_id', params.id)
    .single()

  if (!reg) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })

  // Must be the player themselves or an organizer/co_organizer
  const isOwner = reg.user_id === user.id
  const isManager = await canManage(params.id, user.id)
  if (!isOwner && !isManager) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (reg.status === 'cancelled') {
    return NextResponse.json({ error: 'Already cancelled' }, { status: 409 })
  }

  await service
    .from('tournament_registrations')
    .update({ status: 'cancelled' })
    .eq('id', params.regId)

  // Auto-promote if a waitlisted player can now be moved up
  let promoted = null
  if (reg.status === 'registered') {
    promoted = await maybePromoteWaitlisted(params.id, reg.division_id)
  }

  return NextResponse.json({ ok: true, promoted })
}
