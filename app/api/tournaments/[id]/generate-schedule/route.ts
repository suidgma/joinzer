import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { canManage } from '@/lib/tournament/access'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings } from '@/lib/types'
import { buildDivisionMatchRows } from '@/lib/tournament/buildMatches'
import { scheduleBlockMatches, type SchedulableMatch } from '@/lib/tournament/scheduleGenerator'
import { detectPlayerConflicts } from '@/lib/tournament/scheduleConflicts'

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
  const replacePublished = body.replacePublished === true
  const confirmOverflow = body.confirmOverflow === true
  // When set, regenerate only this division — by re-packing the whole block it
  // sits in, so its matches never overlap the siblings sharing its courts/window.
  const onlyDivisionId: string | null = body.divisionId ?? null
  const db = service()

  const [{ data: tournamentRow }, { data: blocks }, { data: assignmentsAll }] = await Promise.all([
    db.from('tournaments').select('schedule_settings_json').eq('id', id).single(),
    db.from('tournament_schedule_blocks').select('id, block_date, start_time, end_time, court_numbers').eq('tournament_id', id),
    db.from('tournament_division_blocks').select('division_id, block_id, priority').eq('tournament_id', id),
  ])

  if (!assignmentsAll || assignmentsAll.length === 0) {
    return NextResponse.json({ error: 'Assign at least one division to a block first.' }, { status: 400 })
  }

  let assignments = assignmentsAll
  if (onlyDivisionId) {
    const targetBlockId = assignmentsAll.find(a => a.division_id === onlyDivisionId)?.block_id
    if (!targetBlockId) {
      return NextResponse.json({ error: 'That division is not assigned to a block.' }, { status: 400 })
    }
    assignments = assignmentsAll.filter(a => a.block_id === targetBlockId)
  }

  const settings: ScheduleSettings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(tournamentRow?.schedule_settings_json ?? {}) }
  const assignedDivisionIds = Array.from(new Set(assignments.map(a => a.division_id)))
  const divisionPriority = new Map<string, number>(assignments.map(a => [a.division_id, (a as any).priority ?? 0]))

  // Load everything needed for validation up front, so nothing is deleted until
  // every guard below has passed.
  const [{ data: existing }, { data: divisions }, { data: regs }] = await Promise.all([
    db.from('tournament_matches').select('id, is_draft').in('division_id', assignedDivisionIds),
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

  // Hard-stop on player conflicts when the organizer set conflict handling to
  // "error": a player in two divisions whose blocks overlap can't be in both.
  if (settings.conflict_policy === 'error') {
    const divisionPlayers: Record<string, string[]> = {}
    for (const r of regs ?? []) (divisionPlayers[r.division_id] ??= []).push(r.user_id)
    const conflicts = detectPlayerConflicts(
      assignments.map(a => ({ division_id: a.division_id, block_id: a.block_id })),
      (blocks ?? []).map(b => ({ id: b.id, block_date: b.block_date, start_time: b.start_time, end_time: b.end_time })),
      divisionPlayers,
    )
    if (conflicts.length > 0) {
      const playerCount = new Set(conflicts.flatMap(c => c.sharedPlayerIds)).size
      return NextResponse.json(
        { error: 'player_conflicts', conflictCount: conflicts.length, playerCount },
        { status: 409 },
      )
    }
  }

  const draftCount = (existing ?? []).filter(m => m.is_draft).length
  const publishedCount = (existing ?? []).filter(m => !m.is_draft).length

  // ── Build + schedule everything FIRST (pure, no DB writes) ───────────────────
  // Done before any delete so we can gate on overflow / existing matches and
  // never destroy a prior schedule unless generation actually succeeds.
  const divisionById = new Map((divisions ?? []).map(d => [d.id, d]))
  const blockById = new Map((blocks ?? []).map(b => [b.id, b]))
  const regsByDivision = new Map<string, any[]>()
  for (const r of regs ?? []) {
    if (!regsByDivision.has(r.division_id)) regsByDivision.set(r.division_id, [])
    regsByDivision.get(r.division_id)!.push(r)
  }

  // Group assigned divisions by block so each block is scheduled as a unit.
  const divisionsByBlock = new Map<string, string[]>()
  for (const a of assignments) {
    if (!divisionsByBlock.has(a.block_id)) divisionsByBlock.set(a.block_id, [])
    divisionsByBlock.get(a.block_id)!.push(a.division_id)
  }

  const allRows: object[] = []
  const skipped: { divisionId: string; reason: string }[] = []
  let overflowTotal = 0

  // Shared court occupancy across blocks (`${date}|${court}` → next-free minute)
  // so blocks that share physical courts at overlapping times don't double-book.
  // Schedule blocks chronologically so earlier ones claim shared courts first.
  const courtReservations = new Map<string, number>()
  const orderedBlockIds = [...divisionsByBlock.keys()].sort((a, b) => {
    const ba = blockById.get(a), bb = blockById.get(b)
    if (!ba || !bb) return 0
    return ba.block_date.localeCompare(bb.block_date) || ba.start_time.localeCompare(bb.start_time)
  })

  for (const blockId of orderedBlockIds) {
    const divisionIds = divisionsByBlock.get(blockId)!
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
    const { overflowCount } = scheduleBlockMatches(
      { block_date: block.block_date, start_time: block.start_time, end_time: block.end_time, court_numbers: block.court_numbers ?? [] },
      blockRows,
      settings,
      settings.keep_divisions_grouped,
      settings.allow_court_sharing,
      divisionPriority,
      courtReservations,
    )
    overflowTotal += overflowCount
    allRows.push(...blockRows)
  }

  if (allRows.length === 0) {
    return NextResponse.json(
      { error: 'Nothing to generate — assigned divisions have no settled teams.', skipped },
      { status: 400 },
    )
  }

  // ── Confirmation gates (all BEFORE any destructive delete) ───────────────────
  // Published matches are live to players. Replacing them unpublishes the
  // schedule, so it takes its own explicit confirmation — never just `force`.
  if (publishedCount > 0 && !replacePublished) {
    return NextResponse.json({ error: 'published_exists', draftCount, publishedCount }, { status: 409 })
  }
  if (draftCount > 0 && !force && !replacePublished) {
    return NextResponse.json({ error: 'existing_matches', draftCount, publishedCount }, { status: 409 })
  }
  // Significant overflow means many matches won't fit their block window (usually
  // a division too large for it). Surface it once before committing the schedule.
  const overflowThreshold = Math.max(10, Math.floor(allRows.length * 0.1))
  if (overflowTotal > overflowThreshold && !confirmOverflow) {
    return NextResponse.json({ error: 'large_overflow', overflow: overflowTotal, total: allRows.length }, { status: 409 })
  }

  // ── Commit: delete only what was confirmed, then insert ──────────────────────
  // `force` alone clears drafts and leaves published matches untouched.
  if (replacePublished) {
    await db.from('tournament_matches').delete().in('division_id', assignedDivisionIds)
  } else if (force && draftCount > 0) {
    await db.from('tournament_matches').delete().in('division_id', assignedDivisionIds).eq('is_draft', true)
  }

  // Lean insert — no `.select()`. The builder refetches via GET, keeping this
  // response small even when thousands of matches are generated.
  const { error } = await db.from('tournament_matches').insert(allRows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ generated: allRows.length, skipped, blocks: divisionsByBlock.size, overflow: overflowTotal })
}

// GET /api/tournaments/[id]/generate-schedule — current draft matches. Lets the
// builder refetch the preview after a (now lean) POST generate.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManage(id, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await service()
    .from('tournament_matches')
    .select('id, division_id, schedule_block_id, round_number, match_number, match_stage, court_number, scheduled_time, scheduled_end_time, team_1_registration_id, team_2_registration_id, status')
    .eq('tournament_id', id)
    .eq('is_draft', true)
    .order('scheduled_time', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ matches: data ?? [] })
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
