import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import LeagueRosterManager from './LeagueRosterManager'
import LeagueRosterPanel from '../LeagueRosterPanel'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import { leagueNavItems } from '@/lib/leagues/leagueNav'
import { getRunSessionAction } from '@/lib/leagues/runSession'

export default async function LeagueRosterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, max_players, format, partner_mode, format_kind, format_settings_json, points_to_win')
    .eq('id', params.id)
    .single()
  if (!league) notFound()

  const { data: myReg } = user
    ? await supabase.from('league_registrations').select('is_co_admin').eq('league_id', params.id).eq('user_id', user.id).single()
    : { data: null }
  const isManager = !!user && league.created_by === user.id
  const isCoAdmin = (myReg as { is_co_admin?: boolean } | null)?.is_co_admin === true
  const canManage = isManager || isCoAdmin

  const navItems = leagueNavItems(params.id, { canManage, formatKind: (league as any).format_kind })
  const header = (
    <div className="flex items-center gap-3">
      <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      <span className="text-brand-muted text-sm">/</span>
      <span className="text-sm font-medium text-brand-dark">Roster</span>
    </div>
  )

  // ── Player (read-only) roster ────────────────────────────────────────────────
  if (!canManage) {
    const [{ data: rosterRegs }, { data: subInterest }] = await Promise.all([
      supabase
        .from('league_registrations')
        .select('id, user_id, status, registration_type, partner_user_id, is_co_admin, profile:profiles!user_id(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source, self_reported_rating, self_reported_scale, dupr_verified)')
        .eq('league_id', params.id)
        .neq('status', 'cancelled')
        .order('registered_at', { ascending: true }),
      supabase.from('league_sub_interest').select('user_id').eq('league_id', params.id),
    ])
    const subInterestUserIds = new Set(((subInterest ?? []) as { user_id: string }[]).map((s) => s.user_id))
    return (
      <DesktopShell header={header} sidebar={<ManageNav items={navItems} />}>
        <ManageNav items={navItems} mobileOnly />
        <div className="max-w-2xl">
          <LeagueRosterPanel
            leagueId={params.id}
            format={league.format}
            partnerMode={(league as any).partner_mode ?? null}
            maxPlayers={league.max_players ?? null}
            organizerUserId={league.created_by}
            registrations={(rosterRegs ?? []) as any}
            subInterestUserIds={subInterestUserIds}
          />
        </div>
      </DesktopShell>
    )
  }

  // ── Manager (management) roster ──────────────────────────────────────────────
  // payment_status is manager-only. Its anon/authenticated column grant was revoked
  // (migration 20260721000004), so the registrations read here goes through the service
  // role — authorization is the canManage gate above, and the query's eq('league_id') is
  // now the only row boundary since service-role bypasses RLS.
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const runSessionAction = await getRunSessionAction(params.id, true, (league as any).format_kind)
  const [{ data: registrations }, { data: subInterest }, { data: allProfiles }] = await Promise.all([
    admin
      .from('league_registrations')
      .select('id, status, payment_status, registered_at, sort_order, is_co_admin, user_id, partner_user_id, partner_registration_id, profile:profiles!user_id(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source, self_reported_rating, self_reported_scale, dupr_verified)')
      .eq('league_id', params.id)
      .neq('status', 'cancelled')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('registered_at', { ascending: true }),
    supabase
      .from('league_sub_interest')
      .select('created_at, profile:profiles(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .order('created_at', { ascending: true }),
    (() => {
      const genderFilter: Record<string, string> = { mens_doubles: 'male', womens_doubles: 'female', mens_singles: 'male', womens_singles: 'female' }
      const requiredGender = genderFilter[(league as any).format]
      let q = supabase.from('profiles').select('id, name').order('name', { ascending: true }).limit(1000)
      if (requiredGender) q = q.eq('gender', requiredGender)
      return q
    })(),
  ])

  const registeredUserIds = new Set((registrations ?? []).map((r) => (r.profile as unknown as { id: string }).id))
  const availablePlayers = (allProfiles ?? []).filter((p) => !registeredUserIds.has(p.id))
  const registered = (registrations ?? []).filter((r) => r.status === 'registered') as any[]
  const waitlisted = (registrations ?? []).filter((r) => r.status === 'waitlist') as any[]
  const isBox = (league as any).format_kind === 'box'
  const isLadder = (league as any).format_kind === 'ladder'

  return (
    <DesktopShell header={header} sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}>
      <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
      <div className={isBox || isLadder ? 'max-w-2xl' : undefined}>
        <LeagueRosterManager
          leagueId={params.id}
          leagueName={league.name}
          maxPlayers={league.max_players ?? null}
          partnerMode={(league as any).partner_mode ?? null}
          registered={registered}
          waitlisted={waitlisted}
          subInterest={(subInterest ?? []) as any[]}
          availablePlayers={availablePlayers}
          isPrimaryOrganizer={isManager}
        />
      </div>
    </DesktopShell>
  )
}
