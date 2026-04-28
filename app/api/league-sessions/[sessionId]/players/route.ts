import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { sessionId: string } }

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET /api/league-sessions/[sessionId]/players
// Returns all session players with their current statuses.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('league_session_players')
    .select('*')
    .eq('session_id', params.sessionId)
    .order('player_type')
    .order('display_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/league-sessions/[sessionId]/players
// Add a sub or guest to this session.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { displayName, playerType = 'sub', userId = null } = body

  if (!displayName?.trim()) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 400 })
  }

  const db = admin()
  const { data, error } = await db
    .from('league_session_players')
    .insert({
      session_id:     params.sessionId,
      user_id:        userId,
      display_name:   displayName.trim(),
      player_type:    playerType,
      expected_status: 'expected',
      actual_status:  'present',  // subs added mid-session default to present
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
