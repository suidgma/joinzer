import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'
import LeagueActions from './LeagueActions'
import DeleteLeagueButton from './DeleteLeagueButton'
import SessionScheduleManager from './SessionScheduleManager'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'
import SubRequestsSection from '@/components/features/leagues/SubRequestsSection'

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual Round Robin',
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  singles: 'Singles',
  custom: 'Custom',
}

const SKILL_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  beginner_plus: 'Beginner+',
  intermediate: 'Intermediate',
  intermediate_plus: 'Intermediate+',
  advanced: 'Advanced',
}

export default async function LeagueDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: sessions }, { data: myReg }, { data: mySubInterest }, { data: regCounts }, { data: mySessionSubs }, { data: myProfile }, { data: myAttendance }, { data: mySubAssignments }, { data: openSubRequests }, { data: leagueMessages }, { data: waitlistRows }] = await Promise.all([
    supabase
      .from('leagues')
      .select('*, cost_cents, organization:organizations(name), creator:profiles!created_by (name)')
      .eq('id', params.id)
      .single(),
    supabase
      .from('league_sessions')
      .select('id, session_date, session_number, status, notes')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
    user
      ? supabase.from('league_registrations').select('status, is_co_admin, registration_type, partner_user_id').eq('league_id', params.id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    user
      ? supabase.from('league_sub_interest').select('id').eq('league_id', params.id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from('league_registrations')
      .select('status, registration_type, partner_user_id')
      .eq('league_id', params.id)
      .neq('status', 'cancelled'),
    user
      ? supabase.from('league_session_subs').select('session_id').eq('user_id', user.id)
      : Promise.resolve({ data: [] }),
    user
      ? supabase.from('profiles').select('gender').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    // Player self-check-in attendance for this league's sessions
    user
      ? supabase.from('league_session_attendance')
          .select('league_session_id, attendance_status')
          .eq('user_id', user.id)
      : Promise.resolve({ data: [] }),
    // Sessions where this user is formally assigned as a sub
    user
      ? supabase.from('league_session_players')
          .select('id, session_id, player_type')
          .eq('user_id', user.id)
          .eq('player_type', 'sub')
      : Promise.resolve({ data: [] }),
    // Open sub requests in this league (not from current user)
    user
      ? supabase.from('league_sub_requests')
          .select(`
            id, league_id, league_session_id, status, notes,
            requesting_player:profiles!requesting_player_id(name),
            claimed_by:profiles!claimed_by_user_id(name),
            session:league_sessions!league_session_id(session_date, session_number),
            league:leagues!league_id(name)
          `)
          .eq('league_id', params.id)
          .eq('status', 'open')
          .neq('requesting_player_id', user.id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from('league_messages')
      .select('id, user_id, message_text, created_at, profile:profiles!user_id(name)')
      .eq('league_id', params.id)
      .order('created_at', { ascending: true })
      .limit(100),
    // Unconditional — simplicity over optimization; waitlist sets are small and this avoids ordering complexity in Promise.all
    supabase
      .from('league_registrations')
      .select('user_id, registered_at')
      .eq('league_id', params.id)
      .eq('status', 'waitlist')
      .order('registered_at', { ascending: true })
      .order('id', { ascending: true }),
  ])

  if (!league) notFound()

  const waitlist = (waitlistRows ?? []) as { user_id: string; registered_at: string | null }[]
  const waitlistTotal = waitlist.length
  const idx = user ? waitlist.findIndex(r => r.user_id === user.id) : -1
  const waitlistPosition = idx >= 0 ? idx + 1 : null

  // Fetch partner name if user is a matched solo
  const partnerUserId = (myReg as any)?.partner_user_id ?? null
  let partnerUserName: string | null = null
  if (partnerUserId) {
    const { data: partnerProfile } = await supabase.from('profiles').select('name').eq('id', partnerUserId).single()
    partnerUserName = partnerProfile?.name ?? null
  }

  const isManager = user?.id === league.created_by
  const isCoAdmin = !isManager && myReg?.is_co_admin === true
  const isAdmin = isManager || isCoAdmin
  const attendanceMap = Object.fromEntries(
    (myAttendance ?? []).map((a) => [a.league_session_id as string, a.attendance_status as string])
  )
  const mySubSessionIds = new Set((mySessionSubs ?? []).map((s) => s.session_id as string))

  // Sessions where the user is an assigned sub (from league_session_players)
  const sessionIdSet = new Set((sessions ?? []).map((s) => s.id))
  const assignedSubSessions = (mySubAssignments ?? [])
    .filter((sp) => sessionIdSet.has(sp.session_id as string))
    .map((sp) => (sessions ?? []).find((s) => s.id === sp.session_id))
    .filter(Boolean)
    .filter((s) => s!.status === 'scheduled' || s!.status === 'in_progress')
  const DOUBLES_FORMATS = ['mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles']
  const isDoublesLeague = DOUBLES_FORMATS.includes(league.format)
  const registeredRegs = regCounts?.filter((r) => r.status === 'registered') ?? []
  const registeredCount = registeredRegs.length
  const waitlistCount = regCounts?.filter((r) => r.status === 'waitlist').length ?? 0
  const isFull = league.max_players != null && registeredCount >= league.max_players

  // For doubles leagues: derive team/solo counts for display
  const soloRegs = isDoublesLeague ? registeredRegs.filter((r) => (r as any).registration_type === 'solo') : []
  const unmatchedSoloCount = soloRegs.filter((r) => !(r as any).partner_user_id).length
  const teamRegsCount = isDoublesLeague ? registeredRegs.filter((r) => (r as any).registration_type === 'team').length : 0
  const effectiveTeams = isDoublesLeague ? teamRegsCount + Math.floor(soloRegs.length / 2) : 0

  const orgName = (league.organization as { name: string } | null)?.name
  const userGender = (myProfile as { gender: string | null } | null)?.gender ?? null

  // Warn if this is a gender-specific format and user hasn't set their gender
  const genderFormats: Record<string, string> = {
    mens_doubles: 'male',
    womens_doubles: 'female',
  }
  const requiredGender = genderFormats[league.format] ?? null
  const genderMismatch = user && requiredGender && userGender !== requiredGender

  const fmt = (d: string | null) =>
    d ? formatSessionDate(d, { weekday: undefined, month: 'long', day: 'numeric', year: 'numeric' }) : null

  // Derive end date from last session so it stays accurate after session edits
  const lastSessionDate = sessions && sessions.length > 0 ? sessions[sessions.length - 1].session_date : null
  const displayEndDate = lastSessionDate ?? league.end_date

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/compete" className="text-brand-muted text-sm">← Back</Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">{league.name}</h1>
        {orgName && <p className="text-sm text-brand-muted">{orgName}</p>}
        {isManager && (
          <Link href={`/compete/leagues/${league.id}/edit`} className="text-xs text-brand-active underline underline-offset-2">
            Edit league
          </Link>
        )}
      </div>

      {/* Details card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
        {(league as any).creator?.name && <Row label="Organizer" value={(league as any).creator.name} />}
        <Row label="Format" value={FORMAT_LABELS[league.format]} />
        <Row label="Skill Level" value={SKILL_LABELS[league.skill_level]} />
        {league.location_name && <Row label="Location" value={league.location_name} />}
        {league.schedule_description && <Row label="Schedule" value={league.schedule_description} />}
        {fmt(league.start_date) && <Row label="Starts" value={fmt(league.start_date)!} />}
        {fmt(displayEndDate) && <Row label="Ends" value={fmt(displayEndDate)!} />}
        {(league as any).registration_closes_at && (
          <Row label="Reg. closes" value={formatTimestamp((league as any).registration_closes_at) + ' PT'} />
        )}
        {league.play_days != null && <Row label="Play Days" value={`${league.play_days}`} />}
        {league.games_per_session != null && <Row label="Games/Play" value={`${league.games_per_session}`} />}
        {league.max_players != null && (
          <Row
            label="Players"
            value={
              isDoublesLeague
                ? `${effectiveTeams}${league.max_players ? `/${Math.floor(league.max_players / 2)}` : ''} teams${unmatchedSoloCount > 0 ? ` (+${unmatchedSoloCount} solo${unmatchedSoloCount > 1 ? 's' : ''} seeking partner)` : ''}${waitlistCount > 0 ? ` · ${waitlistCount} waitlisted` : ''}`
                : `${registeredCount} registered${waitlistCount > 0 ? ` · ${waitlistCount} waitlisted` : ''} / ${league.max_players} max`
            }
          />
        )}
      </div>

      {/* Description */}
      {league.description && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4">
          <p className="text-sm text-brand-body whitespace-pre-wrap">{league.description}</p>
        </div>
      )}

      {/* Gender mismatch warning */}
      {genderMismatch && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800">
          This league is <strong>{requiredGender === 'male' ? "Men's Doubles" : "Women's Doubles"}</strong>.
          {userGender
            ? ' Your profile gender does not match this format.'
            : ' Please '}
          {!userGender && (
            <Link href="/profile/edit" className="underline font-medium">set your gender in your profile</Link>
          )}
          {!userGender ? ' to register.' : (
            <span> <Link href="/profile/edit" className="underline font-medium">Update your profile</Link> if this is incorrect.</span>
          )}
        </div>
      )}

      {/* Registration actions */}
      {user && (
        <>
          {(league as any).cost_cents > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-2">
              <span className="text-base">💳</span>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Registration fee: ${((league as any).cost_cents / 100).toFixed(0)}/person
                </p>
                <p className="text-xs text-amber-700">Paid securely via Stripe</p>
              </div>
            </div>
          )}
          <LeagueActions
            leagueId={league.id}
            leagueName={league.name}
            registrationStatus={league.registration_status}
            myReg={myReg?.status ?? null}
            mySubInterest={!!mySubInterest}
            isFull={isFull}
            costCents={(league as any).cost_cents ?? 0}
            format={league.format}
            partnerUserName={partnerUserName}
            sessions={sessions ?? []}
            mySubSessionIds={Array.from(mySubSessionIds)}
            waitlistPosition={waitlistPosition}
            waitlistTotal={waitlistTotal}
          />
        </>
      )}
      {!user && (
        <p className="text-sm text-brand-muted text-center">
          <Link href="/login" className="text-brand-active underline">Sign in</Link> to register or express sub interest.
        </p>
      )}

      {/* Sub assignments — sessions where user is formally assigned as a sub */}
      {user && assignedSubSessions.length > 0 && (
        <section className="space-y-2">
          <div className="bg-yellow-50 border border-yellow-300 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-yellow-900">You&apos;re subbing in this league</p>
              <p className="text-xs text-yellow-700 mt-0.5">Let the organizer know if you&apos;re coming.</p>
            </div>
            {assignedSubSessions.map((s) => {
              const myStatus = (attendanceMap[s!.id] ?? 'not_responded') as
                'planning_to_attend' | 'cannot_attend' | 'checked_in_present' | 'running_late' | 'not_responded'
              return (
                <div key={s!.id} className="space-y-2">
                  <p className="text-sm font-semibold text-yellow-900">
                    Session {s!.session_number} — {formatSessionDate(s!.session_date)}
                  </p>
                  <PlayerCheckIn
                    sessionId={s!.id}
                    leagueId={league.id}
                    initialStatus={myStatus}
                    showSubRequest={false}
                    leagueSkillLevel={league.skill_level ?? null}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Quick links — Chat + Standings */}
      <div className="grid grid-cols-2 gap-2">
        {user && (
          <Link
            href={`/compete/leagues/${league.id}/chat`}
            className="flex items-center justify-between bg-brand-surface border border-brand rounded-2xl px-4 py-3 hover:bg-brand-soft transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-dark">League Chat</p>
              {leagueMessages && leagueMessages.length > 0 ? (
                <p className="text-xs text-brand-muted truncate">
                  {(leagueMessages[leagueMessages.length - 1] as any).profile?.name?.split(' ')[0] ?? 'Someone'}: {(leagueMessages[leagueMessages.length - 1] as any).message_text}
                </p>
              ) : (
                <p className="text-xs text-brand-muted">No messages yet</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
              {leagueMessages && leagueMessages.length > 0 && (
                <span className="text-[10px] font-bold bg-brand text-brand-dark px-1.5 py-0.5 rounded-full leading-none">
                  {leagueMessages.length}
                </span>
              )}
              <span className="text-brand-active text-sm">→</span>
            </div>
          </Link>
        )}
        <Link
          href={`/compete/leagues/${league.id}/standings`}
          className={`flex items-center justify-between bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 hover:bg-brand-soft transition-colors ${!user ? 'col-span-2' : ''}`}
        >
          <p className="text-sm font-semibold text-brand-dark">Standings</p>
          <span className="text-brand-active text-sm">→</span>
        </Link>
      </div>

      {/* Sessions list — hidden for admins who use the Manage League page instead */}
      {!isAdmin && sessions && sessions.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Schedule</h2>
          {isManager ? (
            <SessionScheduleManager leagueId={league.id} sessions={sessions} />
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const myStatus = (attendanceMap[s.id] ?? 'not_responded') as
                  'planning_to_attend' | 'cannot_attend' | 'checked_in_present' | 'running_late' | 'not_responded'
                const isUpcoming = s.status === 'scheduled'
                const canCheckIn = myReg?.status === 'registered' && isUpcoming

                return (
                  <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-brand-dark">
                          Session {s.session_number} — {formatSessionDate(s.session_date)}
                        </p>
                        {s.notes && <p className="text-xs text-brand-muted">{s.notes}</p>}
                        {(s.status === 'completed' || s.status === 'in_progress') && (
                          <Link href={`/compete/leagues/${league.id}/sessions/${s.id}/results`} className="text-xs text-brand-active underline underline-offset-2 mt-1 block">
                            Results →
                          </Link>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                        s.status === 'completed' ? 'bg-brand-soft text-brand-muted' :
                        s.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        s.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-brand text-brand-dark'
                      }`}>{s.status.replace('_', ' ')}</span>
                    </div>

                    {canCheckIn && (
                      <PlayerCheckIn
                        sessionId={s.id}
                        leagueId={league.id}
                        initialStatus={myStatus}
                        leagueSkillLevel={league.skill_level ?? null}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Open sub requests for registered players */}
      {user && myReg?.status === 'registered' && (openSubRequests ?? []).length > 0 && (
        <SubRequestsSection
          initialRequests={(openSubRequests ?? []) as any[]}
          currentUserId={user.id}
        />
      )}

      {/* Admin view */}
      {isAdmin && (
        <section className="space-y-2">
          {sessions && sessions.length > 0 && (
            <>
              <h2 className="font-heading text-base font-bold text-brand-dark">Schedule</h2>
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-dark">
                        Session {s.session_number} — {formatSessionDate(s.session_date)}
                      </p>
                      {s.notes && <p className="text-xs text-brand-muted truncate">{s.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                        s.status === 'completed' ? 'bg-brand-soft text-brand-muted' :
                        s.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        s.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-brand text-brand-dark'
                      }`}>{s.status.replace('_', ' ')}</span>
                      <Link
                        href={`/compete/leagues/${league.id}/sessions/${s.id}/live`}
                        className="text-sm text-brand-active underline underline-offset-2 whitespace-nowrap"
                      >
                        Manage →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <h2 className="font-heading text-base font-bold text-brand-dark">Court Monitor</h2>
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            <p className="text-sm text-brand-body">{registeredCount} registered · {waitlistCount} waitlisted</p>
            <Link href={`/compete/leagues/${league.id}/roster`} className="block text-sm text-brand-active underline underline-offset-2">
              Manage League →
            </Link>
            {isManager && (
              <div className="pt-2 border-t border-brand-border">
                <DeleteLeagueButton leagueId={league.id} />
              </div>
            )}
          </div>
        </section>
      )}

    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs text-brand-muted w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-brand-dark">{value}</span>
    </div>
  )
}
