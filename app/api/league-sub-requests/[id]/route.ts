import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit/log'
import { broadcastSubRequestsChanged } from '@/lib/subs/broadcast'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH — cancel an OPEN substitute request (requester or organizer).
// Body: { action: 'cancel' }
// Acceptance is the atomic accept route; organizer assignment/correction is the unified organizer
// route/RPC; the legacy claim/approve actions were removed in Phase 6 (they never placed a sub).
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json().catch(() => ({ action: null }))
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Only cancel is supported here.' }, { status: 400 })
  }

  const db = admin()

  const { data: sr } = await db
    .from('league_sub_requests')
    .select('id, status, requesting_player_id, league_id, league:leagues!league_id(created_by)')
    .eq('id', params.id)
    .single()
  if (!sr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const league = sr.league as unknown as { created_by: string } | null
  const isOrganizer = league?.created_by === user.id
  const isRequester = sr.requesting_player_id === user.id
  if (!isRequester && !isOrganizer) {
    return NextResponse.json({ error: 'Only the requester or organizer can cancel' }, { status: 403 })
  }
  if (sr.status !== 'open') {
    return NextResponse.json({ error: 'Only an open request can be cancelled here.' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { data: updated, error } = await db
    .from('league_sub_requests')
    .update({ updated_at: now, status: 'cancelled', cancelled_at: now, cancelled_by_user_id: user.id })
    .eq('id', params.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    actorId: user.id,
    entityType: 'league_registration',
    entityId: params.id,
    action: 'sub_request_cancelled',
    before: { status: sr.status },
    after: { status: updated.status },
  })
  // The pool changed (cancel removes an open opportunity) — refresh /subs + Home.
  broadcastSubRequestsChanged().catch(() => {})

  return NextResponse.json(updated)
}
