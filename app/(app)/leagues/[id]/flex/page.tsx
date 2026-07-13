import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import RefreshButton from '@/components/ui/RefreshButton'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { loadFlexMatches } from '@/lib/leagues/flexView'
import FlexManager from './FlexManager'

// Flex League organizer hub: generate the round-robin, watch progress, resolve disputes.
// Players report/confirm from their own match list on the league overview.
export default async function FlexHubPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues').select('id, name, created_by, format_kind, format').eq('id', params.id).single()
  if (!league) notFound()
  if ((league as any).format_kind !== 'flex') redirect(`/leagues/${params.id}`)

  const { data: myReg } = await supabase
    .from('league_registrations').select('is_co_admin').eq('league_id', params.id).eq('user_id', user.id).maybeSingle()
  const isOrganizer = league.created_by === user.id || (myReg as any)?.is_co_admin === true
  if (!isOrganizer) redirect(`/leagues/${params.id}`)

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { matches, counts, entrantCount } = await loadFlexMatches(admin, params.id, (league as any).format)

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${params.id}` },
    { label: 'Standings', href: `/leagues/${params.id}/standings` },
    { label: 'Roster', href: `/leagues/${params.id}/roster` },
    { label: 'Edit', href: `/leagues/${params.id}/edit` },
  ]

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Flex</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <div className="max-w-2xl space-y-5 pb-8">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-heading text-xl font-bold text-brand-dark">Flex</h1>
            <RefreshButton className="mt-1 shrink-0" />
          </div>
          <p className="text-xs text-brand-muted">Generate the match grid; players self-report and confirm. Resolve any disputes here.</p>
        </div>
        <FlexManager leagueId={params.id} matches={matches} counts={counts} entrantCount={entrantCount} />
      </div>
    </DesktopShell>
  )
}
