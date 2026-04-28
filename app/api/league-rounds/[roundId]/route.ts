import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { roundId: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function assertManager(userId: string, roundId: string) {
  const db = admin()
  const { data: round } = await db.from('league_rounds').select('session_id').eq('id', roundId).single()
  if (!round) return false
  const { data: session } = await db.from('league_sessions').select('league_id').eq('id', round.session_id).single()
  if (!session) return false
  const { data: league } = await db.from('leagues').select('created_by').eq('id', session.league_id).single()
  return league?.created_by === userId
}

// PATCH /api/league-rounds/[roundId]
// body: { action: 'lock' | 'complete' | 'unlock' }
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isManager = await assertManager(user.id, params.roundId)
  if (!isManager) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { action } = await req.json()
  const db = admin()

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
