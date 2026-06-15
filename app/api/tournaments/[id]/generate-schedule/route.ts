import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings } from '@/lib/types'
import { buildDivisionMatchRows } from '@/lib/tournament/buildMatches'
import { scheduleBlockMatches, type SchedulableMatch } from '@/lib/tournament/scheduleGenerator'

export const dynamic = 'force-dynamic'

const service = () => createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/tournaments/[id]/generate-schedule
// Generates a DRAFT match schedule from the division→block assignments. Each
// assigned division's bracket is built and laid out within its block's window
// and courts. Body: { force? } — required to replace any existing matches.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const force = body.force === true
  const db = service()

  const [{ data: tournamentRow }, { data: blocks }, { data: assignments }] = await Promise.all([
    db.from('tournaments').select('schedule_settings_json').eq('id', id).single(),
    db.from('tournament_schedule_blocks').select('id, block_date, start_time, end_time, court_numbers').eq('tournament_id', id),
    db.from('tournament_division_blocks').select('division_id, block_id').eq('tournament_id', id),
  ])

  if (!assignments || assignments.length === 0) {
    return NextResponse.json({ error: 'Assign at least one division to a block first.' }, { status: 400 })
  }

  const settings: ScheduleSettings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(tournamentRow?.schedule_settings_json ?? {}) }
  const assignedDivisionIds = Array.from(new Set(assignments.map(a => a.division_id)))

  // Guard against clobbering existing matches unless the caller confirmed.
  const { data: existing } = await db
    .from('tournament_matches')
    .select('id, is_draft')
    .in('division_id', assignedDivisionIds)
  const draftCount = (existing ?? []).filter(m => m.is_draft).length
  const publishedCount = (existing ?? []).filter(m => !m.is_draft).length
  if ((draftCount > 0 || publishedCount > 0) && !force) {
    return NextResponse.json(
      { error: 'existing_matches', draftCount, publishedCount },
      { status: 409 },
    )
  }
  if (force && (existing?.length ?? 0) > 0) {
    await db.from('tournament_matches').delete().in('division_id', assignedDivisionIds)
  }

  const [{ data: divisions }, { data: regs }] = await Promise.all([
    db.from('tournament_divisions')
      .select('id, format, bracket_type, format_settings_json, partner_mode')
      .in('id', assignedDivisionIds),
    db.from('tournament_registrations')
      .select('id, division_id, user_id, partner_registration_id, seed')
      .in('division_id', assignedDivisionIds)
      .eq('status', 'registered')
      .in('payment_status', ['paid', 'waived', 'comped'])
      .order('created_at', { ascending: true }),
  ])

  const divisionById = new Map((divisions ?? []).map(d => [d.id, d]))
  const blockById = new Map((blocks ?? []).map(b => [b.id, b]))
  const regsByDivision = new Map<string, any[]>()
  for (const r of regs ?? []) {
    if (!regsByDivision.has(r.division_id)) regsByDivision.set(r.division_id, [])
    regsByDivision.get(r.division_id)!.push(r)
  }
  const blockOfDivision = new Map(assignments.map(a => [a.division_id, a.block_id]))

  // Group assigned divisions by block so each block is scheduled as a unit.
  const divisionsByBlock = new Map<string, string[]>()
  for (const a of assignments) {
    if (!divisionsByBlock.has(a.block_id)) divisionsByBlock.set(a.block_id, [])
    divisionsByBlock.get(a.block_id)!.push(a.division_id)
  }

  const allRows: object[] = []
  const skipped: { divisionId: string; reason: string }[] = []

  for (const [blockId, divisionIds] of divisionsByBlock) {
    const block = blockById.get(blockId)
    if (!block) continue
    const blockRows: SchedulableMatch[] = []

    for (const divisionId of divisionIds) {
      const division = divisionById.get(divisionId)
      if (!division) continue
      const base = {
        tournament_id: id,
        division_id: divisionId,
        status: 'scheduled',
        is_draft: true,
        schedule_block_id: blockId,
      }
      const built = buildDivisionMatchRows(division as any, regsByDivision.get(divisionId) ?? [], base)
      if ('error' in built) {
        skipped.push({ divisionId, reason: built.error })
        continue
      }
      blockRows.push(...(built.rows as SchedulableMatch[]))
    }

    if (blockRows.length === 0) continue
    scheduleBlockMatches(
      { block_date: block.block_date, start_time: block.start_time, end_time: block.end_time, court_numbers: block.court_numbers ?? [] },
      blockRows,
      settings,
      settings.keep_divisions_grouped,
    )
    allRows.push(...blockRows)
  }

  if (allRows.length === 0) {
    return NextResponse.json(
      { error: 'Nothing to generate — assigned divisions have no settled teams.', skipped },
      { status: 400 },
    )
  }

  const { data: inserted, error } = await db
    .from('tournament_matches')
    .insert(allRows)
    .select('id, division_id, schedule_block_id, round_number, match_number, match_stage, court_number, scheduled_time, team_1_registration_id, team_2_registration_id, status')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ generated: inserted?.length ?? 0, skipped, blocks: divisionsByBlock.size, matches: inserted ?? [] })
}

// DELETE /api/tournaments/[id]/generate-schedule — discard the draft schedule.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service()
    .from('tournament_matches')
    .delete()
    .eq('tournament_id', id)
    .eq('is_draft', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
