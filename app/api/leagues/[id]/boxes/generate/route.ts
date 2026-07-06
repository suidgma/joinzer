import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { roundRobinMatches } from '@/lib/tournament/bracketBuilder'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/boxes/generate
// Generates a round-robin of league_fixtures within each box of the active cycle
// (reusing the tournament roundRobinMatches). Replaces the cycle's existing
// fixtures. Organizer only. Box format.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const force = body.force === true

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by, format_kind').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (league.format_kind !== 'box') return NextResponse.json({ error: 'Not a box league' }, { status: 400 })

  const { data: cycle } = await db
    .from('league_periods').select('id')
    .eq('league_id', params.id).eq('period_kind', 'cycle').eq('status', 'active')
    .order('period_number', { ascending: false }).limit(1).maybeSingle()
  if (!cycle) return NextResponse.json({ error: 'No active cycle — seed boxes first.' }, { status: 400 })

  const { data: boxes } = await db
    .from('league_boxes').select('id, tier_rank').eq('period_id', cycle.id).order('tier_rank', { ascending: true })
  const boxIds = (boxes ?? []).map((b: any) => b.id)
  if (!boxIds.length) return NextResponse.json({ error: 'No boxes — seed boxes first.' }, { status: 400 })

  const { data: members } = await db
    .from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', boxIds)
  const membersByBox = new Map<string, any[]>()
  for (const m of (members ?? [])) {
    if (!membersByBox.has(m.box_id)) membersByBox.set(m.box_id, [])
    membersByBox.get(m.box_id)!.push(m)
  }

  // Only players marked "Here" (present) are scheduled. A member covered by a sub
  // (has_sub) is included too — the sub plays under that member's registration.
  const { data: attendance } = await db
    .from('league_attendance').select('registration_id, status').eq('period_id', cycle.id)
  const here = new Set(
    (attendance ?? [])
      .filter((a: any) => a.registration_id && (a.status === 'present' || a.status === 'has_sub'))
      .map((a: any) => a.registration_id),
  )

  const fixtureRows: any[] = []
  let matchNum = 1
  let skippedBoxes = 0
  for (const box of (boxes ?? [])) {
    const memberIds = (membersByBox.get(box.id) ?? [])
      .slice().sort((a: any, b: any) => (a.seed_in_box ?? 0) - (b.seed_in_box ?? 0))
      .map((m: any) => m.registration_id)
      .filter((id: string) => here.has(id))
    if (memberIds.length < 2) { skippedBoxes++; continue }
    const { rows, nextMatchNum } = roundRobinMatches(memberIds, { status: 'scheduled' } as any, matchNum)
    matchNum = nextMatchNum
    for (const r of rows as any[]) {
      fixtureRows.push({
        league_id: params.id,
        period_id: cycle.id,
        box_id: box.id,
        round_number: r.round_number ?? null,
        match_number: r.match_number,
        match_stage: 'round_robin',
        team_1_registration_id: r.team_1_registration_id,
        team_2_registration_id: r.team_2_registration_id,
        status: 'scheduled',
      })
    }
  }

  if (fixtureRows.length === 0) {
    return NextResponse.json({ error: 'No box has 2+ players marked Here. Mark attendance first, then generate.' }, { status: 400 })
  }

  // Don't silently wipe entered results — re-generating over completed fixtures
  // needs an explicit force.
  const { count: completed } = await db
    .from('league_fixtures').select('id', { count: 'exact', head: true })
    .eq('league_id', params.id).eq('period_id', cycle.id).eq('status', 'completed')
  if ((completed ?? 0) > 0 && !force) {
    return NextResponse.json({ error: 'completed_exists', completed }, { status: 409 })
  }

  // Replace the cycle's fixtures.
  await db.from('league_fixtures').delete().eq('league_id', params.id).eq('period_id', cycle.id)
  const { error: insErr } = await db.from('league_fixtures').insert(fixtureRows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, fixtures: fixtureRows.length, boxes: boxIds.length - skippedBoxes })
}
