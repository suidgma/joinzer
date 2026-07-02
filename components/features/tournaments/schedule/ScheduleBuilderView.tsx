'use client'
import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { CalendarRange, Plus, AlertTriangle, CheckCircle2, ChevronDown, Wand2, Send, RefreshCw, Trash2, Lightbulb, Wrench } from 'lucide-react'
import type { ScheduleBlock, ScheduleSettings } from '@/lib/types'
import type { BuilderDay, BuilderLocation, BuilderDivision, DivisionStats, DivisionBlockLink, DraftMatch } from './types'
import { estimateDivision, blockCapacity, estimateBlockFinishMinutes, effectiveBlockCourts, recommendedCourts, minutesToLabel, timeToMinutes, type DivisionEstimate } from '@/lib/tournament/scheduleEstimates'
import { detectPlayerConflicts, blocksOverlap } from '@/lib/tournament/scheduleConflicts'
import SettingsPanel from './SettingsPanel'
import BlockCard from './BlockCard'
import BlockFormModal from './BlockFormModal'
import DivisionCard from './DivisionCard'
import SchedulePreview from './SchedulePreview'
import { useDialog } from '@/components/ui/DialogProvider'

type Props = {
  tournamentId: string
  registrationOpen: boolean
  primaryLocationId: string | null
  days: BuilderDay[]
  locations: BuilderLocation[]
  divisions: BuilderDivision[]
  divisionStats: Record<string, DivisionStats>
  playerNames: Record<string, string>
  teamLabels: Record<string, string>
  initialBlocks: ScheduleBlock[]
  initialAssignments: DivisionBlockLink[]
  initialSettings: ScheduleSettings
  initialDraftMatches: DraftMatch[]
  schedulingMethod?: string
}

type ModalState = { mode: 'create' } | { mode: 'edit'; block: ScheduleBlock } | null

