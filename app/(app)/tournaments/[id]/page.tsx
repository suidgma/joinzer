export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'
import type { TournamentDetail } from '@/lib/types'
import DivisionsSection from '@/components/features/tournaments/DivisionsSection'
import MatchesSection from '@/components/features/tournaments/MatchesSection'
import GroupChat from '@/components/features/GroupChat'
import DeleteTournamentButton from '@/components/features/tournaments/DeleteTournamentButton'
import SetupChecklist from '@/components/features/tournaments/SetupChecklist'
import MyMatchesSection from '@/components/features/tournaments/MyMatchesSection'
import DiscountCodesSection from '@/components/features/tournaments/DiscountCodesSection'
import ShareButton from '@/components/features/ShareButton'
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

export default async function TournamentDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data }, { data: divisionsRaw }, { data: regsRaw }, { data: matchesData }, { data: tournamentMessages }, { data: discountCodes }] = await Promise.all([
    db
      .from('tournaments')
      .select(`
        id, name, description, start_date, start_time, estimated_end_time,
        status, visibility, registration_status, registration_closes_at, organizer_id,
        cost_cents, location_id,
        location:locations!location_id (id, name, subarea),
        organizer:profiles!organizer_id (name),
        created_at, updated_at
      `)
      .eq('id', params.id)
      .single(),
    db
      .from('tournament_divisions')
      .select('id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, format_type, format_settings_json, cost_cents')
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true }),
    db
      .from('tournament_registrations')
      .select('id, division_id, user_id, partner_user_id, team_name, status, payment_status, stripe_payment_intent_id, checked_in')
      .eq('tournament_id', params.id),
    db
      .from('tournament_matches')
      .select(`
        id, division_id, round_number, match_number, match_stage, pool_number,
        court_number, scheduled_time, team_1_registration_id, team_2_registration_id,
        team_1_score, team_2_score, winner_registration_id, status
      `)
      .eq('tournament_id', params.id)
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
  ])

  if (!data) notFound()

  const costCents: number = (data as any).cost_cents ?? 0

  const tournament = data as unknown as TournamentDetail
  const isOrganizer = user?.id === tournament.organizer_id

  // Slice 3 will add schedule/standings/players/comms sub-routes; add them here then.
  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/tournaments/${params.id}` },
    { label: 'Edit',     href: `/tournaments/${params.id}/edit` },
  ]
  const todayVegas = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const deadlinePassed = tournament.registration_closes_at != null && tournament.registration_closes_at < todayVegas
  const regOpen = tournament.registration_status === 'open' && !deadlinePassed

  const startFormatted = formatTime(tournament.start_time)
  const endFormatted = formatTime(tournament.estimated_end_time)
  const timeRange = startFormatted
    ? endFormatted ? `${startFormatted} – ${endFormatted}` : startFormatted
    : null

  const allUserIds = Array.from(new Set((regsRaw ?? []).map((r: any) => r.user_id).filter(Boolean)))
  const { data: profilesRaw } = allUserIds.length > 0
    ? await db.from('profiles').select('id, name').in('id', allUserIds)
    : { data: [] }
  const profileNames: Record<string, string> = {}
  for (const p of profilesRaw ?? []) profileNames[p.id] = p.name

  // Shared page header — used by both organizer and player views
  const pageHeader = (
    <>
      <div className="flex items-center justify-between">
        <Link href="/tournaments" className="text-brand-muted text-sm">← Back</Link>
        <ShareButton
          title={tournament.name}
          url={`${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.joinzer.com'}/tournaments/${tournament.id}`}
        />
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
            regOpen ? 'bg-brand-soft text-brand-active' : 'bg-gray-100 text-gray-500'
          }`}>
            {regOpen ? 'Registration Open' : deadlinePassed ? 'Deadline Passed' : 'Registration Closed'}
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
              {formatDate(tournament.registration_closes_at)}
            </p>
          </div>
        )}
        {tournament.organizer && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">👤</span>
            <div>
              <p className="text-sm text-brand-dark">Organizer: {tournament.organizer.name}</p>
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
        user_profile: { name: profileNames[reg.user_id] ?? null },
      })
    }
    const divisionsForOrg = (divisionsRaw ?? []).map((div: any) => ({
      ...div,
      tournament_registrations: regsByDivisionOrg[div.id] ?? [],
    }))
    const matchesForOrg = (matchesData ?? []) as any[]

    const orgRegs: OrgRegistration[] = (regsRaw ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      division_id: r.division_id,
      team_name: r.team_name ?? null,
      status: r.status,
      player_name: profileNames[r.user_id] ?? null,
      partner_user_id: r.partner_user_id ?? null,
      checked_in: r.checked_in ?? false,
    }))

    const orgDivisions: OrgDivision[] = (divisionsRaw ?? []).map((d: any) => ({
      id: d.id,
      name: d.name,
      format_type: d.format_type,
    }))

    const orgMatches: OrgMatch[] = (matchesData ?? []) as OrgMatch[]

    return (
      <DesktopShell sidebar={<ManageNav items={navItems} />}>
        <ManageNav items={navItems} mobileOnly />
        <div className="space-y-4 pb-8">
          {pageHeader}

          {/* Setup checklist — shown until all steps are done */}
          <SetupChecklist
            hasDivisions={divisionsForOrg.length > 0}
            regOpen={tournament.registration_status === 'open'}
            published={tournament.status === 'published'}
            hasMatches={orgMatches.length > 0}
          />

          {/* Edit / Delete actions */}
          <div className="space-y-2">
            <Link
              href={`/tournaments/${tournament.id}/edit`}
              className="block w-full text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
            >
              Edit Tournament
            </Link>
            <div className="flex justify-center">
              <DeleteTournamentButton tournamentId={tournament.id} />
            </div>
          </div>

          {/* Divisions + player registration — setup tools always visible to organizer */}
          <DivisionsSection
            tournamentId={tournament.id}
            initialDivisions={divisionsForOrg}
            isOrganizer={true}
            currentUserId={user!.id}
            tournamentCostCents={costCents}
          />

          {/* Discount codes */}
          <div className="bg-white border border-brand-border rounded-2xl p-4">
            <DiscountCodesSection
              tournamentId={tournament.id}
              initialCodes={(discountCodes ?? []) as any[]}
            />
          </div>

          {/* Match generation + schedule manager */}
          {divisionsForOrg.length > 0 && (
            <MatchesSection
              tournamentId={tournament.id}
              divisions={divisionsForOrg}
              initialMatches={matchesForOrg}
              isOrganizer={true}
              tournamentDate={tournament.start_date}
              defaultStartTime={tournament.start_time ?? '08:00'}
              defaultEndTime={tournament.estimated_end_time ?? null}
            />
          )}

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
  const regsByDivision: Record<string, any[]> = {}
  for (const reg of regsRaw ?? []) {
    if (!regsByDivision[reg.division_id]) regsByDivision[reg.division_id] = []
    regsByDivision[reg.division_id].push({
      ...reg,
      user_profile: { name: profileNames[reg.user_id] ?? null },
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
          (reg: any) => reg.user_id === user.id && reg.status === 'registered'
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
            initialDivisions={divisions}
            isOrganizer={false}
            currentUserId={user?.id ?? null}
            tournamentCostCents={costCents}
          />
        )}

        {user && matches.length > 0 && (
          <MyMatchesSection
            currentUserId={user.id}
            matches={matches}
            divisions={divisions}
          />
        )}

        {divisions.length > 0 && (
          <MatchesSection
            tournamentId={tournament.id}
            divisions={divisions}
            initialMatches={matches}
            isOrganizer={false}
            tournamentDate={tournament.start_date}
            defaultStartTime={tournament.start_time ?? '08:00'}
            defaultEndTime={tournament.estimated_end_time ?? null}
          />
        )}

        {user && (
          <section className="space-y-2">
            <h2 className="font-heading text-base font-bold text-brand-dark">Tournament Chat</h2>
            <GroupChat
              table="tournament_messages"
              entityId={tournament.id}
              entityField="tournament_id"
              initialMessages={(tournamentMessages ?? []) as any[]}
              currentUserId={user.id}
              canChat={isRegistered}
            />
          </section>
        )}
      </div>
    </DesktopShell>
  )
}
