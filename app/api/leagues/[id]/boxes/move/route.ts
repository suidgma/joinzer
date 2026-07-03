import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/boxes/move
// Organizer override: move one entrant (registration) into another box in the
// active cycle. Body: { registrationId, toBoxId }. Organizer only. Box format.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const registrationId: string = body.registrationId
  const toBoxId: string = body.toBoxId
  if (!registrationId || !toBoxId) {
    return NextResponse.json({ error: 'registrationId and toBoxId required' }, { status: 400 })
  }

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by, format_kind').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (league.format_kind !== 'box') return NextResponse.json({ error: 'Not a box league' }, { status: 400 })

  const { data: cycle } = await db
    .from('league_periods')
    .select('id')
    .eq('league_id', params.id)
    .eq('period_kind', 'cycle')
    .eq('status', 'active')
    .order('period_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycle) return NextResponse.json({ error: 'No active cycle' }, { status: 400 })

  // Only allow moves among boxes in this league's active cycle.
  const { data: boxes } = await db.from('league_boxes').select('id').eq('period_id', cycle.id)
  const boxIds = (boxes ?? []).map((b: any) => b.id)
  if (!boxIds.includes(toBoxId)) {
    return NextResponse.json({ error: 'Target box is not in the active cycle' }, { status: 400 })
  }

  // Append to the end of the target box's order.
  const { count } = await db
    .from('league_box_members')
    .select('id', { count: 'exact', head: true })
    .eq('box_id', toBoxId)

  const { error } = await db
    .from('league_box_members')
    .update({ box_id: toBoxId, seed_in_box: (count ?? 0) + 1 })
    .eq('registration_id', registrationId)
    .in('box_id', boxIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
