export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getSiteUrl } from '@/lib/utils/site-url'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'
import type { TournamentDetail } from '@/lib/types'
import DivisionsSection from '@/components/features/tournaments/DivisionsSection'
import ChatPanel from '@/components/features/ChatPanel'
import DeleteTournamentButton from '@/components/features/tournaments/DeleteTournamentButton'
import SetupChecklist from '@/components/features/tournaments/SetupChecklist'
import OrganizerCreatedBanner from '@/components/features/OrganizerCreatedBanner'
import MyMatchesSection from '@/components/features/tournaments/MyMatchesSection'
import DiscountCodesSection from '@/components/features/tournaments/DiscountCodesSection'
import ShareButton from '@/components/features/ShareButton'
import RefreshButton from '@/components/ui/RefreshButton'
import TournamentOrganizerView from './organizer/_components/TournamentOrganizerView'
import type { OrgRegistration, OrgDivision, OrgMatch } from './organizer/_components/types'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'

function formatDate(dateStr: string) {
  return formatSessionDate(dateStr, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(timeStr: string | null | undefined) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:     'bg-yellow-100 text-yellow-800',
    published: 'bg-brand-soft text-brand-active',
    cancelled: 'bg-red-100 text-red-700',
    completed: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

export default async function TournamentDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const params = await props.params;
  const justCreated = (await props.searchParams)?.created === '1';
  const supabase = createClient()
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data }, { data: divisionsRaw }, { data: regsRaw }, { data: matchesData }, { data: tournamentMessages }, { data: discountCodes }, { data: staffRow }, { data: locationsData }] = await Promise.all([
    db
      .from('tournaments')
      .select(`
        id, name, description, start_date, start_time, estimated_end_time, additional_days,
        status, visibility, registration_status, registration_closes_at, organizer_id,
        cost_cents, contact_name, location_id, default_win_by, default_games_to, default_bracket_type, scheduling_method, show_seeds,
        location:locations!location_id (id, name, subarea, court_count),
        organizer:profiles!organizer_id (name),
        created_at, updated_at
      `)
      .eq('id', params.id)
      .single(),
    db
      .from('tournament_divisions')
      .select('id, name, format, category, team_type, partner_mode, skill_min, skill_max, max_entries, waitlist_enabled, status, bracket_type, scheduling_method, format_settings_json, cost_cents, min_age, max_age, start_time, location_id, show_seeds')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true }),
    db
      .from('tournament_registrations')
      .select('id, division_id, user_id, partner_user_id, partner_registration_id, team_name, status, payment_status, stripe_payment_intent_id, checked_in, seed')
      .eq('tournament_id', params.id),
    db
      .from('tournament_matches')
      .select(`
        id, division_id, round_number, match_number, match_stage, pool_number,
        court_number, scheduled_time, team_1_registration_id, team_2_registration_id,
        team_1_score, team_2_score, winner_registration_id, status, team_1_source, team_2_source
      `)
      .eq('tournament_id', params.id)
      .eq('is_draft', false)
      .order('match_number', { ascending: true }),
    db
      .from('tournament_messages')
      .select('id, user_id, message_text, created_at, profile:profiles!user_id(name)')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true })
      .limit(100),
    db
      .from('tournament_discount_codes')
      .select('id, code, description, discount_type, discount_value, max_uses, uses_count, expires_at, is_active')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true }),
    user
      ? db.from('tournament_staff').select('role').eq('tournament_id', params.id).eq('user_id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('locations').select('id, name, court_count, access_type, subarea').eq('is_active', true).order('sort_order', { ascending: true }),
  ])

  if (!data) notFound()

  const costCents: number = (data as any).cost_cents ?? 0

  const tournament = data as unknown as TournamentDetail
  const isOrganizer = user?.id === tournament.organizer_id
  const isCoOrganizer = staffRow?.role === 'co_organizer'
  const canEdit = isOrganizer || isCoOrganizer

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/tournaments/${params.id}` },
    ...(canEdit ? [
      { label: 'Schedule', href: `/tournaments/${params.id}/schedule` },
      { label: 'Schedule Builder', href: `/tournaments/${params.id}/schedule/builder` },
      { label: 'Standings', href: `/tournaments/${params.id}/standings` },
      { label: 'Players', href: `/tournaments/${params.id}/players` },
    ] : []),
    // Offline run mode is the LEAD organizer's tool — one offline writer per tournament
    // (docs/phases/offline-multi-device-phase-3.md, Option 1). Co-organizers/volunteers score
    // via the live views (online), so they don't queue offline writes that can't converge.
    ...(isOrganizer ? [{ label: 'Run offline (no wifi)', href: `/tournaments/${params.id}/run` }] : []),
    ...(canEdit ? [
      { label: 'Edit', href: `/tournaments/${params.id}/edit` },
    ] : []),
  ]
  const deadlinePassed = tournament.registration_closes_at != null && new Date() > new Date(tournament.registration_closes_at)
  const isDraft = tournament.status === 'draft'
  // Registration is only truly open once the tournament is published — a draft
  // is invisible to players, so "Registration Open" would be misleading there.
  const regOpen = tournament.status === 'published' && tournament.registration_status === 'open' && !deadlinePassed

  const startFormatted = formatTime(tournament.start_time)
  const endFormatted = formatTime(tournament.estimated_end_time)
  const timeRange = startFormatted
    ? endFormatted ? `${startFormatted} – ${endFormatted}` : startFormatted
    : null

  const allUserIds = Array.from(new Set([
    ...(regsRaw ?? []).map((r: any) => r.user_id),
    ...(regsRaw ?? []).map((r: any) => r.partner_user_id),
  ].filter(Boolean)))
  const { data: profilesRaw } = allUserIds.length > 0
    ? await db.from('profiles').select('id, name, is_stub, gender, dupr_rating, estimated_rating, rating_source').in('id', allUserIds)
    : { data: [] }
  const profileNames: Record<string, string> = {}
  const profileStubs: Record<string, boolean> = {}
  const profileRatings: Record<string, { dupr_rating: number | null; estimated_rating: number | null }> = {}
  const profileById: Record<string, any> = {}
  for (const p of profilesRaw ?? []) {
    profileNames[p.id] = p.name
    if (p.is_stub) profileStubs[p.id] = true
    profileRatings[p.id] = { dupr_rating: p.dupr_rating ?? null, estimated_rating: p.estimated_rating ?? null }
    profileById[p.id] = p
  }

  // Shared page header — used by both organizer and player views
  const pageHeader = (
    <>
      <div className="flex items-center justify-between">
        <Link href="/tournaments" className="text-brand-muted text-sm">← Back</Link>
        <div className="flex items-center gap-3">
          <RefreshButton />
          <ShareButton
            title={tournament.name}
            url={`${getSiteUrl()}/tournaments/${tournament.id}`}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 uppercase">
              Tournament
            </span>
            <StatusBadge status={tournament.status} />
          </div>
          <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-semibold ${
            regOpen ? 'bg-brand-soft text-brand-active'
              : isDraft ? 'bg-amber-50 text-amber-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {isDraft ? 'Opens when published'
              : regOpen ? 'Registration Open'
              : deadlinePassed ? 'Deadline Passed'
              : 'Registration Closed'}
          </span>
        </div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">{tournament.name}</h1>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
        {tournament.location && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">📍</span>
            <div>
              <p className="text-sm font-medium text-brand-dark">{tournament.location.name}</p>
              {tournament.location.subarea && (
                <p className="text-xs text-brand-muted">{tournament.location.subarea}</p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className="text-brand-muted text-xs pt-0.5">📅</span>
          <div>
            <p className="text-sm font-medium text-brand-dark">{formatDate(tournament.start_date)}</p>
            {timeRange && <p className="text-xs text-brand-muted">{timeRange}</p>}
          </div>
        </div>
        {tournament.registration_closes_at && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">⏰</span>
            <p className={`text-sm ${deadlinePassed ? 'text-red-500 font-medium' : 'text-brand-dark'}`}>
              {deadlinePassed ? 'Registration closed ' : 'Registration closes '}
              {formatTimestamp(tournament.registration_closes_at!)} PT
            </p>
          </div>
        )}
        {tournament.organizer && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">👤</span>
            <div>
              <p className="text-sm text-brand-dark">
                Organizer: {(tournament as any).contact_name || tournament.organizer.name}
              </p>
              {(tournament as any).contact_email && (
                <a
                  href={`mailto:${(tournament as any).contact_email}`}
                  className="text-xs text-brand-active hover:underline"
                >
                  {(tournament as any).contact_email}
                </a>
              )}
            </div>
          </div>
        )}
        {(matchesData ?? []).length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">🏆</span>
            <Link
              href={`/tournaments/${params.id}/live`}
              className="text-sm text-brand-active font-medium hover:underline"
            >
              View Live Scoreboard →
            </Link>
          </div>
        )}
        {tournament.description && (
          <p className="text-sm text-brand-body leading-relaxed border-t border-brand-border pt-3">
            {tournament.description}
          </p>
        )}
      </div>
    </>
  )

  // --- ORGANIZER VIEW ---
  if (isOrganizer) {
    // Build full divisions shape (with registrations) for DivisionsSection + MatchesSection
    const regsByDivisionOrg: Record<string, any[]> = {}
    for (const reg of regsRaw ?? []) {
      if (!regsByDivisionOrg[reg.division_id]) regsByDivisionOrg[reg.division_id] = []
      regsByDivisionOrg[reg.division_id].push({
        ...reg,
        user_profile: {
          name: profileNames[reg.user_id] ?? null,
          is_stub: profileStubs[reg.user_id] ?? false,
          ...(profileRatings[reg.user_id] ?? {}),
        },
        partner_profile: reg.partner_user_id
          ? {
              name: profileNames[reg.partner_user_id] ?? null,
              ...(profileRatings[reg.partner_user_id] ?? {}),
            }
          : null,
      })
    }
    const divisionsForOrg = (divisionsRaw ?? []).map((div: any) => ({
      ...div,
      tournament_registrations: regsByDivisionOrg[div.id] ?? [],
    }))
    const matchesForOrg = (matchesData ?? []) as any[]

    const matchCountByDivision: Record<string, number> = {}
    const matchesByDivision: Record<string, any[]> = {}
    for (const m of matchesForOrg) {
      matchCountByDivision[m.division_id] = (matchCountByDivision[m.division_id] ?? 0) + 1
      if (!matchesByDivision[m.division_id]) matchesByDivision[m.division_id] = []
      matchesByDivision[m.division_id].push(m)
    }

    // Effective "show seed numbers" per division (division override → tournament
    // default), baked into display_seed so every match label renders it uniformly.
    const orgShowSeeds = new Map<string, boolean>()
    for (const div of (divisionsRaw ?? []) as any[]) {
      orgShowSeeds.set(div.id, (div.show_seeds ?? (tournament as any).show_seeds) === true)
    }
    const orgRegs: OrgRegistration[] = (regsRaw ?? []).map((r: any) => {
      const prof = profileById[r.user_id] ?? {}
      return {
        id: r.id,
        user_id: r.user_id,
        division_id: r.division_id,
        team_name: r.team_name ?? null,
        status: r.status,
        player_name: profileNames[r.user_id] ?? null,
        partner_user_id: r.partner_user_id ?? null,
        partner_registration_id: r.partner_registration_id ?? null,
        checked_in: r.checked_in ?? false,
        payment_status: r.payment_status ?? null,
        display_seed: orgShowSeeds.get(r.division_id) && r.seed != null ? r.seed : null,
        gender: prof.gender ?? null,
        dupr_rating: prof.dupr_rating ?? null,
        estimated_rating: prof.estimated_rating ?? null,
        rating_source: prof.rating_source ?? null,
      }
    })

    const orgDivisions: OrgDivision[] = (divisionsRaw ?? []).map((d: any) => ({
      id: d.id,
      name: d.name,
      bracket_type: d.bracket_type,
      format: d.format ?? '',
    }))

    const orgMatches: OrgMatch[] = (matchesData ?? []) as OrgMatch[]

    return (
      <DesktopShell sidebar={<ManageNav items={navItems} />}>
        <ManageNav items={navItems} mobileOnly />
        <div className="space-y-4 pb-8">
          {pageHeader}

          {justCreated && <OrganizerCreatedBanner kind="tournament" name={tournament.name} />}

          {/* Setup checklist — shown until all steps are done */}
          <SetupChecklist
            tournamentId={tournament.id}
            hasDivisions={divisionsForOrg.length > 0}
            regOpen={tournament.registration_status === 'open'}
            published={tournament.status === 'published'}
            hasMatches={orgMatches.length > 0}
          />

          {/* Edit / Delete / Staff / Import actions */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Link
                href={`/tournaments/${tournament.id}/edit`}
                className="block text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
              >
                Edit
              </Link>
              <Link
                href={`/tournaments/${tournament.id}/staff`}
                className="block text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
              >
                Staff & Roles
              </Link>
              <Link
                href={`/tournaments/${tournament.id}/import`}
                className="block text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
              >
                Import Players
              </Link>
            </div>
            <div className="flex justify-center">
              <DeleteTournamentButton tournamentId={tournament.id} />
            </div>
          </div>

          {/* Divisions + player registration — setup tools always visible to organizer.
              Anchor target for the setup checklist's "Add divisions" step. */}
          <div id="tournament-divisions" className="scroll-mt-20">
          <DivisionsSection
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            initialDivisions={divisionsForOrg}
            isOrganizer={true}
            currentUserId={user!.id}
            tournamentCostCents={costCents}
            registrationClosesAt={tournament.registration_closes_at ?? null}
            tournamentStartDate={tournament.start_date ?? null}
            tournamentStartTime={tournament.start_time ?? null}
            tournamentEndTime={tournament.estimated_end_time ?? null}
            tournamentLocationName={(tournament.location as any)?.name ?? null}
            defaultWinBy={(tournament as any).default_win_by ?? 1}
            defaultGamesTo={(tournament as any).default_games_to ?? 11}
            defaultBracketType={(tournament as any).default_bracket_type ?? 'round_robin'}
            tournamentSchedulingMethod={(tournament as any).scheduling_method ?? 'timed'}
            defaultLocationId={(tournament as any).location_id ?? null}
            locations={(locationsData ?? []) as any[]}
            matchCountByDivision={matchCountByDivision}
            matchesByDivision={matchesByDivision}
          />
          </div>

          {/* Discount codes */}
          <div className="bg-white border border-brand-border rounded-2xl p-4">
            <DiscountCodesSection
              tournamentId={tournament.id}
              initialCodes={(discountCodes ?? []) as any[]}
            />
          </div>

          {/* Operational day-of tabs — useful once matches exist */}
          {orgMatches.length > 0 && (
            <TournamentOrganizerView
              tournamentId={tournament.id}
              tournamentName={tournament.name}
              initialMatches={orgMatches}
              registrations={orgRegs}
              divisions={orgDivisions}
            />
          )}
        </div>
      </DesktopShell>
    )
  }

  // --- PLAYER / SPECTATOR VIEW (unchanged) ---
  // Exclude unpaid and cancelled rows — only settled registrations belong in the player-facing roster.
  // The raw query intentionally returns all rows so the organizer path above can show payment management.
  const settledRegs = (regsRaw ?? []).filter(
    (r: any) => (r.payment_status === 'paid' || r.payment_status === 'waived' || r.payment_status === 'comped') && r.status !== 'cancelled'
  )
  const regsByDivision: Record<string, any[]> = {}
  for (const reg of settledRegs) {
    if (!regsByDivision[reg.division_id]) regsByDivision[reg.division_id] = []
    regsByDivision[reg.division_id].push({
      ...reg,
      user_profile: { name: profileNames[reg.user_id] ?? null },
      partner_profile: reg.partner_user_id ? { name: profileNames[reg.partner_user_id] ?? null } : null,
    })
  }
  const divisions = (divisionsRaw ?? []).map((div: any) => ({
    ...div,
    tournament_registrations: regsByDivision[div.id] ?? [],
  }))
  const matches = (matchesData ?? []) as any[]

  const isRegistered = user
    ? divisions.some((div) =>
        (div.tournament_registrations ?? []).some(
          (reg: any) =>
            reg.user_id === user.id &&
            reg.status === 'registered' &&
            (reg.payment_status === 'paid' || reg.payment_status === 'waived' || reg.payment_status === 'comped')
        )
      )
    : false

  return (
    <DesktopShell sidebar={<ManageNav items={navItems} />}>
      <ManageNav items={navItems} mobileOnly />
      <div className="space-y-4">
        {pageHeader}

        {divisions.length > 0 && (
          <DivisionsSection
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            initialDivisions={divisions}
            isOrganizer={false}
            currentUserId={user?.id ?? null}
            tournamentCostCents={costCents}
            registrationClosesAt={tournament.registration_closes_at ?? null}
            tournamentStartDate={tournament.start_date ?? null}
            tournamentStartTime={tournament.start_time ?? null}
            tournamentEndTime={tournament.estimated_end_time ?? null}
            tournamentLocationName={(tournament.location as any)?.name ?? null}
            defaultWinBy={(tournament as any).default_win_by ?? 1}
            defaultGamesTo={(tournament as any).default_games_to ?? 11}
            defaultBracketType={(tournament as any).default_bracket_type ?? 'round_robin'}
            tournamentSchedulingMethod={(tournament as any).scheduling_method ?? 'timed'}
            defaultLocationId={(tournament as any).location_id ?? null}
            locations={(locationsData ?? []) as any[]}
          />
        )}

        {user && matches.length > 0 && (
          <MyMatchesSection
            currentUserId={user.id}
            matches={matches}
            divisions={divisions}
          />
        )}

        {user && (
          <ChatPanel
            table="tournament_messages"
            entityField="tournament_id"
            entityId={tournament.id}
            initialMessages={(tournamentMessages ?? []) as any[]}
            currentUserId={user.id}
            canChat={isRegistered}
            title="Tournament Chat"
            joinHint="Register to chat"
          />
        )}
      </div>
    </DesktopShell>
  )
}
