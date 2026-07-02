export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { canManage } from '@/lib/tournament/access'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings, type ScheduleBlock } from '@/lib/types'
import ScheduleBuilderView from '@/components/features/tournaments/schedule/ScheduleBuilderView'
import type { BuilderDay, BuilderLocation, BuilderDivision, DivisionStats, DivisionBlockLink, DraftMatch } from '@/components/features/tournaments/schedule/types'

export default async function ScheduleBuilderPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await canManage(id, user.id))) redirect(`/tournaments/${id}`)

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [
    { data: tournament },
    { data: divisionsRaw },
    { data: blocksRaw },
    { data: regsRaw },
    { data: assignmentsRaw },
    { data: draftRaw },
  ] = await Promise.all([
    db.from('tournaments')
      .select('id, name, start_date, start_time, estimated_end_time, additional_days, location_id, schedule_settings_json, registration_closes_at, scheduling_method')
      .eq('id', id)
      .single(),
    db.from('tournament_divisions')
      .select('id, name, category, team_type, format, bracket_type, partner_mode, format_settings_json, skill_min, skill_max, min_age, max_age, location_id')
      .eq('tournament_id', id)
      .order('created_at', { ascending: true }),
    db.from('tournament_schedule_blocks')
      .select('*')
      .eq('tournament_id', id)
      .order('block_date', { ascending: true })
      .order('start_time', { ascending: true }),
    db.from('tournament_registrations')
      .select('id, division_id, user_id, partner_registration_id, status, payment_status')
      .eq('tournament_id', id)
      .eq('status', 'registered')
      .in('payment_status', ['paid', 'waived', 'comped']),
    db.from('tournament_division_blocks')
      .select('division_id, block_id, priority')
      .eq('tournament_id', id),
    db.from('tournament_matches')
      .select('id, division_id, schedule_block_id, round_number, match_number, match_stage, court_number, scheduled_time, scheduled_end_time, team_1_registration_id, team_2_registration_id, status')
      .eq('tournament_id', id)
      .eq('is_draft', true)
      .order('scheduled_time', { ascending: true }),
  ])

  if (!tournament) notFound()
  const t = tournament as any

  // Tournament days = day one (start_date) plus any additional_days.
  const days: BuilderDay[] = [
    { date: t.start_date, start_time: t.start_time, end_time: t.estimated_end_time ?? '21:00:00' },
    ...((t.additional_days ?? []) as { date: string; start_time: string; end_time: string }[]),
  ]

  // Locations in play: tournament primary + any division overrides. Court counts
  // come from the locations table (courts are just integers 1..court_count).
  const locationIds = Array.from(new Set(
    [t.location_id, ...((divisionsRaw ?? []).map((d: any) => d.location_id))].filter(Boolean)
  )) as string[]
  const { data: locationsRaw } = locationIds.length > 0
    ? await db.from('locations').select('id, name, court_count').in('id', locationIds)
    : { data: [] }
  const locations: BuilderLocation[] = (locationsRaw ?? []).map((l: any) => ({
    id: l.id, name: l.name, court_count: l.court_count ?? 1,
  }))

  const divisions: BuilderDivision[] = (divisionsRaw ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
    category: d.category ?? null,
    team_type: d.team_type ?? null,
    format: d.format ?? null,
    bracket_type: d.bracket_type,
    partner_mode: d.partner_mode ?? 'fixed',
    format_settings_json: d.format_settings_json ?? null,
    skill_min: d.skill_min ?? null,
    skill_max: d.skill_max ?? null,
    min_age: d.min_age ?? null,
    max_age: d.max_age ?? null,
    location_id: d.location_id ?? null,
  }))

  // Per-division settled registration stats: team count (doubles pairs folded to
  // one) for match estimates, and the set of player user ids for conflict checks.
  const regsByDivision = new Map<string, { id: string; user_id: string; partner_registration_id: string | null }[]>()
  for (const r of (regsRaw ?? []) as any[]) {
    if (!regsByDivision.has(r.division_id)) regsByDivision.set(r.division_id, [])
    regsByDivision.get(r.division_id)!.push(r)
  }
  const divisionStats: Record<string, DivisionStats> = {}
  for (const d of divisions) {
    const regs = regsByDivision.get(d.id) ?? []
    divisionStats[d.id] = {
      teamCount: dedupeRegistrationsToTeams(regs).length,
      playerIds: Array.from(new Set(regs.map(r => r.user_id))),
    }
  }

  // Names for conflict detail rows.
  const allPlayerIds = Array.from(new Set((regsRaw ?? []).map((r: any) => r.user_id)))
  const { data: profilesRaw } = allPlayerIds.length > 0
    ? await db.from('profiles').select('id, name').in('id', allPlayerIds)
    : { data: [] }
  const playerNames: Record<string, string> = {}
  for (const p of (profilesRaw ?? []) as any[]) playerNames[p.id] = p.name

  // Team labels (registration id → "Alex/Blake") for the draft preview.
  const regById = new Map((regsRaw ?? []).map((r: any) => [r.id, r]))
  const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')
  const lastInitial = (n?: string | null) => {
    const parts = (n ?? '').trim().split(/\s+/)
    const last = parts.length > 1 ? parts[parts.length - 1] : ''
    return last ? last[0].toUpperCase() : ''
  }

  // Count distinct players per division by first name, so we only disambiguate
  // with a last initial ("Kira E.") when two players in the SAME division share
  // a first name — otherwise the compact first-name label stays.
  const divFirstNameCounts = new Map<string, Map<string, number>>()
  const countedPlayer = new Set<string>()                  // "divId|userId" — once each
  const notePlayer = (divId: string, userId?: string | null) => {
    if (!userId || countedPlayer.has(`${divId}|${userId}`)) return
    countedPlayer.add(`${divId}|${userId}`)
    const fn = firstName(playerNames[userId])
    if (!fn) return
    let m = divFirstNameCounts.get(divId)
    if (!m) { m = new Map(); divFirstNameCounts.set(divId, m) }
    m.set(fn, (m.get(fn) ?? 0) + 1)
  }
  for (const r of (regsRaw ?? []) as any[]) {
    notePlayer(r.division_id, r.user_id)
    const partner = r.partner_registration_id ? regById.get(r.partner_registration_id) : null
    if (partner) notePlayer(r.division_id, (partner as any).user_id)
  }
  const display = (divId: string, fullName?: string | null) => {
    const fn = firstName(fullName)
    if ((divFirstNameCounts.get(divId)?.get(fn) ?? 0) > 1) {
      const li = lastInitial(fullName)
      return li ? `${fn} ${li}.` : fn
    }
    return fn
  }

  const teamLabels: Record<string, string> = {}
  for (const r of (regsRaw ?? []) as any[]) {
    const p1full = playerNames[r.user_id]
    const partner = r.partner_registration_id ? regById.get(r.partner_registration_id) : null
    const p2full = partner ? playerNames[(partner as any).user_id] : null
    const p1 = p1full ? display(r.division_id, p1full) : null
    const p2 = p2full ? display(r.division_id, p2full) : null
    teamLabels[r.id] = p1 ? (p2 ? `${p1}/${p2}` : p1) : 'Player'
  }

  const assignments: DivisionBlockLink[] = (assignmentsRaw ?? []).map((a: any) => ({
    division_id: a.division_id, block_id: a.block_id, priority: a.priority ?? 0,
  }))

  const draftMatches = (draftRaw ?? []) as DraftMatch[]

  const settings: ScheduleSettings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(t.schedule_settings_json ?? {}) }
  const blocks = (blocksRaw ?? []) as ScheduleBlock[]

  // Registration is "open" if there's no deadline yet or the deadline is still
  // in the future. Scheduling before it closes risks division sizes changing.
  const registrationOpen = !t.registration_closes_at || new Date(t.registration_closes_at) > new Date()

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/tournaments/${id}` },
    { label: 'Schedule', href: `/tournaments/${id}/schedule` },
    { label: 'Schedule Builder', href: `/tournaments/${id}/schedule/builder` },
    { label: 'Standings', href: `/tournaments/${id}/standings` },
    { label: 'Players', href: `/tournaments/${id}/players` },
    { label: 'Edit', href: `/tournaments/${id}/edit` },
  ]

  return (
    <DesktopShell sidebar={<ManageNav items={navItems} />}>
      <ManageNav items={navItems} mobileOnly />
      <div className="space-y-4 pb-8">
        <Link href={`/tournaments/${id}`} className="text-brand-muted text-sm">
          ← {t.name}
        </Link>
        <ScheduleBuilderView
          tournamentId={id}
          registrationOpen={registrationOpen}
          primaryLocationId={t.location_id ?? null}
          days={days}
          locations={locations}
          divisions={divisions}
          divisionStats={divisionStats}
          playerNames={playerNames}
          teamLabels={teamLabels}
          initialBlocks={blocks}
          initialAssignments={assignments}
          initialSettings={settings}
          initialDraftMatches={draftMatches}
          schedulingMethod={(t as any).scheduling_method ?? 'timed'}
        />
      </div>
    </DesktopShell>
  )
}
