import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LeagueRosterManager from './LeagueRosterManager'
import BoxSeedingSection from './BoxSeedingSection'
import BoxFixtures, { type BoxView } from './BoxFixtures'
import BoxCycleBar from './BoxCycleBar'
import type { SeededItem } from '@/components/features/leagues/SeededRoster'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { getRunSessionAction } from '@/lib/leagues/runSession'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { chunkBoxes } from '@/lib/leagues/boxAssignment'

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export default async function LeagueRosterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, max_players, format, partner_mode, format_kind, format_settings_json, points_to_win')
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

  const runSessionAction = await getRunSessionAction(params.id, true, (league as any).format_kind)

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
  let boxesExist = false
  let boxViews: BoxView[] = []
  // Dirty by default: a fresh box league (no saved boxes) needs a first save, and
  // if saved boxes don't match the current preview (box size / roster changed) the
  // seeding is out of date. Set false only when persisted boxes == preview.
  let boxesDirty = true
  let boxCycleNumber = 1
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
      .from('league_periods').select('id, period_number')
      .eq('league_id', params.id).eq('period_kind', 'cycle').eq('status', 'active')
      .order('period_number', { ascending: false }).limit(1).maybeSingle()
    if (cyc) {
      boxCycleNumber = (cyc as any).period_number ?? 1
      const { data: bx } = await admin.from('league_boxes').select('id, tier_rank, name').eq('period_id', cyc.id)
      const tierByBox = new Map((bx ?? []).map((b: any) => [b.id, b.tier_rank]))
      const bxIds = (bx ?? []).map((b: any) => b.id)
      if (bxIds.length) {
        boxesExist = true
        const { data: mem } = await admin.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', bxIds)
        const existing = (mem ?? [])
          .slice()
          .sort((a: any, b: any) => (tierByBox.get(a.box_id)! - tierByBox.get(b.box_id)!) || (a.seed_in_box - b.seed_in_box))
          .map((m: any) => m.registration_id)
          .filter((id: string) => byRegId.has(id))
        const inBox = new Set(existing)
        ordered = [...existing, ...entrantIds.filter((id: string) => !inBox.has(id))]

        // Is the saved box structure still current? Compare persisted boxes
        // (members per tier, settled only) to what saving would now produce.
        const persistedStructure = (bx ?? []).map((b: any) =>
          (mem ?? [])
            .filter((m: any) => m.box_id === b.id)
            .sort((x: any, y: any) => (x.seed_in_box ?? 0) - (y.seed_in_box ?? 0))
            .map((m: any) => m.registration_id)
            .filter((rid: string) => byRegId.has(rid)))
        const previewStructure = chunkBoxes(ordered, boxSize).map(bp => bp.members.map(m => m.registrationId))
        boxesDirty = JSON.stringify(persistedStructure) !== JSON.stringify(previewStructure)

        // Fixtures per box for the Matches view.
        const nameOf = (regId: string | null): string => (regId && byRegId.has(regId) ? teamName(byRegId.get(regId)) : 'TBD')
        const { data: fx } = await admin
          .from('league_fixtures')
          .select('id, box_id, match_number, team_1_registration_id, team_2_registration_id, status, team_1_score, team_2_score')
          .eq('period_id', cyc.id)
          .order('match_number', { ascending: true })
        const fxByBox = new Map<string, any[]>()
        for (const f of (fx ?? [])) {
          if (!fxByBox.has(f.box_id)) fxByBox.set(f.box_id, [])
          fxByBox.get(f.box_id)!.push(f)
        }
        boxViews = (bx ?? []).map((b: any) => ({
          id: b.id,
          name: b.name ?? `Box ${b.tier_rank}`,
          matches: (fxByBox.get(b.id) ?? []).map((f: any) => ({
            id: f.id,
            name1: nameOf(f.team_1_registration_id),
            name2: nameOf(f.team_2_registration_id),
            status: f.status,
            score1: f.team_1_score,
            score2: f.team_2_score,
          })),
        }))
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
      sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
    >
      <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
      <div className={isBox ? 'max-w-2xl' : undefined}>
        {isBox && boxesExist && (
          <BoxCycleBar
            leagueId={params.id}
            cycleNumber={boxCycleNumber}
            canAdvance={boxViews.some(b => b.matches.length > 0)}
            incomplete={boxViews.reduce((n, b) => n + b.matches.filter(m => m.status !== 'completed').length, 0)}
          />
        )}
        {isBox && boxEntrants.length > 0 && (
          <BoxSeedingSection leagueId={params.id} boxSize={boxSize} entrants={boxEntrants} initialSaved={!boxesDirty} />
        )}
        {isBox && boxesExist && (
          <BoxFixtures leagueId={params.id} boxes={boxViews} pointsToWin={(league as any).points_to_win ?? 11} stale={boxesDirty} />
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
      </div>
    </DesktopShell>
  )
}
