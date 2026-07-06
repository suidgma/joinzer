import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { distributeIntoBoxes } from '@/lib/leagues/boxAssignment'
import type { SeededItem } from '@/components/features/leagues/SeededRoster'
import BoxAttendanceManager, { type BoxAttendee } from './BoxAttendanceManager'
import BoxSeedingSection from '../roster/BoxSeedingSection'
import BoxFixtures, { type BoxView } from '../roster/BoxFixtures'
import BoxCycleBar from '../roster/BoxCycleBar'

export const dynamic = 'force-dynamic'

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export default async function BoxRunSessionPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, format, format_kind, format_settings_json, points_to_win')
    .eq('id', params.id)
    .single()
  if (!league) notFound()

  // Run Session is box-only for now (round-robin uses the session live page).
  if ((league as any).format_kind !== 'box') redirect(`/leagues/${params.id}`)

  // Organizer or co-admin only.
  const { data: myReg } = await supabase
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  const isAdmin = league.created_by === user.id || myReg?.is_co_admin === true
  if (!isAdmin) redirect(`/leagues/${params.id}`)

  const doubles = isDoublesFormat((league as any).format)

  const { data: regs } = await supabase
    .from('league_registrations')
    .select('id, user_id, status, payment_status, partner_registration_id, profile:profiles!user_id(id, name, dupr_rating, estimated_rating)')
    .eq('league_id', params.id)
    .neq('status', 'cancelled')
  const byRegId = new Map((regs ?? []).map((r: any) => [r.id, r]))
  const nameOf = (regId: string | null): string => {
    if (!regId) return 'Player'
    const reg: any = byRegId.get(regId)
    if (!reg) return 'Player'
    const a = firstName(reg.profile?.name)
    if (!doubles) return a || 'Player'
    const partner: any = reg.partner_registration_id ? byRegId.get(reg.partner_registration_id) : null
    const b = partner ? firstName(partner.profile?.name) : ''
    return b ? `${a}/${b}` : (a || 'Team')
  }

  // ── Box structure — box tables are RLS deny-all, so read via the service role. ──
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: cycle } = await admin
    .from('league_periods')
    .select('id, period_number')
    .eq('league_id', params.id)
    .eq('period_kind', 'cycle')
    .eq('status', 'active')
    .order('period_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: boxes } = cycle
    ? await admin.from('league_boxes').select('id, tier_rank, name').eq('period_id', cycle.id).order('tier_rank', { ascending: true })
    : { data: [] as any[] }
  const boxIds = (boxes ?? []).map((b: any) => b.id)
  const { data: members } = boxIds.length
    ? await admin.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', boxIds)
    : { data: [] as any[] }
  const { data: attendance } = cycle
    ? await admin.from('league_attendance').select('id, registration_id, user_id, guest_name, status, subbing_for_registration_id').eq('period_id', cycle.id)
    : { data: [] as any[] }
  const { data: fixtures } = boxIds.length
    ? await admin
        .from('league_fixtures')
        .select('id, box_id, match_number, round_number, team_1_registration_id, team_2_registration_id, status, team_1_score, team_2_score')
        .eq('period_id', cycle!.id)
        .order('match_number', { ascending: true })
    : { data: [] as any[] }

  // Seeding is one-time setup: once ANY matches have been generated for this league
  // (the first cycle), the boxes are locked in and the seeding section never shows
  // again — later cycles form their boxes automatically via promotion/relegation.
  const { count: totalFixtures } = await admin
    .from('league_fixtures')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', params.id)
  const hasGeneratedMatches = (totalFixtures ?? 0) > 0

  // ── Seeding entrants — the organizer picks the number of boxes and players fill
  //    them evenly. The setup step, shown only until the cycle's matches start. ──
  const registered = (regs ?? []).filter((r: any) => r.status === 'registered')
  const settled = registered.filter((r: any) => r.payment_status == null || ['paid', 'waived', 'comped', 'free'].includes(r.payment_status))
  const settledById = new Map(settled.map((r: any) => [r.id, r]))
  const ratingOf = (reg: any): number | null => reg?.profile?.dupr_rating ?? reg?.profile?.estimated_rating ?? null
  const teamRating = (reg: any): number | null => {
    const r1 = ratingOf(reg)
    if (!doubles) return r1
    const partner: any = reg?.partner_registration_id ? settledById.get(reg.partner_registration_id) : null
    const r2 = partner ? ratingOf(partner) : null
    if (r1 != null && r2 != null) return (r1 + r2) / 2
    return r1 ?? r2
  }
  const entrantIds = doubles ? dedupeRegistrationsToTeams(settled) : settled.map((r: any) => r.id)
  let ordered = entrantIds
  let boxesDirty = true
  if (boxIds.length) {
    const tierByBox = new Map((boxes ?? []).map((b: any) => [b.id, b.tier_rank]))
    const existing = (members ?? [])
      .slice()
      .sort((a: any, b: any) => (tierByBox.get(a.box_id)! - tierByBox.get(b.box_id)!) || (a.seed_in_box - b.seed_in_box))
      .map((m: any) => m.registration_id)
      .filter((id: string) => settledById.has(id))
    const inBox = new Set(existing)
    ordered = [...existing, ...entrantIds.filter((id: string) => !inBox.has(id))]
    const persistedStructure = (boxes ?? []).map((b: any) =>
      (members ?? [])
        .filter((m: any) => m.box_id === b.id)
        .sort((x: any, y: any) => (x.seed_in_box ?? 0) - (y.seed_in_box ?? 0))
        .map((m: any) => m.registration_id)
        .filter((rid: string) => settledById.has(rid)))
    const previewStructure = distributeIntoBoxes(ordered, (boxes ?? []).length).map(bp => bp.members.map(m => m.registrationId))
    boxesDirty = JSON.stringify(persistedStructure) !== JSON.stringify(previewStructure)
  }
  if (ordered === entrantIds) {
    ordered = [...entrantIds].sort((a: string, b: string) =>
      (teamRating(settledById.get(b)) ?? -Infinity) - (teamRating(settledById.get(a)) ?? -Infinity))
  }
  const boxEntrants: SeededItem[] = ordered.map((id: string) => ({ id, name: nameOf(id), rating: teamRating(settledById.get(id)) }))

  // Box-count control: default to the saved number of boxes, else the remembered
  // setting, else ~4 per box. Cap so no box can end up with a single player.
  const maxBoxes = Math.max(1, Math.floor(boxEntrants.length / 2))
  const savedBoxCount = (boxes ?? []).length
  const defaultBoxCount = savedBoxCount > 0
    ? savedBoxCount
    : (((league as any).format_settings_json?.num_boxes as number) ?? Math.max(1, Math.round(boxEntrants.length / 4)))
  const initialBoxCount = Math.max(1, Math.min(defaultBoxCount, maxBoxes))

  // ── Attendance rows (box members grouped by box; sub/guest rows separately). ──
  const attByReg = new Map<string, any>()
  for (const a of attendance ?? []) if (a.registration_id) attByReg.set(a.registration_id, a)
  const membersByBox = new Map<string, any[]>()
  for (const m of members ?? []) {
    if (!membersByBox.has(m.box_id)) membersByBox.set(m.box_id, [])
    membersByBox.get(m.box_id)!.push(m)
  }
  const boxMemberRegIds = new Set((members ?? []).map((m: any) => m.registration_id))

  // Resolve display names for sub/guest rows — subs can be any profile (like
  // round-robin), not just league registrants, so their name comes from `profiles`.
  const attendeeUserIds = [...new Set((attendance ?? []).map((a: any) => a.user_id).filter(Boolean))] as string[]
  const { data: subProfiles } = attendeeUserIds.length > 0
    ? await supabase.from('profiles').select('id, name').in('id', attendeeUserIds)
    : { data: [] as any[] }
  const nameByUserId = new Map((subProfiles ?? []).map((p: any) => [p.id, p.name]))

  const attendees: BoxAttendee[] = []
  for (const box of boxes ?? []) {
    const boxName = (box as any).name ?? `Box ${(box as any).tier_rank}`
    const boxMembers = (membersByBox.get(box.id) ?? []).slice().sort((a, b) => (a.seed_in_box ?? 0) - (b.seed_in_box ?? 0))
    for (const m of boxMembers) {
      // Skip members whose registration was removed/cancelled since the boxes were
      // seeded — they shouldn't appear as ghost "Player" rows or be scheduled.
      if (!byRegId.has(m.registration_id)) continue
      const att = attByReg.get(m.registration_id)
      attendees.push({
        rowId: m.registration_id,
        attendanceId: att?.id ?? null,
        registrationId: m.registration_id,
        kind: 'roster',
        displayName: nameOf(m.registration_id),
        status: att?.status ?? 'not_present',
        teamName: boxName,
        subbingForRegistrationId: null,
      })
    }
  }
  for (const a of attendance ?? []) {
    if (a.registration_id && boxMemberRegIds.has(a.registration_id)) continue
    const isGuest = !a.registration_id && !a.user_id && !!a.guest_name
    attendees.push({
      rowId: a.id,
      attendanceId: a.id,
      registrationId: a.registration_id ?? null,
      kind: isGuest ? 'guest' : 'sub',
      displayName: a.registration_id
        ? nameOf(a.registration_id)
        : (a.user_id ? (nameByUserId.get(a.user_id) ?? 'Sub') : (a.guest_name ?? 'Guest')),
      status: a.status,
      subbingForRegistrationId: a.subbing_for_registration_id ?? null,
    })
  }

  // Sub pool = any profile not already playing or subbing this cycle — mirrors
  // round-robin's Add Sub, so it's never empty just because everyone is boxed.
  const boxMemberUserIds = (regs ?? []).filter((r: any) => boxMemberRegIds.has(r.id)).map((r: any) => r.user_id).filter(Boolean)
  const excludeUserIds = [...new Set([...boxMemberUserIds, ...attendeeUserIds])] as string[]
  const poolQuery = supabase.from('profiles').select('id, name').order('name')
  const { data: profilePool } = excludeUserIds.length > 0
    ? await poolQuery.not('id', 'in', `(${excludeUserIds.join(',')})`)
    : await poolQuery
  const availableSubs = (profilePool ?? []).map((p: any) => ({ userId: p.id as string, name: p.name ?? 'Player' }))

  // ── Matches ──
  const fxByBox = new Map<string, any[]>()
  for (const f of fixtures ?? []) {
    if (!fxByBox.has(f.box_id)) fxByBox.set(f.box_id, [])
    fxByBox.get(f.box_id)!.push(f)
  }
  const boxViews: BoxView[] = (boxes ?? []).map((b: any) => ({
    id: b.id,
    name: b.name ?? `Box ${b.tier_rank}`,
    matches: (fxByBox.get(b.id) ?? []).map((f: any) => ({
      id: f.id,
      round: f.round_number ?? null,
      name1: nameOf(f.team_1_registration_id),
      name2: nameOf(f.team_2_registration_id),
      status: f.status,
      score1: f.team_1_score,
      score2: f.team_2_score,
    })),
  }))
  const hasFixtures = boxViews.some(b => b.matches.length > 0)
  const incomplete = boxViews.reduce((n, b) => n + b.matches.filter(m => m.status !== 'completed').length, 0)

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${params.id}` },
    { label: 'Standings', href: `/leagues/${params.id}/standings` },
    { label: 'Roster', href: `/leagues/${params.id}/roster` },
    { label: 'Edit', href: `/leagues/${params.id}/edit` },
  ]
  const header = (
    <div className="flex items-center gap-3">
      <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      <span className="text-brand-muted text-sm">/</span>
      <span className="text-sm font-medium text-brand-dark">Run Session</span>
    </div>
  )

  // The seeding (choose boxes) is one-time setup — show it only until the league's
  // first matches are generated. After that, boxes are locked and later cycles form
  // automatically via promotion/relegation.
  const showSeeding = !hasGeneratedMatches && boxEntrants.length > 0

  return (
    <DesktopShell header={header} sidebar={<ManageNav items={navItems} />}>
      <ManageNav items={navItems} mobileOnly />
      <div className="max-w-2xl space-y-4 pb-8">
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-dark">
            Run Session{cycle ? ` · Cycle ${(cycle as any).period_number}` : ''}
          </h1>
          <p className="text-xs text-brand-muted">
            {!cycle
              ? 'Choose the number of boxes, seed players, and save to start Cycle 1.'
              : showSeeding
              ? 'Set up your boxes, mark who’s here, then generate matches (only players marked Here are scheduled).'
              : 'Mark who’s here, then generate and score this cycle’s matches. Only players marked Here are scheduled.'}
          </p>
        </div>

        {showSeeding && (
          <BoxSeedingSection leagueId={params.id} initialBoxCount={initialBoxCount} maxBoxes={maxBoxes} entrants={boxEntrants} initialSaved={!boxesDirty} />
        )}

        {!cycle && boxEntrants.length === 0 && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
            <p className="text-2xl">🏓</p>
            <p className="text-sm font-medium text-brand-dark">No players yet</p>
            <p className="text-xs text-brand-muted">Add players on the Roster screen, then seed them into boxes here.</p>
          </div>
        )}

        {cycle && (
          <>
            <BoxAttendanceManager
              leagueId={params.id}
              periodId={cycle.id}
              initialAttendees={attendees}
              availableSubs={availableSubs}
            />
            <BoxFixtures
              leagueId={params.id}
              boxes={boxViews}
              pointsToWin={(league as any).points_to_win ?? 11}
            />
            {hasFixtures && (
              <BoxCycleBar
                leagueId={params.id}
                cycleNumber={(cycle as any).period_number}
                canAdvance
                incomplete={incomplete}
              />
            )}
          </>
        )}
      </div>
    </DesktopShell>
  )
}
