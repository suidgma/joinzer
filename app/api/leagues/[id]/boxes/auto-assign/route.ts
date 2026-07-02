import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { assignBoxesByRating, type BoxEntrant } from '@/lib/leagues/boxAssignment'

type Params = { params: Promise<{ id: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/boxes/auto-assign
// Seeds the roster into rating-tiered boxes for the league's active cycle
// (creating cycle 1 if none exists). Replaces any existing boxes for that cycle.
// Organizer only. Box format only.
export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: league } = await db
    .from('leagues')
    .select('created_by, format, format_kind, format_settings_json')
    .eq('id', params.id)
    .single()
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.created_by !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (league.format_kind !== 'box') {
    return NextResponse.json({ error: 'Not a box league' }, { status: 400 })
  }

  const boxSize = ((league.format_settings_json as any)?.box_size as number) ?? 5

  // Ensure an active cycle — create cycle 1 on first assignment.
  let { data: cycle } = await db
    .from('league_periods')
    .select('id')
    .eq('league_id', params.id)
    .eq('period_kind', 'cycle')
    .eq('status', 'active')
    .order('period_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycle) {
    const { data: created, error: cErr } = await db
      .from('league_periods')
      .insert({ league_id: params.id, period_kind: 'cycle', period_number: 1, name: 'Cycle 1', status: 'active' })
      .select('id')
      .single()
    if (cErr || !created) return NextResponse.json({ error: cErr?.message ?? 'Failed to create cycle' }, { status: 500 })
    cycle = created
  }

  // Settled registrations with rating fields. Partner ratings are read from this
  // same set (via partner_registration_id) — no nested join needed.
  const { data: regsRaw } = await db
    .from('league_registrations')
    .select('id, user_id, status, payment_status, partner_registration_id, profile:profiles!user_id(dupr_rating, estimated_rating)')
    .eq('league_id', params.id)
    .eq('status', 'registered')
  const regs = (regsRaw ?? []) as any[]
  const settled = regs.filter(r => r.payment_status == null || ['paid', 'waived', 'comped'].includes(r.payment_status))

  const byId = new Map(settled.map(r => [r.id, r]))
  const ratingOf = (regId: string): number | null => {
    const p = byId.get(regId)?.profile
    return p?.dupr_rating ?? p?.estimated_rating ?? null
  }
  const teamRating = (regId: string): number | null => {
    const r1 = ratingOf(regId)
    const partnerId = byId.get(regId)?.partner_registration_id
    if (!partnerId) return r1
    const r2 = ratingOf(partnerId)
    if (r1 != null && r2 != null) return (r1 + r2) / 2
    return r1 ?? r2
  }

  let entrants: BoxEntrant[]
  if (isDoublesFormat(league.format)) {
    const teamIds = dedupeRegistrationsToTeams(settled)
    entrants = teamIds.map(id => ({ registrationId: id, rating: teamRating(id) }))
  } else {
    entrants = settled.map(r => ({ registrationId: r.id, rating: ratingOf(r.id) }))
  }

  if (entrants.length < 2) {
    return NextResponse.json({ error: `Need at least 2 settled entrants to form boxes (have ${entrants.length}).` }, { status: 400 })
  }

  const assigned = assignBoxesByRating(entrants, boxSize)

  // Replace existing boxes for this cycle (members cascade on delete).
  await db.from('league_boxes').delete().eq('period_id', cycle.id)

  const { data: insertedBoxes, error: boxErr } = await db
    .from('league_boxes')
    .insert(assigned.map(b => ({
      period_id: cycle.id,
      league_id: params.id,
      name: `Box ${b.tierRank}`,
      tier_rank: b.tierRank,
      box_size: b.members.length,
    })))
    .select('id, tier_rank')
  if (boxErr || !insertedBoxes) return NextResponse.json({ error: boxErr?.message ?? 'Failed to create boxes' }, { status: 500 })

  const boxIdByTier = new Map((insertedBoxes as any[]).map(b => [b.tier_rank, b.id]))
  const memberRows = assigned.flatMap(b =>
    b.members.map(m => ({ box_id: boxIdByTier.get(b.tierRank), registration_id: m.registrationId, seed_in_box: m.seedInBox }))
  )
  const { error: memErr } = await db.from('league_box_members').insert(memberRows)
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, cycleId: cycle.id, boxes: assigned.length, entrants: entrants.length })
}
