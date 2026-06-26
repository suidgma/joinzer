import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LeagueRosterManager from './LeagueRosterManager'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'

export default async function LeagueRosterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, max_players, format, partner_mode')
    .eq('id', params.id)
    .single()

  if (!league) notFound()

  // Co-admins can access roster too
  const { data: myReg } = await supabase
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', params.id)
    .eq('user_id', user.id)
    .single()
  const isCoAdmin = myReg?.is_co_admin === true
  if (league.created_by !== user.id && !isCoAdmin) redirect(`/leagues/${params.id}`)

  const [{ data: registrations }, { data: subInterest }, { data: allProfiles }] =
    await Promise.all([
      supabase
        .from('league_registrations')
        .select('id, status, registered_at, sort_order, is_co_admin, user_id, partner_user_id, profile:profiles!user_id(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source)')
        .eq('league_id', params.id)
        .neq('status', 'cancelled')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('registered_at', { ascending: true }),
      supabase
        .from('league_sub_interest')
        .select('created_at, profile:profiles(id, name, profile_photo_url)')
        .eq('league_id', params.id)
        .order('created_at', { ascending: true }),
      // Fetch profiles for the add-player dropdown; filter by gender for gender-specific formats
      (() => {
        const genderFilter: Record<string, string> = { mens_doubles: 'male', womens_doubles: 'female', mens_singles: 'male', womens_singles: 'female' }
        const requiredGender = league ? genderFilter[(league as any).format] : undefined
        let q = supabase.from('profiles').select('id, name').order('name', { ascending: true }).limit(200)
        if (requiredGender) q = q.eq('gender', requiredGender)
        return q
      })(),
    ])

  // Exclude anyone already in the roster (non-cancelled)
  const registeredUserIds = new Set(
    (registrations ?? []).map((r) => (r.profile as unknown as { id: string }).id)
  )
  const availablePlayers = (allProfiles ?? []).filter((p) => !registeredUserIds.has(p.id))

  const registered = (registrations ?? []).filter((r) => r.status === 'registered') as any[]
  const waitlisted = (registrations ?? []).filter((r) => r.status === 'waitlist') as any[]

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
          <span className="text-sm font-medium text-brand-dark">Roster</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <LeagueRosterManager
        leagueId={params.id}
        leagueName={league.name}
        maxPlayers={league.max_players ?? null}
        partnerMode={(league as any).partner_mode ?? null}
        registered={registered}
        waitlisted={waitlisted}
        subInterest={(subInterest ?? []) as any[]}
        availablePlayers={availablePlayers}
        isPrimaryOrganizer={league.created_by === user.id}
      />
    </DesktopShell>
  )
}
