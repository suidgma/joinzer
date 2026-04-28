import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import LeagueActions from './LeagueActions'
import SessionSubList from './SessionSubList'

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

export default async function LeagueDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: sessions }, { data: myReg }, { data: mySubInterest }, { data: regCounts }, { data: mySessionSubs }, { data: myProfile }] = await Promise.all([
    supabase
      .from('leagues')
      .select('*, organization:organizations(name)')
      .eq('id', params.id)
      .single(),
    supabase
      .from('league_sessions')
      .select('id, session_date, session_number, status, notes')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
    user
      ? supabase.from('league_registrations').select('status').eq('league_id', params.id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    user
      ? supabase.from('league_sub_interest').select('id').eq('league_id', params.id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from('league_registrations')
      .select('status')
      .eq('league_id', params.id)
      .neq('status', 'cancelled'),
    user
      ? supabase.from('league_session_subs').select('session_id').eq('user_id', user.id)
      : Promise.resolve({ data: [] }),
    user
      ? supabase.from('profiles').select('gender').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
  ])

  if (!league) notFound()

  const isManager = user?.id === league.created_by
  const mySubSessionIds = new Set((mySessionSubs ?? []).map((s) => s.session_id as string))
  const registeredCount = regCounts?.filter((r) => r.status === 'registered').length ?? 0
  const waitlistCount = regCounts?.filter((r) => r.status === 'waitlist').length ?? 0
  const isFull = league.max_players != null && registeredCount >= league.max_players

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
    d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/compete" className="text-brand-muted text-sm">← Compete</Link>
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
        <Row label="Format" value={FORMAT_LABELS[league.format]} />
        <Row label="Skill Level" value={SKILL_LABELS[league.skill_level]} />
        {league.location_name && <Row label="Location" value={league.location_name} />}
        {league.schedule_description && <Row label="Schedule" value={league.schedule_description} />}
        {fmt(league.start_date) && <Row label="Starts" value={fmt(league.start_date)!} />}
        {fmt(league.end_date) && <Row label="Ends" value={fmt(league.end_date)!} />}
        {league.play_days != null && <Row label="Play Days" value={`${league.play_days}`} />}
        {league.games_per_session != null && <Row label="Games/Session" value={`${league.games_per_session}`} />}
        {league.max_players != null && (
          <Row label="Players" value={`${registeredCount} registered${waitlistCount > 0 ? ` · ${waitlistCount} waitlisted` : ''} / ${league.max_players} max`} />
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
        <LeagueActions
          leagueId={league.id}
          registrationStatus={league.registration_status}
          myReg={myReg?.status ?? null}
          mySubInterest={!!mySubInterest}
          isFull={isFull}
        />
      )}
      {!user && (
        <p className="text-sm text-brand-muted text-center">
          <Link href="/login" className="text-brand-active underline">Sign in</Link> to register or express sub interest.
        </p>
      )}

      {/* Standings link */}
      <Link
        href={`/compete/leagues/${league.id}/standings`}
        className="block w-full text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
      >
        View Standings →
      </Link>

      {/* Sessions list */}
      {sessions && sessions.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Schedule</h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-dark">
                    Session {s.session_number} — {new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {s.notes && <p className="text-xs text-brand-muted">{s.notes}</p>}
                  <div className="flex gap-3 mt-1">
                    {(s.status === 'completed' || s.status === 'in_progress') && (
                      <Link href={`/compete/leagues/${league.id}/sessions/${s.id}/results`} className="text-xs text-brand-active underline underline-offset-2">
                        Results →
                      </Link>
                    )}
                    {isManager && s.status === 'in_progress' && (
                      <Link href={`/compete/leagues/${league.id}/sessions/${s.id}/live`} className="text-xs text-brand-active underline underline-offset-2">
                        Live →
                      </Link>
                    )}
                    {isManager && s.status === 'scheduled' && (
                      <Link href={`/compete/leagues/${league.id}/sessions/${s.id}/results`} className="text-xs text-brand-muted underline underline-offset-2">
                        Enter results →
                      </Link>
                    )}
                  </div>
                </div>
                <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                  s.status === 'completed' ? 'bg-brand-soft text-brand-muted' :
                  s.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                  s.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  'bg-brand text-brand-dark'
                }`}>{s.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Session sub availability for non-registered users */}
      {user && sessions && sessions.length > 0 && (myReg?.status === null || myReg?.status === 'cancelled' || !myReg) && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Sub Availability</h2>
          <p className="text-xs text-brand-muted">Mark the specific sessions you&apos;re available to sub.</p>
          <SessionSubList
            sessions={sessions}
            mySubSessionIds={mySubSessionIds}
          />
        </section>
      )}

      {/* Manager view */}
      {isManager && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Manager</h2>
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            <p className="text-sm text-brand-body">{registeredCount} registered · {waitlistCount} waitlisted</p>
            <Link href={`/compete/leagues/${league.id}/roster`} className="block text-sm text-brand-active underline underline-offset-2">
              Roster & subs →
            </Link>
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
