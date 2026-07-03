import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LeagueRosterManager from './LeagueRosterManager'
import BoxSeedingSection from './BoxSeedingSection'
import type { SeededItem } from '@/components/features/leagues/SeededRoster'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export default async function LeagueRosterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, max_players, format, partner_mode, format_kind, format_settings_json')
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
        .select('id, status, payment_status, registered_at, sort_order, is_co_admin, user_id, partner_user_id, partner_registration_id, profile:profiles!user_id(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source)')
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

  // ── Box seeding entrants (format-aware; seeding replaces the separate Boxes screen) ──
  const isBox = (league as any).format_kind === 'box'
  let boxSize = 5
  let boxEntrants: SeededItem[] = []
  if (isBox) {
    boxSize = ((league as any).format_settings_json?.box_size as number) ?? 5
    const doubles = isDoublesFormat((league as any).format)
    const settled = registered.filter((r: any) => r.payment_status == null || ['paid', 'waived', 'comped', 'free'].includes(r.payment_status))
    const byRegId = new Map(settled.map((r: any) => [r.id, r]))
    const profileByUser = new Map(settled.map((r: any) => [r.user_id, r.profile]))
    const ratingOfUser = (userId: string): number | null => {
      const p: any = profileByUser.get(userId)
      return p?.dupr_rating ?? p?.estimated_rating ?? null
    }
    const teamName = (reg: any): string => {
      const a = firstName(profileByUser.get(reg.user_id)?.name)
      if (!doubles) return a || 'Player'
      const partner: any = reg.partner_registration_id ? byRegId.get(reg.partner_registration_id) : null
      const b = partner ? firstName(profileByUser.get(partner.user_id)?.name) : ''
      return b ? `${a}/${b}` : (a || 'Team')
    }
    const teamRating = (reg: any): number | null => {
      const r1 = ratingOfUser(reg.user_id)
      if (!doubles) return r1
      const partner: any = reg.partner_registration_id ? byRegId.get(reg.partner_registration_id) : null
      const r2 = partner ? ratingOfUser(partner.user_id) : null
      if (r1 != null && r2 != null) return (r1 + r2) / 2
      return r1 ?? r2
    }

    const entrantIds = doubles ? dedupeRegistrationsToTeams(settled) : settled.map((r: any) => r.id)

    // Prefer the saved box order (read via service role — box tables are RLS
    // deny-all), else default to rating order. Append any not-yet-boxed entrants.
    let ordered = entrantIds
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: cyc } = await admin
      .from('league_periods').select('id')
      .eq('league_id', params.id).eq('period_kind', 'cycle').eq('status', 'active')
      .order('period_number', { ascending: false }).limit(1).maybeSingle()
    if (cyc) {
      const { data: bx } = await admin.from('league_boxes').select('id, tier_rank').eq('period_id', cyc.id)
      const tierByBox = new Map((bx ?? []).map((b: any) => [b.id, b.tier_rank]))
      const bxIds = (bx ?? []).map((b: any) => b.id)
      if (bxIds.length) {
        const { data: mem } = await admin.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', bxIds)
        const existing = (mem ?? [])
          .slice()
          .sort((a: any, b: any) => (tierByBox.get(a.box_id)! - tierByBox.get(b.box_id)!) || (a.seed_in_box - b.seed_in_box))
          .map((m: any) => m.registration_id)
          .filter((id: string) => byRegId.has(id))
        const inBox = new Set(existing)
        ordered = [...existing, ...entrantIds.filter((id: string) => !inBox.has(id))]
      }
    }
    if (ordered === entrantIds) {
      ordered = [...entrantIds].sort((a: string, b: string) =>
        (teamRating(byRegId.get(b)) ?? -Infinity) - (teamRating(byRegId.get(a)) ?? -Infinity))
    }

    boxEntrants = ordered.map((id: string) => {
      const reg = byRegId.get(id)
      return { id, name: teamName(reg), rating: teamRating(reg) }
    })
  }

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
      {isBox && boxEntrants.length > 0 && (
        <BoxSeedingSection leagueId={params.id} boxSize={boxSize} entrants={boxEntrants} />
      )}
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
