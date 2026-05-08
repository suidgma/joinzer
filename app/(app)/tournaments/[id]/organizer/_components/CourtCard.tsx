import type { OrgMatch, OrgRegistration } from './types'
import { teamLabel } from './ScoreEntryModal'

function elapsed(scheduledTime: string | null): string {
  if (!scheduledTime) return ''
  const mins = Math.round((Date.now() - new Date(scheduledTime).getTime()) / 60000)
  if (mins <= 0) return ''
  return `${mins}m`
}

type Props = {
  courtNumber: number
  match: OrgMatch | null
  registrations: OrgRegistration[]
  onUpdateScore: (match: OrgMatch) => void
}

export default function CourtCard({ courtNumber, match, registrations, onUpdateScore }: Props) {
  if (!match) {
    return (
      <div className="rounded-xl border-2 border-dashed border-yellow-300 bg-yellow-50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-yellow-700 uppercase tracking-wide">Court {courtNumber}</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded font-semibold">Idle</span>
        </div>
        {/* TODO: wire "Assign next match" to assign_court RPC once competition_courts table is migrated */}
        <p className="text-xs text-yellow-700">No active match</p>
      </div>
    )
  }

  const t1 = teamLabel(match.team_1_registration_id, registrations)
  const t2 = teamLabel(match.team_2_registration_id, registrations)
  const elapsedStr = elapsed(match.scheduled_time)

  return (
    <div className="rounded-xl border-2 border-brand bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-brand-active uppercase tracking-wide">Court {courtNumber}</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
          <span className="text-[10px] text-brand-muted">{elapsedStr ? `${elapsedStr} in` : 'Live'}</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-brand-dark truncate flex-1">{t1}</span>
          {match.team_1_score != null && (
            <span className="text-2xl font-bold text-brand-dark tabular-nums shrink-0">{match.team_1_score}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-brand-dark truncate flex-1">{t2}</span>
          {match.team_2_score != null && (
            <span className="text-2xl font-bold text-brand-dark tabular-nums shrink-0">{match.team_2_score}</span>
          )}
        </div>
      </div>
      <button
        onClick={() => onUpdateScore(match)}
        className="w-full py-3 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover active:scale-[0.98] transition-all"
      >
        Update Score
      </button>
    </div>
  )
}
