import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { computeFixtureStandings } from '@/lib/leagues/fixtureStandings'
import { applyPromotionRelegation, type StandingBox } from '@/lib/leagues/promoteRelegate'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/cycles/advance
// Closes the active cycle and opens the next: computes each box's final standings,
// promotes the top / relegates the bottom, and seeds the next cycle's boxes.
// Organizer only, box format. Body: { force? } to advance with unscored matches.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const force = body.force === true

  const db = admin()
  const { data: league } = await db.from('leagues').select('created_by, format_kind, format_settings_json').eq('id', params.id).single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (league.format_kind !== 'box') return NextResponse.json({ error: 'Not a box league' }, { status: 400 })

  const promoteCount = ((league.format_settings_json as any)?.promote_count as number) ?? 1
  const relegateCount = ((league.format_settings_json as any)?.relegate_count as number) ?? 1

  const { data: cycle } = await db
    .from('league_periods').select('id, period_number')
    .eq('league_id', params.id).eq('period_kind', 'cycle').eq('status', 'active')
    .order('period_number', { ascending: false }).limit(1).maybeSingle()
  if (!cycle) return NextResponse.json({ error: 'No active cycle' }, { status: 400 })

  const { data: boxes } = await db
    .from('league_boxes').select('id, tier_rank').eq('period_id', cycle.id).order('tier_rank', { ascending: true })
  const boxIds = (boxes ?? []).map((b: any) => b.id)
  if (!boxIds.length) return NextResponse.json({ error: 'No boxes to advance' }, { status: 400 })

  const { data: members } = await db.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', boxIds)
  const memberIdsByBox = new Map<string, Set<string>>()
  for (const m of (members ?? [])) {
    if (!memberIdsByBox.has(m.box_id)) memberIdsByBox.set(m.box_id, new Set())
    memberIdsByBox.get(m.box_id)!.add(m.registration_id)
  }

  const { data: fixtures } = await db
    .from('league_fixtures')
    .select('match_stage, round_number, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, box_id, period_id')
    .eq('period_id', cycle.id)
  const fx = fixtures ?? []
  if (fx.length === 0) return NextResponse.json({ error: 'No matches — generate and score first.' }, { status: 400 })

  const incomplete = fx.filter((f: any) => f.status !== 'completed').length
  if (incomplete > 0 && !force) {
    return NextResponse.json({ error: 'incomplete', incomplete }, { status: 409 })
  }

  const { data: regsRaw } = await db
    .from('league_registrations').select('id, status, partner_registration_id')
    .eq('league_id', params.id).eq('status', 'registered')
  const regs = (regsRaw ?? []).map((r: any) => ({ id: r.id, status: r.status, partner_registration_id: r.partner_registration_id }))

  // Per-box final standings (best → worst).
  const standingBoxes: StandingBox[] = (boxes ?? []).map((b: any) => {
    const mem = memberIdsByBox.get(b.id) ?? new Set()
    const regsForBox = regs.filter(r => mem.has(r.id))
    const rows = computeFixtureStandings(fx as any, regsForBox, { boxId: b.id })
    return { tierRank: b.tier_rank, memberIds: rows.map(r => r.regId) }
  })

  const nextBoxes = applyPromotionRelegation(standingBoxes, promoteCount, relegateCount)

  // Close this cycle, open the next.
  await db.from('league_periods').update({ status: 'completed' }).eq('id', cycle.id)
  const nextNumber = (cycle.period_number ?? 1) + 1
  const { data: newCycle, error: cycErr } = await db
    .from('league_periods')
    .insert({ league_id: params.id, period_kind: 'cycle', period_number: nextNumber, name: `Cycle ${nextNumber}`, status: 'active' })
    .select('id').single()
  if (cycErr || !newCycle) return NextResponse.json({ error: cycErr?.message ?? 'Failed to open next cycle' }, { status: 500 })

  const { data: insertedBoxes, error: boxErr } = await db
    .from('league_boxes')
    .insert(nextBoxes.filter(b => b.memberIds.length > 0).map(b => ({
      period_id: newCycle.id, league_id: params.id, name: `Box ${b.tierRank}`, tier_rank: b.tierRank, box_size: b.memberIds.length,
    })))
    .select('id, tier_rank')
  if (boxErr || !insertedBoxes) return NextResponse.json({ error: boxErr?.message ?? 'Failed to create boxes' }, { status: 500 })

  const boxIdByTier = new Map((insertedBoxes as any[]).map(b => [b.tier_rank, b.id]))
  const memberRows = nextBoxes.flatMap(b =>
    b.memberIds.map((regId, i) => ({ box_id: boxIdByTier.get(b.tierRank), registration_id: regId, seed_in_box: i + 1 })),
  ).filter(r => r.box_id)
  if (memberRows.length) {
    const { error: memErr } = await db.from('league_box_members').insert(memberRows)
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, cycle: nextNumber })
}
