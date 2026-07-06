import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'
import { ladderAdmin, readLadderState } from '@/lib/leagues/ladderServer'

type Params = { params: Promise<{ id: string }> }

// POST /api/leagues/[id]/ladder/start-session
// Open the next ladder session (a league_periods row, period_kind 'ladder_session').
// If no ladder order has been saved yet, seed ladder_positions from the league's
// initial-ranking method so the session can run immediately. Organizer/co-admin.
export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = ladderAdmin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const { data: league } = await db.from('leagues').select('format, format_settings_json').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // One active session at a time.
  const { data: active } = await db
    .from('league_periods')
    .select('id')
    .eq('league_id', params.id)
    .eq('period_kind', 'ladder_session')
    .eq('status', 'active')
    .maybeSingle()
  if (active) return NextResponse.json({ error: 'A session is already in progress', periodId: active.id }, { status: 409 })

  // Auto-seed positions from the initial-ranking method if the organizer hasn't
  // set an order yet, so a session can start without a separate seeding step.
  const state = await readLadderState(db, params.id, (league as any).format, (league as any).format_settings_json ?? null)
  const { count } = await db.from('ladder_positions').select('id', { count: 'exact', head: true }).eq('league_id', params.id)
  if ((count ?? 0) === 0 && state.orderedIds.length > 0) {
    const now = new Date().toISOString()
    await db.from('ladder_positions').insert(
      state.orderedIds.map((id, i) => ({ league_id: params.id, registration_id: id, position: i + 1, updated_at: now })),
    )
  }
  if (state.orderedIds.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 entrants to start a ladder session.' }, { status: 400 })
  }

  const { data: last } = await db
    .from('league_periods')
    .select('period_number')
    .eq('league_id', params.id)
    .eq('period_kind', 'ladder_session')
    .order('period_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const number = (last?.period_number ?? 0) + 1

  const { data: period, error } = await db
    .from('league_periods')
    .insert({ league_id: params.id, period_kind: 'ladder_session', period_number: number, name: `Session ${number}`, status: 'active' })
    .select('id, period_number')
    .single()
  if (error || !period) return NextResponse.json({ error: error?.message ?? 'Failed to start session' }, { status: 500 })

  return NextResponse.json({ ok: true, period })
}
