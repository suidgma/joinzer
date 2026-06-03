export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import WizardOutline from '@/components/ui/wizard-outline'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import type { WizardStep } from '@/components/ui/wizard-outline'
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
      sidebar={<ManageNav items={navItems} />}
      rail={<WizardOutline steps={STEPS} title="Edit League" />}
    >
      <ManageNav items={navItems} mobileOnly />
      <EditLeagueForm
        leagueId={id}
        initialData={league as any}
        existingSessionDates={(sessionRows ?? []).map((s: any) => s.session_date as string)}
        existingSessionCount={sessionCount ?? 0}
        registrantCount={regCount ?? 0}
        sessions={(sessionRows ?? []) as any[]}
      />
    </DesktopShell>
  )
}
