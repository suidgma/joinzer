import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canOperateRound } from '@/lib/leagues/canOperateSession'

type Params = { params: Promise<{ roundId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// PATCH /api/league-rounds/[roundId]
// body: { action: 'lock' | 'complete' | 'unlock' }
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  // Owner, co-admin, or (player-run leagues) the effective session host may lock/complete rounds.
  if (!(await canOperateRound(db, params.roundId, user.id))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const { action } = await req.json()

  const { data: round } = await db.from('league_rounds').select('status').eq('id', params.roundId).single()
  if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 })

  const now = new Date().toISOString()
  let update: Record<string, unknown> = { updated_at: now }

  if (action === 'lock') {
    if (round.status === 'completed') return NextResponse.json({ error: 'Cannot lock a completed round.' }, { status: 400 })
    update = { ...update, status: 'locked', locked_at: now }
  } else if (action === 'unlock') {
    if (round.status === 'completed') return NextResponse.json({ error: 'Cannot unlock a completed round.' }, { status: 400 })
    update = { ...update, status: 'draft', locked_at: null }
  } else if (action === 'complete') {
    if (round.status === 'draft') return NextResponse.json({ error: 'Lock the round before marking it complete.' }, { status: 400 })
    update = { ...update, status: 'completed', completed_at: now }
  } else {
    return NextResponse.json({ error: 'Invalid action. Use lock, unlock, or complete.' }, { status: 400 })
  }

  const { data, error } = await db
    .from('league_rounds')
    .update(update)
    .eq('id', params.roundId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
