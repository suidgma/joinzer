export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { fetchTournamentOrgData } from '@/lib/tournament/fetchTournamentOrgData'
import PlayersTab from '../organizer/_components/PlayersTab'

export default async function TournamentPlayersPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const { tournament, orgRegs, orgDivisions, orgMatches, canEdit } = await fetchTournamentOrgData(id)

  if (!tournament) notFound()
  if (!canEdit) redirect(`/tournaments/${id}`)

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/tournaments/${id}` },
    { label: 'Schedule', href: `/tournaments/${id}/schedule` },
    { label: 'Standings', href: `/tournaments/${id}/standings` },
    { label: 'Players', href: `/tournaments/${id}/players` },
    { label: 'Edit', href: `/tournaments/${id}/edit` },
  ]

  return (
    <DesktopShell sidebar={<ManageNav items={navItems} />}>
      <ManageNav items={navItems} mobileOnly />
      <div className="space-y-4 pb-8">
        <Link href={`/tournaments/${id}`} className="text-brand-muted text-sm">
          ← {tournament.name}
        </Link>
        <PlayersTab
          matches={orgMatches}
          registrations={orgRegs}
          divisions={orgDivisions}
          tournamentName={tournament.name}
        />
      </div>
    </DesktopShell>
  )
}
