export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { canManage } from '@/lib/tournament/access'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings, type ScheduleBlock } from '@/lib/types'
import ScheduleBuilderView from '@/components/features/tournaments/schedule/ScheduleBuilderView'
import type { BuilderDay, BuilderLocation, BuilderDivision } from '@/components/features/tournaments/schedule/types'

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

  const [{ data: tournament }, { data: divisionsRaw }, { data: blocksRaw }] = await Promise.all([
    db.from('tournaments')
      .select('id, name, start_date, start_time, estimated_end_time, additional_days, location_id, schedule_settings_json')
      .eq('id', id)
      .single(),
    db.from('tournament_divisions')
      .select('id, name, category, team_type, format, bracket_type, format_settings_json, skill_min, skill_max, min_age, max_age, location_id')
      .eq('tournament_id', id)
      .order('created_at', { ascending: true }),
    db.from('tournament_schedule_blocks')
      .select('*')
      .eq('tournament_id', id)
      .order('block_date', { ascending: true })
      .order('start_time', { ascending: true }),
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
    format_settings_json: d.format_settings_json ?? null,
    skill_min: d.skill_min ?? null,
    skill_max: d.skill_max ?? null,
    min_age: d.min_age ?? null,
    max_age: d.max_age ?? null,
    location_id: d.location_id ?? null,
  }))

  const settings: ScheduleSettings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(t.schedule_settings_json ?? {}) }
  const blocks = (blocksRaw ?? []) as ScheduleBlock[]

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
          primaryLocationId={t.location_id ?? null}
          days={days}
          locations={locations}
          divisions={divisions}
          initialBlocks={blocks}
          initialSettings={settings}
        />
      </div>
    </DesktopShell>
  )
}
