'use client'
import type { OrgMatch, OrgRegistration } from './types'
import { teamLabel } from './ScoreEntryModal'

function fmtTime(scheduled: string | null): string {
  if (!scheduled) return '—'
  return new Date(scheduled).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  })
}

type Props = {
  match: OrgMatch
  registrations: OrgRegistration[]
  tournamentId: string
  onMarkedReady: (matchId: string) => void
  onError: (msg: string) => void
}

export default function UpNextRow({ match, registrations, tournamentId, onMarkedReady, onError }: Props) {
  const t1 = teamLabel(match.team_1_registration_id, registrations)
  const t2 = teamLabel(match.team_2_registration_id, registrations)

  async function handleMarkReady() {
    onMarkedReady(match.id) // optimistic
    const res = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}/ready`, { method: 'POST' })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      onError(json.error ?? 'Failed to mark ready')
    }
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-8 shrink-0 text-center space-y-0.5">
        <span className="text-[10px] font-bold text-brand-muted block">#{match.match_number}</span>
        {match.court_number != null && (
          <span className="text-[10px] text-brand-muted block">C{match.court_number}</span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-xs font-semibold text-brand-dark truncate">{t1} vs {t2}</p>
        <p className="text-[10px] text-brand-muted">{fmtTime(match.scheduled_time)}</p>
      </div>
      <button
        onClick={handleMarkReady}
        className="shrink-0 text-[11px] font-semibold px-3 py-2 rounded-lg bg-brand-soft text-brand-active hover:bg-brand border border-brand-border transition-colors"
      >
        Mark Ready
      </button>
    </div>
  )
}
