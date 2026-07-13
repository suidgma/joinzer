import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'

type Session = {
  id: string
  session_number: number
  session_date: string
  status: string
  notes: string | null
}

type Status = 'planning_to_attend' | 'cannot_attend' | 'checked_in_present' | 'running_late' | 'not_responded'

// Player-facing schedule, grouped into the current session and future ones.
// Current = the latest session whose date has arrived (stays "current" until the
// next one starts); if none has started yet, the first upcoming.
export default function PlayerSchedule({
  leagueId,
  sessions,
  attendanceMap,
  sessionsWithSchedule,
  isRegistered,
  leagueSkillLevel,
  currentUserId,
  selfSubBySession = {},
}: {
  leagueId: string
  sessions: Session[]
  attendanceMap: Record<string, string>
  sessionsWithSchedule: string[]
  isRegistered: boolean
  leagueSkillLevel: string | null
  currentUserId?: string
  selfSubBySession?: Record<string, { id: string; nomineeName: string }>
}) {
  if (sessions.length === 0) {
    return <p className="text-sm text-brand-muted">No sessions scheduled yet.</p>
  }

  const scheduleSet = new Set(sessionsWithSchedule)
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const ordered = [...sessions].sort((a, b) =>
    a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0,
  )
  let idx = -1
  for (let i = 0; i < ordered.length; i++) if (ordered[i].session_date <= todayStr) idx = i
  if (idx === -1) idx = 0
  const currentSession = ordered[idx]
  const futureSessions = ordered.slice(idx + 1)

  const card = (s: Session) => {
    const myStatus = (attendanceMap[s.id] ?? 'not_responded') as Status
    const canCheckIn = isRegistered && s.status === 'scheduled'
    return (
      <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl p-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-dark">
              Session {s.session_number} — {formatSessionDate(s.session_date)}
            </p>
            {s.notes && <p className="text-xs text-brand-muted">{s.notes}</p>}
            {(s.status === 'completed' || s.status === 'in_progress' || scheduleSet.has(s.id)) && (
              <Link href={`/leagues/${leagueId}/sessions/${s.id}/results`} className="text-xs text-brand-active underline underline-offset-2 mt-1 block">
                Schedule &amp; scores →
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
            leagueId={leagueId}
            initialStatus={myStatus}
            leagueSkillLevel={leagueSkillLevel}
            allowSelfSub={!scheduleSet.has(s.id)}
            currentUserId={currentUserId}
            activeSelfSub={selfSubBySession[s.id] ?? null}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-heading text-base font-bold text-brand-dark">Current Session</h2>
        {currentSession && card(currentSession)}
      </div>
      {futureSessions.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Future Sessions</h2>
          <div className="space-y-2">{futureSessions.map(card)}</div>
        </div>
      )}
    </div>
  )
}
