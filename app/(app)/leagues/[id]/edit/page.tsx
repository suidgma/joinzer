export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import WizardOutline from '@/components/ui/wizard-outline'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import type { WizardStep } from '@/components/ui/wizard-outline'
import { getRunSessionAction } from '@/lib/leagues/runSession'
import type { LocationOption } from '@/lib/types'
import EditLeagueForm from './EditLeagueForm'

const STEPS: WizardStep[] = [
  { id: 'basics',       label: 'Basics',         status: 'current'  },
  { id: 'schedule',     label: 'Schedule',        status: 'upcoming' },
  { id: 'format',       label: 'Format & rules',  status: 'upcoming' },
  { id: 'registration', label: 'Registration',    status: 'upcoming' },
  { id: 'publishing',   label: 'Publishing',      status: 'upcoming' },
]

export default async function EditLeaguePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (!league) notFound()

  const { data: myReg } = await supabase
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  const isCoAdmin = myReg?.is_co_admin === true
  if (league.created_by !== user.id && !isCoAdmin) redirect(`/leagues/${id}`)

  const runSessionAction = await getRunSessionAction(id, true, (league as any).format_kind)

  const [{ data: sessionRows, count: sessionCount }, { count: regCount }] = await Promise.all([
    supabase
      .from('league_sessions')
      .select('id, session_number, session_date, session_time, league_session_subs(user_id, profile:profiles(id, name))', { count: 'exact' })
      .eq('league_id', id)
      .order('session_date', { ascending: true }),
    supabase
      .from('league_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', id)
      .neq('status', 'cancelled'),
  ])

  // Lock the format selector once the current format has structure that a switch
  // would orphan: sessions (round-robin) or saved boxes (box). Box tables are RLS
  // deny-all, so count via the service role.
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { count: boxCount } = await admin
    .from('league_boxes').select('id', { count: 'exact', head: true }).eq('league_id', id)
  const formatLocked = (sessionCount ?? 0) > 0 || (boxCount ?? 0) > 0

  // Registered players for the optional season-host picker (player-run RR leagues).
  const { data: rosterRows } = await admin
    .from('league_registrations')
    .select('user_id, profile:profiles!user_id(id, name)')
    .eq('league_id', id)
    .eq('status', 'registered')
  const rosterPlayers = Array.from(
    new Map(
      (rosterRows ?? [])
        .map((row: any) => {
          const prof = Array.isArray(row.profile) ? row.profile[0] : row.profile
          return prof ? { id: prof.id as string, name: (prof.name as string) ?? 'Unnamed' } : null
        })
        .filter((p): p is { id: string; name: string } => p !== null)
        .map((p) => [p.id, p] as const)
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name))

  const { data: locationData } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea, address, city, state, zip_code, country')
    .eq('is_active', true)
    .or(`status.eq.approved,created_by.eq.${user.id}`) // approved venues + your own pending ones
    .order('sort_order', { ascending: true })
  const locations = (locationData ?? []) as LocationOption[]

  let canCreatePaid = false
  if (user) {
    const { data: prof } = await supabase.from('profiles').select('can_create_paid_events').eq('id', user.id).single()
    canCreatePaid = !!prof?.can_create_paid_events
  }

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${id}` },
    { label: 'Standings', href: `/leagues/${id}/standings` },
    { label: 'Roster', href: `/leagues/${id}/roster` },
    { label: 'Edit', href: `/leagues/${id}/edit` },
  ]

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Edit League</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
      rail={<WizardOutline steps={STEPS} title="Edit League" />}
    >
      <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
      <EditLeagueForm
        leagueId={id}
        initialData={league as any}
        existingSessionDates={(sessionRows ?? []).map((s: any) => s.session_date as string)}
        existingSessionCount={sessionCount ?? 0}
        registrantCount={regCount ?? 0}
        sessions={(sessionRows ?? []) as any[]}
        formatLocked={formatLocked}
        locations={locations}
        canCreatePaid={canCreatePaid}
        rosterPlayers={rosterPlayers}
      />
    </DesktopShell>
  )
}
