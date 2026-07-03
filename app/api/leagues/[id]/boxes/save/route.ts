import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { chunkBoxes } from '@/lib/leagues/boxAssignment'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/boxes/save
// Persists a hand-seeded roster as boxes for the active cycle: chunks the given
// order by the league's box_size (order preserved — no re-sort) and replaces the
// cycle's boxes + members. Ensures Cycle 1 exists. Organizer only. Box format.
// Body: { orderedRegistrationIds: string[] }.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const orderedIds: string[] = Array.isArray(body.orderedRegistrationIds) ? body.orderedRegistrationIds : []
  if (orderedIds.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 entrants to form boxes' }, { status: 400 })
  }

  const db = admin()
  const { data: league } = await db
    .from('leagues')
    .select('created_by, format_kind, format_settings_json')
    .eq('id', params.id)
    .single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (league.format_kind !== 'box') return NextResponse.json({ error: 'Not a box league' }, { status: 400 })

  const boxSize = ((league.format_settings_json as any)?.box_size as number) ?? 5

  // Guard against stray ids: only settled registrations of this league may be seeded.
  const { data: regRows } = await db
    .from('league_registrations')
    .select('id, status, payment_status')
    .eq('league_id', params.id)
    .in('id', orderedIds)
  const valid = new Set(
    (regRows ?? [])
      .filter((r: any) => r.status === 'registered' && (r.payment_status == null || ['paid', 'waived', 'comped', 'free'].includes(r.payment_status)))
      .map((r: any) => r.id),
  )
  const cleanOrder = orderedIds.filter(id => valid.has(id))
  if (cleanOrder.length < 2) {
    return NextResponse.json({ error: 'Fewer than 2 valid settled entrants in the order' }, { status: 400 })
  }

  // Ensure an active cycle (create Cycle 1 on first save).
  let { data: cycle } = await db
    .from('league_periods')
    .select('id')
    .eq('league_id', params.id).eq('period_kind', 'cycle').eq('status', 'active')
    .order('period_number', { ascending: false }).limit(1).maybeSingle()
  if (!cycle) {
    const { data: created, error: cErr } = await db
      .from('league_periods')
      .insert({ league_id: params.id, period_kind: 'cycle', period_number: 1, name: 'Cycle 1', status: 'active' })
      .select('id').single()
    if (cErr || !created) return NextResponse.json({ error: cErr?.message ?? 'Failed to create cycle' }, { status: 500 })
    cycle = created
  }

  const assigned = chunkBoxes(cleanOrder, boxSize)

  await db.from('league_boxes').delete().eq('period_id', cycle.id)

  const { data: insertedBoxes, error: boxErr } = await db
    .from('league_boxes')
    .insert(assigned.map(b => ({
      period_id: cycle.id, league_id: params.id, name: `Box ${b.tierRank}`, tier_rank: b.tierRank, box_size: b.members.length,
    })))
    .select('id, tier_rank')
  if (boxErr || !insertedBoxes) return NextResponse.json({ error: boxErr?.message ?? 'Failed to create boxes' }, { status: 500 })

  const boxIdByTier = new Map((insertedBoxes as any[]).map(b => [b.tier_rank, b.id]))
  const memberRows = assigned.flatMap(b =>
    b.members.map(m => ({ box_id: boxIdByTier.get(b.tierRank), registration_id: m.registrationId, seed_in_box: m.seedInBox })),
  )
  const { error: memErr } = await db.from('league_box_members').insert(memberRows)
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, boxes: assigned.length })
}
