import type { ManageNavItem } from '@/components/ui/manage-nav'

// League tab nav. Players get Overview / Roster / Schedule / Standings; managers
// (organizer or co-admin) keep their management tabs. Shared across the league
// pages so the tab bar stays consistent everywhere.
export function leagueNavItems(
  id: string,
  opts: { canManage: boolean; formatKind?: string | null },
): ManageNavItem[] {
  if (opts.canManage) {
    return [
      { label: 'Overview', href: `/leagues/${id}` },
      { label: 'Standings', href: `/leagues/${id}/standings` },
      ...(opts.formatKind === 'team' ? [{ label: 'Teams', href: `/leagues/${id}/teams` }] : []),
      { label: 'Roster', href: `/leagues/${id}/roster` },
      { label: 'Edit', href: `/leagues/${id}/edit` },
    ]
  }
  return [
    { label: 'Overview', href: `/leagues/${id}` },
    { label: 'Roster', href: `/leagues/${id}/roster` },
    { label: 'Schedule', href: `/leagues/${id}/schedule` },
    { label: 'Standings', href: `/leagues/${id}/standings` },
  ]
}