export default function ScheduleBuilderView({
  tournamentId, registrationOpen, primaryLocationId, days, locations, divisions, divisionStats, playerNames, teamLabels,
  initialBlocks, initialAssignments, initialSettings, initialDraftMatches, schedulingMethod,
}: Props) {
  const isRolling = schedulingMethod === 'rolling'
  const { confirm } = useDialog()
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialBlocks)
  const [settings, setSettings] = useState<ScheduleSettings>(initialSettings)
  const [assignments, setAssignments] = useState<DivisionBlockLink[]>(initialAssignments)
  const [draftMatches, setDraftMatches] = useState<DraftMatch[]>(initialDraftMatches)
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [showConflicts, setShowConflicts] = useState(false)
  const [busy, setBusy] = useState<null | 'generate' | 'publish' | 'discard'>(null)
  const [lastOverflow, setLastOverflow] = useState(0)
  const [fixing, setFixing] = useState(false)

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  // Pointer for mouse/trackpad (small distance so clicks on the card's dropdown
  // still register), Touch with a short press-delay so the page can still scroll
  // on phones, and Keyboard for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setDraggingId(null)
    // active.id = division id, over.id = block id. Dropped outside any block → no-op.
    if (over) assign(String(active.id), String(over.id))
  }

  const divisionById = useMemo(() => new Map(divisions.map(d => [d.id, d])), [divisions])
  const blockById = useMemo(() => new Map(blocks.map(b => [b.id, b])), [blocks])
  const locationName = (locId: string | null) => locations.find(l => l.id === locId)?.name ?? null

  // Per-division estimates recompute when settings change.
  const estimates = useMemo(() => {
    const m = new Map<string, DivisionEstimate>()
    for (const d of divisions) {
      const stats = divisionStats[d.id] ?? { teamCount: 0, playerIds: [] }
      m.set(d.id, estimateDivision(d.bracket_type, d.partner_mode, stats.teamCount, d.format_settings_json, settings))
    }
    return m
  }, [divisions, divisionStats, settings])

  const divisionPlayers = useMemo(() => {
    const r: Record<string, string[]> = {}
    for (const d of divisions) r[d.id] = divisionStats[d.id]?.playerIds ?? []
    return r
  }, [divisions, divisionStats])

  const conflicts = useMemo(
    () => detectPlayerConflicts(assignments, blocks, divisionPlayers),
    [assignments, blocks, divisionPlayers]
  )

  const assignmentByDivision = useMemo(
    () => new Map(assignments.map(a => [a.division_id, a.block_id])),
    [assignments]
  )

  const priorityByDivision = useMemo(
    () => new Map(assignments.map(a => [a.division_id, a.priority])),
    [assignments]
  )

  const assignedByBlock = useMemo(() => {
    const m = new Map<string, BuilderDivision[]>()
    for (const d of divisions) {
      const bid = assignmentByDivision.get(d.id)
      if (!bid) continue
      if (!m.has(bid)) m.set(bid, [])
      m.get(bid)!.push(d)
    }
    return m
  }, [divisions, assignmentByDivision])

  const unassigned = divisions.filter(d => !assignmentByDivision.has(d.id))

  function blockLoad(block: ScheduleBlock) {
    const divs = assignedByBlock.get(block.id) ?? []
    const matches = divs.reduce((s, d) => s + (estimates.get(d.id)?.matches ?? 0), 0)
    // Cap usable courts by player availability — extra courts can't be filled if
    // every entrant is already on one (e.g. 20 singles players → 10 courts).
    const effCourts = effectiveBlockCourts(block.court_numbers.length, divs.map(d => divisionStats[d.id]?.teamCount ?? 0))
    const capacity = blockCapacity(effCourts, block.start_time, block.end_time, settings).matchCapacity
    return { matches, capacity, over: matches > capacity }
  }

  // ── Warnings (each may carry a suggestion + a one-click fix) ─────────────────
  type WarningAction = { label: string; run: () => void; secondary?: boolean }
  type Warning = {
    level: 'red' | 'amber'
    text: string
    suggestion?: string
    actions?: WarningAction[]
  }
  const warnings: Warning[] = []
  for (const b of blocks) {
    const divs = assignedByBlock.get(b.id) ?? []
    if (divs.length === 0) continue
    if (b.court_numbers.length === 0) {
      const load = blockLoad(b)
      const need = Math.max(1, recommendedCourts(load.matches, b.start_time, b.end_time, settings))
      warnings.push({
        level: 'red',
        text: `“${b.name}” has divisions assigned but no courts selected.`,
        suggestion: `Add ${need} court${need === 1 ? '' : 's'} so its matches have somewhere to play.`,
        actions: [{ label: `Add ${need} court${need === 1 ? '' : 's'}`, run: () => patchBlock(b, { court_numbers: courtsToReach([], need) }, 'Courts added') }],
      })
      continue
    }
    const load = blockLoad(b)
    if (!isRolling && load.over) {
      const divs = assignedByBlock.get(b.id) ?? []
      const effCourts = effectiveBlockCourts(b.court_numbers.length, divs.map(d => divisionStats[d.id]?.teamCount ?? 0))
      const finish = estimateBlockFinishMinutes(effCourts, b.start_time, load.matches, settings)
      const endMin = timeToMinutes(b.end_time)
      const needCourts = recommendedCourts(load.matches, b.start_time, b.end_time, settings)
      const bits = [`over capacity by ~${load.matches - load.capacity} matches`]
      if (finish != null && finish > endMin) bits.push(`est. finish ~${minutesToLabel(finish)} runs past the ${minutesToLabel(endMin)} end`)
      if (needCourts > b.court_numbers.length) bits.push(`needs ~${needCourts} courts (has ${b.court_numbers.length})`)
      const extra = needCourts - b.court_numbers.length

      // End time that would let the matches finish with the *current* courts.
      // Only offered when it stays inside the same day (≤ 11:59 PM) — otherwise
      // "extend" would silently roll past midnight, which the block can't span.
      const newEnd = finish != null
        ? Math.ceil((finish + (settings.leave_end_buffer ? settings.end_buffer_minutes : 0)) / 5) * 5
        : null
      const canExtend = newEnd != null && newEnd > endMin && newEnd <= 1439

      const actions: WarningAction[] = []
      if (extra > 0) {
        actions.push({ label: `Add ${extra} court${extra === 1 ? '' : 's'} → ${needCourts}`, run: () => patchBlock(b, { court_numbers: courtsToReach(b.court_numbers, needCourts) }, 'Courts added') })
      }
      if (canExtend) {
        actions.push({ label: `Extend end to ${minutesToLabel(newEnd!)}`, secondary: true, run: () => patchBlock(b, { end_time: minutesToClock(newEnd!) }, 'End time extended') })
      }

      let suggestion: string
      if (extra > 0 && needCourts > 16) {
        suggestion = `That’s ~${needCourts} courts — likely too many for one venue. Consider splitting this division across more blocks/days, or a format with fewer matches.${canExtend ? ` Or extend the end time to ${minutesToLabel(newEnd!)}.` : ' You can still add the courts:'}`
      } else if (extra > 0 && canExtend) {
        suggestion = `Add ${extra} court${extra === 1 ? '' : 's'} (to ${needCourts}) to keep the same end time, or push the end time to ${minutesToLabel(newEnd!)} to fit on the courts you have.`
      } else if (extra > 0) {
        suggestion = `Add ${extra} more court${extra === 1 ? '' : 's'} (to ${needCourts}) to fit it inside the time window.`
      } else if (canExtend) {
        suggestion = `Extend the block’s end time to ${minutesToLabel(newEnd!)} to give the matches room.`
      } else {
        suggestion = `Add courts or extend the end time to give the matches more room.`
      }
      warnings.push({ level: 'amber', text: `“${b.name}” — ${bits.join('; ')}.`, suggestion, actions })
    }
    if (b.max_divisions != null && divs.length > b.max_divisions) {
      warnings.push({
        level: 'amber',
        text: `“${b.name}” has ${divs.length} divisions but its max is ${b.max_divisions}.`,
        suggestion: `Raise this block’s division limit to ${divs.length}, or move a division to another block.`,
        actions: [{ label: `Raise limit to ${divs.length}`, run: () => patchBlock(b, { max_divisions: divs.length }, 'Division limit raised') }],
      })
    }
    if (!settings.allow_court_sharing && divs.length > b.court_numbers.length) {
      warnings.push({
        level: 'amber',
        text: `“${b.name}” has ${divs.length} divisions but only ${b.court_numbers.length} court${b.court_numbers.length === 1 ? '' : 's'} — with court-sharing off, some divisions will share a court.`,
        suggestion: `Add courts so each division has its own (needs ${divs.length}), or turn on court-sharing in Settings.`,
        actions: [{ label: `Add courts → ${divs.length}`, run: () => patchBlock(b, { court_numbers: courtsToReach(b.court_numbers, divs.length) }, 'Courts added') }],
      })
    }
  }
  for (const d of unassigned) {
    const stats = divisionStats[d.id]
    if (stats && stats.teamCount >= 2) {
      const best = bestBlockFor(d)
      warnings.push({
        level: 'amber',
        text: `“${d.name}” isn’t assigned to a block.`,
        suggestion: best
          ? `Drag it into a block on the right, or assign it to “${best.name}” (the block with the most room).`
          : 'Create a block above, then drag this division into it.',
        actions: best ? [{ label: `Assign to “${best.name}”`, run: () => assign(d.id, best.id) }] : undefined,
      })
    }
  }
  // Two blocks that overlap in time AND share courts will have their matches
  // compete for the same physical courts. The scheduler avoids double-booking,
  // but two blocks on the same courts at once is usually unintended (e.g. a
  // second day that wasn't given its own date). Only flag when both actually
  // produce matches. Skipped in rolling mode — blocks contribute courts only, and
  // their start/end times are ignored, so "overlapping times" is meaningless.
  for (let i = 0; !isRolling && i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const ba = blocks[i], bb = blocks[j]
      if (!blocksOverlap(ba, bb)) continue
      const shared = ba.court_numbers.filter(c => bb.court_numbers.includes(c))
      if (shared.length === 0) continue
      if ((assignedByBlock.get(ba.id)?.length ?? 0) === 0 || (assignedByBlock.get(bb.id)?.length ?? 0) === 0) continue
      const s = shared.length === 1 ? '' : 's'
      const courtList = shared.join(', ')
      // Offer to pull the shared courts off whichever block keeps ≥1 court after.
      const trim = bb.court_numbers.length > shared.length ? bb
        : ba.court_numbers.length > shared.length ? ba
        : null
      warnings.push({
        level: 'amber',
        text: `“${ba.name}” and “${bb.name}” overlap in time and share court${s} ${courtList} — their matches will compete for those courts.`,
        suggestion: trim
          ? `Give one block its own courts or a different date/time — or pull the shared court${s} off “${trim.name}”.`
          : `Give one block its own courts, or move it to a different date/time.`,
        actions: trim
          ? [{ label: `Remove court${s} ${courtList} from “${trim.name}”`, run: () => patchBlock(trim, { court_numbers: trim.court_numbers.filter(c => !shared.includes(c)) }, 'Courts updated') }]
          : undefined,
      })
    }
  }
  const conflictIsError = settings.conflict_policy === 'error'
  for (const c of conflicts) {
    const a = divisionById.get(c.divisionAId)?.name ?? 'A'
    const b = divisionById.get(c.divisionBId)?.name ?? 'B'
    const moveTarget = bestMoveBlockFor(c.divisionBId)
    const actions: WarningAction[] = []
    if (moveTarget) actions.push({ label: `Move “${b}” to “${moveTarget.name}”`, run: () => assign(c.divisionBId, moveTarget.id) })
    actions.push({ label: `Unassign “${b}”`, secondary: actions.length > 0, run: () => unassign(c.divisionBId) })
    warnings.push({
      level: conflictIsError ? 'red' : 'amber',
      text: `${c.sharedPlayerIds.length} player${c.sharedPlayerIds.length === 1 ? '' : 's'} in both “${a}” and “${b}”, which overlap in time.`,
      suggestion: moveTarget
        ? `Move “${b}” to “${moveTarget.name}” — no time overlap there, so the shared players are fine. Or set player conflicts to “Warnings” in Settings.`
        : `Unassign “${b}” and drop it in a non-overlapping block, or set player conflicts to “Warnings” in Settings.`,
      actions,
    })
  }
  // Overlap turned off: flag any two divisions in overlapping blocks that aren't
  // already surfaced above as a shared-player conflict. Time-based, so skipped in
  // rolling mode (blocks have no meaningful start/end there).
  if (!isRolling && !settings.allow_division_overlap) {
    const conflictPairs = new Set(conflicts.map(c => [c.divisionAId, c.divisionBId].sort().join('|')))
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a = assignments[i], b = assignments[j]
        if (a.division_id === b.division_id) continue
        const ba = blockById.get(a.block_id), bb = blockById.get(b.block_id)
        if (!ba || !bb || !blocksOverlap(ba, bb)) continue
        if (conflictPairs.has([a.division_id, b.division_id].sort().join('|'))) continue
        const na = divisionById.get(a.division_id)?.name ?? 'A'
        const nb = divisionById.get(b.division_id)?.name ?? 'B'
        const moveTarget = bestMoveBlockFor(b.division_id)
        const overlapActions: WarningAction[] = []
        if (moveTarget) overlapActions.push({ label: `Move “${nb}” to “${moveTarget.name}”`, run: () => assign(b.division_id, moveTarget.id) })
        overlapActions.push({ label: `Unassign “${nb}”`, secondary: overlapActions.length > 0, run: () => unassign(b.division_id) })
        warnings.push({
          level: 'amber',
          text: `“${na}” and “${nb}” are in overlapping time blocks, but division overlap is turned off.`,
          suggestion: moveTarget
            ? `Move “${nb}” to “${moveTarget.name}” — no overlap there. Or allow division overlap in Settings.`
            : `Unassign “${nb}” and drop it in a non-overlapping block, or allow division overlap in Settings.`,
          actions: overlapActions,
        })
      }
    }
  }
  const allGood = warnings.length === 0 && blocks.length > 0 && assignments.length > 0

  // ── Mutations ─────────────────────────────────────────────────────────────────
  function upsertBlock(b: ScheduleBlock) {
    setBlocks(prev => {
      const idx = prev.findIndex(x => x.id === b.id)
      const next = idx === -1 ? [...prev, b] : prev.map(x => (x.id === b.id ? b : x))
      return next.sort((a, c) =>
        a.block_date === c.block_date ? a.start_time.localeCompare(c.start_time) : a.block_date.localeCompare(c.block_date)
      )
    })
  }

  async function assign(divisionId: string, blockId: string) {
    const prev = assignments
    setAssignments(a => [...a.filter(x => x.division_id !== divisionId), { division_id: divisionId, block_id: blockId, priority: 0 }])
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/division-blocks/${divisionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block_id: blockId }),
      })
      if (!res.ok) { const j = await res.json(); flash(j.error ?? 'Failed to assign'); setAssignments(prev) }
    } catch { flash('Network error'); setAssignments(prev) }
  }

  async function unassign(divisionId: string) {
    const prev = assignments
    setAssignments(a => a.filter(x => x.division_id !== divisionId))
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/division-blocks/${divisionId}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json(); flash(j.error ?? 'Failed to unassign'); setAssignments(prev) }
    } catch { flash('Network error'); setAssignments(prev) }
  }

  async function setPriority(divisionId: string, priority: number) {
    const link = assignments.find(a => a.division_id === divisionId)
    if (!link) return
    const prev = assignments
    setAssignments(a => a.map(x => (x.division_id === divisionId ? { ...x, priority } : x)))
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/division-blocks/${divisionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block_id: link.block_id, priority }),
      })
      if (!res.ok) { const j = await res.json(); flash(j.error ?? 'Failed to set priority'); setAssignments(prev) }
    } catch { flash('Network error'); setAssignments(prev) }
  }

  async function duplicate(block: ScheduleBlock) {
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-blocks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${block.name} (copy)`, block_date: block.block_date, start_time: block.start_time,
          end_time: block.end_time, location_id: block.location_id, court_numbers: block.court_numbers,
          notes: block.notes, priority: block.priority, max_divisions: block.max_divisions,
        }),
      })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to duplicate'); return }
      upsertBlock(json.block as ScheduleBlock)
      flash('Block duplicated')
    } catch { flash('Network error') }
  }

  async function removeBlock(block: ScheduleBlock) {
    if (!(await confirm({ title: 'Delete block?', body: `Delete "${block.name}"? Divisions assigned to it will be unassigned.`, confirmLabel: 'Delete', danger: true }))) return
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-blocks/${block.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to delete'); return }
      setBlocks(prev => prev.filter(b => b.id !== block.id))
      setAssignments(prev => prev.filter(a => a.block_id !== block.id)) // DB cascades; mirror locally
      flash('Block deleted')
    } catch { flash('Network error') }
  }

  // Build a court-number list that extends the existing courts up to `target`,
  // appending the next sequential numbers above the current highest.
  function courtsToReach(current: number[], target: number): number[] {
    const set = [...current].sort((a, b) => a - b)
    let next = set.length ? set[set.length - 1] + 1 : 1
    while (set.length < target) set.push(next++)
    return set
  }

  // minutes-since-midnight → 'HH:MM:SS' for persisting a block's end_time.
  function minutesToClock(min: number): string {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
  }

  // Block with the most remaining capacity after adding this division — the
  // default target for the "assign" one-click fix on an unassigned division.
  function bestBlockFor(d: BuilderDivision): ScheduleBlock | null {
    let best: ScheduleBlock | null = null
    let bestRemaining = -Infinity
    const est = estimates.get(d.id)?.matches ?? 0
    for (const b of blocks) {
      const load = blockLoad(b)
      const remaining = load.capacity - (load.matches + est)
      if (remaining > bestRemaining) { bestRemaining = remaining; best = b }
    }
    return best
  }

  // For a division currently causing a conflict/overlap: find another block it
  // can move to that (a) introduces no player conflict for it and (b) respects
  // the division-overlap setting. Among valid blocks, pick the roomiest. Returns
  // null when no clean home exists (caller falls back to plain unassign).
  function bestMoveBlockFor(divisionId: string): ScheduleBlock | null {
    const currentBlockId = assignmentByDivision.get(divisionId)
    const est = estimates.get(divisionId)?.matches ?? 0
    let best: ScheduleBlock | null = null
    let bestRemaining = -Infinity
    for (const cand of blocks) {
      if (cand.id === currentBlockId) continue
      // Simulate the division living in this candidate block.
      const sim = [
        ...assignments.filter(x => x.division_id !== divisionId),
        { division_id: divisionId, block_id: cand.id, priority: priorityByDivision.get(divisionId) ?? 0 },
      ]
      const stillConflicts = detectPlayerConflicts(sim, blocks, divisionPlayers)
        .some(c => c.divisionAId === divisionId || c.divisionBId === divisionId)
      if (stillConflicts) continue
      if (!settings.allow_division_overlap) {
        const overlapsAnother = sim.some(x => {
          if (x.division_id === divisionId) return false
          const ob = blockById.get(x.block_id)
          return ob ? blocksOverlap(cand, ob) : false
        })
        if (overlapsAnother) continue
      }
      const load = blockLoad(cand)
      const remaining = load.capacity - (load.matches + est)
      if (remaining > bestRemaining) { bestRemaining = remaining; best = cand }
    }
    return best
  }

  // One-click fix runner used by the warning CTAs. Optimistically updates the
  // block, then persists via PATCH and reconciles with the server's row.
  async function patchBlock(
    block: ScheduleBlock,
    patch: Partial<Pick<ScheduleBlock, 'court_numbers' | 'max_divisions' | 'end_time'>>,
    successMsg: string,
  ) {
    if (fixing) return
    setFixing(true)
    const prev = blocks
    upsertBlock({ ...block, ...patch } as ScheduleBlock)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-blocks/${block.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to apply fix'); setBlocks(prev); return }
      upsertBlock(json.block as ScheduleBlock)
      flash(successMsg)
    } catch {
      flash('Network error'); setBlocks(prev)
    } finally {
      setFixing(false)
    }
  }

  // The generate/regenerate POSTs return a lean summary — refetch the draft
  // matches so the preview reflects the new schedule.
  async function refreshDraft() {
    try {
      const dRes = await fetch(`/api/tournaments/${tournamentId}/generate-schedule`)
      const dJson = await dRes.json()
      setDraftMatches((dJson.matches ?? []) as DraftMatch[])
    } catch { /* preview will populate on next page load */ }
  }

  async function generate(opts: { force?: boolean; replacePublished?: boolean; confirmOverflow?: boolean } = {}) {
    setBusy('generate')
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/generate-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!opts.force, replacePublished: !!opts.replacePublished, confirmOverflow: !!opts.confirmOverflow }),
      })
      const json = await res.json()

      // Player conflicts are hard errors under the current settings — block, no override.
      if (res.status === 409 && json.error === 'player_conflicts') {
        flash(`Can’t generate — ${json.playerCount} player${json.playerCount === 1 ? '' : 's'} in overlapping divisions. Resolve the conflicts, or set player conflicts to “Warnings”.`)
        return
      }
      // Replacing a LIVE published schedule needs its own explicit confirmation.
      if (res.status === 409 && json.error === 'published_exists') {
        const n = json.publishedCount
        if (await confirm({
          title: 'Replace the live schedule?',
          body: `${n} published (live) match${n === 1 ? '' : 'es'} already exist for these divisions.\n\nRegenerating will DELETE the live schedule and replace it with a new draft. Players lose access to it until you publish again.`,
          confirmLabel: 'Replace',
          danger: true,
        })) {
          await generate({ force: true, replacePublished: true })
        }
        return
      }
      // Replacing only an existing draft — lighter confirmation.
      if (res.status === 409 && json.error === 'existing_matches') {
        const n = json.draftCount
        if (await confirm({ title: 'Replace draft?', body: `Replace the existing draft (${n} match${n === 1 ? '' : 'es'}) for these divisions?`, confirmLabel: 'Replace' })) {
          await generate({ ...opts, force: true })
        }
        return
      }
      // Many matches won't fit their blocks — warn before committing.
      if (res.status === 409 && json.error === 'large_overflow') {
        const pct = json.total ? Math.round((json.overflow / json.total) * 100) : 0
        if (await confirm({
          title: 'Some matches won’t fit',
          body: `~${json.overflow} of ${json.total} matches (${pct}%) won't fit in their blocks and will be scheduled past the end time — some spilling onto later dates.\n\nThis usually means a division is too large for its window (e.g. a big round-robin). You can add courts/time or shrink the division first.`,
          confirmLabel: 'Generate anyway',
        })) {
          await generate({ ...opts, confirmOverflow: true })
        }
        return
      }
      if (!res.ok) { flash(json.error ?? 'Failed to generate'); return }

      // POST returns a lean summary now — refetch the draft matches for the preview.
      await refreshDraft()
      setLastOverflow(json.overflow ?? 0)
      const parts = [`${json.generated} matches`]
      const skip = (json.skipped ?? []).length
      if (skip) parts.push(`${skip} division${skip === 1 ? '' : 's'} skipped`)
      if (json.overflow) parts.push(`${json.overflow} past block end`)
      flash(`Draft generated — ${parts.join(', ')}`)
    } catch {
      flash('Network error')
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    if (!(await confirm({ title: 'Publish this schedule?', body: 'Matches become visible to players on the live board, standings, and schedule.', confirmLabel: 'Publish' }))) return
    setBusy('publish')
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule-publish`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to publish'); return }
      setDraftMatches([])
      setLastOverflow(0)
      flash(`Published — ${json.published} matches are now live`)
    } catch {
      flash('Network error')
    } finally {
      setBusy(null)
    }
  }

  async function discard() {
    if (!(await confirm({ title: 'Discard draft?', body: 'Discard the draft schedule? This deletes the generated draft matches.', confirmLabel: 'Discard', danger: true }))) return
    setBusy('discard')
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/generate-schedule`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) { flash(json.error ?? 'Failed to discard'); return }
      setDraftMatches([])
      setLastOverflow(0)
      flash('Draft discarded')
    } catch {
      flash('Network error')
    } finally {
      setBusy(null)
    }
  }

  const hasDraft = draftMatches.length > 0
  const canGenerate = blocks.length > 0 && assignments.length > 0

  const byDate = new Map<string, ScheduleBlock[]>()
  for (const b of blocks) {
    if (!byDate.has(b.block_date)) byDate.set(b.block_date, [])
    byDate.get(b.block_date)!.push(b)
  }
  // Group by date; within a date, higher-priority blocks first, then by start time.
  const dateGroups = Array.from(byDate.entries())
    .map(([date, group]) => [
      date,
      [...group].sort((x, y) => (y.priority - x.priority) || x.start_time.localeCompare(y.start_time)),
    ] as [string, ScheduleBlock[]])
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-lg font-bold text-brand-dark flex items-center gap-2">
          <CalendarRange size={18} className="text-brand-muted" />
          Schedule Builder
        </h1>
        <p className="text-xs text-brand-muted mt-1 max-w-lg">
          Drag each division into the block where it should play. Capacity, court-time, and
          player-overlap warnings update as you go. Generating the match schedule comes next.
        </p>
      </div>

      {isRolling && (
        <div className="rounded-xl border border-brand-border bg-brand-soft/60 px-3 py-2 text-xs text-brand-muted">
          Rolling schedule — matches are numbered and played in order. Blocks contribute their
          courts; start/finish times and durations are ignored.
        </div>
      )}

      {registrationOpen && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 font-medium flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Registration is still open — division sizes may still change. Schedules you generate now can go stale; finalize registration before you publish.</span>
        </div>
      )}

      <SettingsPanel
        tournamentId={tournamentId}
        settings={settings}
        onChange={setSettings}
        onError={flash}
        onSaved={flash}
        isRolling={isRolling}
      />

      {/* Validation summary */}
      {(warnings.length > 0 || allGood) && (
        <div className={`rounded-xl border p-3 ${allGood ? 'bg-brand-soft border-brand' : 'bg-amber-50 border-amber-200'}`}>
          {allGood ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-active">
              <CheckCircle2 size={14} /> Looks good — every division is assigned and no blocks are over capacity.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="flex items-center gap-2 text-xs font-bold text-amber-800">
                <AlertTriangle size={14} /> {warnings.length} thing{warnings.length === 1 ? '' : 's'} to review
              </p>
              <ul className="space-y-2 pl-6 list-disc">
                {warnings.map((w, i) => (
                  <li key={i} className="text-[11px]">
                    <span className={w.level === 'red' ? 'text-red-700 font-medium' : 'text-amber-800'}>
                      {w.text}
                    </span>
                    {(w.suggestion || (w.actions && w.actions.length > 0)) && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                        {w.suggestion && (
                          <span className="text-[10px] text-amber-700/90 italic flex items-start gap-1">
                            <Lightbulb size={11} className="shrink-0 mt-px" /> {w.suggestion}
                          </span>
                        )}
                        {w.actions?.map((act, ai) => (
                          <button
                            key={ai}
                            type="button"
                            onClick={() => act.run()}
                            disabled={fixing}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold disabled:opacity-50 transition-colors shrink-0 ${
                              act.secondary
                                ? 'border border-amber-400 text-amber-800 hover:bg-amber-100'
                                : 'bg-amber-600 text-white hover:bg-amber-700'
                            }`}
                          >
                            <Wrench size={10} /> {act.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {conflicts.length > 0 && (
                <div className="pl-6 pt-1">
                  <button onClick={() => setShowConflicts(s => !s)} className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 hover:text-amber-900">
                    {showConflicts ? 'Hide' : 'Show'} conflicting players <ChevronDown size={11} className={showConflicts ? 'rotate-180' : ''} />
                  </button>
                  {showConflicts && (
                    <div className="mt-1 space-y-1">
                      {conflicts.map((c, i) => (
                        <div key={i} className="text-[11px] text-amber-800">
                          <span className="font-medium">
                            {divisionById.get(c.divisionAId)?.name} ({blockById.get(c.blockAId)?.name ?? 'block'})
                            {' ↔ '}
                            {divisionById.get(c.divisionBId)?.name} ({blockById.get(c.blockBId)?.name ?? 'block'}):
                          </span>{' '}
                          {c.sharedPlayerIds.map(pid => playerNames[pid] ?? 'Unknown').join(', ')}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Two-pane: unassigned divisions (left) + blocks (right) */}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Unassigned divisions */}
        <section className="space-y-2 lg:sticky lg:top-4">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
            Unassigned divisions ({unassigned.length})
          </h2>
          {divisions.length === 0 ? (
            <p className="text-xs text-brand-muted">No divisions created yet.</p>
          ) : unassigned.length === 0 ? (
            <div className="bg-white rounded-xl border border-brand-border text-center py-8 px-4">
              <p className="text-xl mb-1">✅</p>
              <p className="text-xs font-semibold text-brand-dark">All divisions assigned</p>
            </div>
          ) : (
            <div className="space-y-2">
              {unassigned.map(d => (
                <DivisionCard
                  key={d.id}
                  division={d}
                  stats={divisionStats[d.id] ?? { teamCount: 0, playerIds: [] }}
                  estimate={estimates.get(d.id)!}
                  blocks={blocks}
                  onAssign={(blockId) => assign(d.id, blockId)}
                  dragging={draggingId === d.id}
                />
              ))}
            </div>
          )}
        </section>

        {/* Blocks */}
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
              Schedule Blocks {blocks.length > 0 && `(${blocks.length})`}
            </h2>
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-brand text-brand-dark hover:bg-brand-hover transition-colors"
            >
              <Plus size={14} /> Add block
            </button>
          </div>

          {blocks.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-brand-border text-center py-10 px-4">
              <p className="text-2xl mb-2">🗓️</p>
              <p className="text-sm font-semibold text-brand-dark">No blocks yet</p>
              <p className="text-xs text-brand-muted mt-1 max-w-xs mx-auto">
                Create blocks like “Saturday Morning” or “Sunday Championship” to carve up your
                courts and dates, then drag divisions into them.
              </p>
            </div>
          ) : (
            dateGroups.map(([date, group]) => (
              <div key={date} className="space-y-2">
                <div className="grid sm:grid-cols-2 gap-3">
                  {group.map(b => {
                    const divs = assignedByBlock.get(b.id) ?? []
                    return (
                      <BlockCard
                        key={b.id}
                        block={b}
                        locationName={locationName(b.location_id)}
                        settings={settings}
                        assigned={divs.map(d => ({ id: d.id, name: d.name, matches: estimates.get(d.id)?.matches ?? null, teamCount: divisionStats[d.id]?.teamCount ?? 0, priority: priorityByDivision.get(d.id) ?? 0 }))}
                        showPriority={settings.schedule_by_priority}
                        onChangePriority={setPriority}
                        onEdit={() => setModal({ mode: 'edit', block: b })}
                        onDuplicate={() => duplicate(b)}
                        onDelete={() => removeBlock(b)}
                        onRemoveDivision={(divId) => unassign(divId)}
                        dragActive={draggingId != null}
                        outOfRange={!days.some(d => d.date === b.block_date)}
                      />
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingId ? (
          <div className="bg-white rounded-xl border border-brand shadow-lg px-3 py-2 text-sm font-semibold text-brand-dark cursor-grabbing">
            {divisionById.get(draggingId)?.name ?? 'Division'}
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      {/* Draft schedule: generate → preview → publish */}
      <section className="space-y-3 border-t border-brand-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Draft Schedule</h2>
          <div className="flex items-center gap-2">
            {hasDraft ? (
              <>
                <button
                  onClick={() => generate()}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-brand-border text-brand-muted hover:bg-brand-soft disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={13} /> Regenerate
                </button>
                <button
                  onClick={discard}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-brand-border text-brand-muted hover:text-red-600 disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={13} /> Discard
                </button>
                <button
                  onClick={publish}
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-brand text-brand-dark hover:bg-brand-hover disabled:opacity-50 transition-colors"
                >
                  <Send size={13} /> {busy === 'publish' ? 'Publishing…' : 'Publish schedule'}
                </button>
              </>
            ) : (
              <button
                onClick={() => generate()}
                disabled={!canGenerate || busy !== null}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-brand text-brand-dark hover:bg-brand-hover disabled:opacity-50 transition-colors"
              >
                <Wand2 size={13} /> {busy === 'generate' ? 'Generating…' : 'Generate draft schedule'}
              </button>
            )}
          </div>
        </div>

        {hasDraft ? (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-800 font-medium">
              Draft only — these {draftMatches.length} matches are hidden from players until you publish.
            </div>
            {!isRolling && lastOverflow > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-[11px] text-red-700 font-medium">
                ⚠️ {lastOverflow} match{lastOverflow === 1 ? '' : 'es'} are scheduled past their block’s end time. Widen the block, add courts, or shorten match duration, then regenerate.
              </div>
            )}
            <SchedulePreview
              draftMatches={draftMatches}
              blocks={blocks}
              divisions={divisions}
              teamLabels={teamLabels}
              matchDurationMinutes={settings.match_duration_minutes}
              tournamentId={tournamentId}
              isRolling={isRolling}
              onFlash={flash}
              onMatchUpdated={updated =>
                setDraftMatches(prev => prev.map(m => (m.id === updated.id ? updated : m)))
              }
              onDraftRefresh={refreshDraft}
            />
          </>
        ) : (
          <p className="text-xs text-brand-muted">
            {canGenerate
              ? 'Generating lays out every assigned division’s matches across its block’s courts and time window. You can preview and publish, or regenerate.'
              : 'Add blocks and assign divisions to them, then generate a draft schedule here.'}
          </p>
        )}
      </section>

      {modal && (
        <BlockFormModal
          tournamentId={tournamentId}
          mode={modal.mode}
          block={modal.mode === 'edit' ? modal.block : undefined}
          days={days}
          locations={locations}
          primaryLocationId={primaryLocationId}
          settings={settings}
          isRolling={isRolling}
          onClose={() => setModal(null)}
          onSaved={(b) => { upsertBlock(b); flash(modal.mode === 'create' ? 'Block created' : 'Block updated') }}
          onError={flash}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-brand-dark text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
