'use client'
import { useState } from 'react'
import { Clock } from 'lucide-react'
import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import { teamLabel } from './ScoreEntryModal'
import RescheduleModal from './RescheduleModal'
import { Toast, useToast } from './Toast'

function fmtTime(scheduled: string | null): string {
  if (!scheduled) return '—'
  return new Date(scheduled).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  })
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-brand-soft text-brand-active',
  in_progress: 'bg-yellow-50 text-yellow-700',
  pending: 'bg-gray-100 text-gray-500',
  ready: 'bg-blue-50 text-blue-700',
}

type Group = { key: string; label: string; matches: OrgMatch[]; allDone: boolean }

function buildGroups(matches: OrgMatch[], divisions: OrgDivision[]): Group[] {
  const sorted = [...matches].sort((a, b) => {
    if (a.scheduled_time && b.scheduled_time) return a.scheduled_time.localeCompare(b.scheduled_time)
    return a.match_number - b.match_number
  })
  const map = new Map<string, OrgMatch[]>()
  for (const m of sorted) {
    const key = `${m.division_id}-${m.match_stage ?? 'match'}-${m.round_number ?? 0}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(m)
  }
  return Array.from(map.entries()).map(([key, ms]) => {
    const div = divisions.find(d => d.id === ms[0].division_id)
    const stage = ms[0].match_stage?.replace(/_/g, ' ') ?? ''
    const round = ms[0].round_number ? `R${ms[0].round_number}` : ''
    const label = [div?.name, stage, round].filter(Boolean).join(' · ')
    return { key, label, matches: ms, allDone: ms.every(m => m.status === 'completed') }
  })
}

type Props = {
  tournamentId: string
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
  onMatchUpdate: (updated: OrgMatch) => void
}

export default function ScheduleTab({ tournamentId, matches, registrations, divisions, onMatchUpdate }: Props) {
  const [playerView, setPlayerView] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [reschedulingMatch, setReschedulingMatch] = useState<OrgMatch | null>(null)
  const { message: toastMsg, show: showToast } = useToast()
  const groups = buildGroups(matches, divisions)

  function toggle(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Schedule</h3>
        <button
          onClick={() => setPlayerView(v => !v)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            playerView
              ? 'bg-brand-soft border-brand text-brand-active'
              : 'bg-white border-brand-border text-brand-muted hover:text-brand-dark'
          }`}
        >
          {playerView ? '👤 Player view on' : 'View as player'}
        </button>
      </div>

      {playerView && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-800 font-medium">
          Viewing as player — organizer controls hidden
        </div>
      )}

      {groups.map(group => {
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="bg-white rounded-xl border border-brand-border overflow-hidden">
            <button
              onClick={() => toggle(group.key)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-xs font-bold text-brand-dark">{group.label}</span>
              <div className="flex items-center gap-2">
                {group.allDone && (
                  <span className="text-[10px] bg-brand-soft text-brand-active px-2 py-0.5 rounded-full font-semibold">Done</span>
                )}
                <span className="text-[10px] text-brand-muted">{group.matches.length}m</span>
                <span className="text-[10px] text-brand-muted">{isCollapsed ? '▶' : '▼'}</span>
              </div>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-brand-border border-t border-brand-border">
                {group.matches.map(m => (
                  <MatchRow
                    key={m.id}
                    match={m}
                    registrations={registrations}
                    playerView={playerView}
                    onReschedule={playerView ? undefined : () => setReschedulingMatch(m)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {groups.length === 0 && (
        <p className="text-sm text-brand-muted text-center py-10">No matches scheduled yet.</p>
      )}

      {reschedulingMatch && (
        <RescheduleModal
          tournamentId={tournamentId}
          match={reschedulingMatch}
          onClose={() => setReschedulingMatch(null)}
          onSaved={updated => { onMatchUpdate(updated); showToast('Match rescheduled') }}
          onError={showToast}
        />
      )}

      <Toast message={toastMsg} />
    </div>
  )
}

function MatchRow({
  match, registrations, playerView, onReschedule,
}: { match: OrgMatch; registrations: OrgRegistration[]; playerView: boolean; onReschedule?: () => void }) {
  const t1 = teamLabel(match.team_1_registration_id, registrations)
  const t2 = teamLabel(match.team_2_registration_id, registrations)
  const badgeClass = STATUS_BADGE[match.status] ?? 'bg-gray-100 text-gray-500'
  const statusLabel = match.status === 'in_progress' ? 'Live' : match.status
  const canReschedule = onReschedule && match.status !== 'completed'

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <span className="w-6 shrink-0 text-[10px] font-bold text-brand-muted text-center">#{match.match_number}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-brand-dark truncate">{t1} vs {t2}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-brand-muted">{fmtTime(match.scheduled_time)}</span>
          {match.court_number != null && !playerView && (
            <span className="text-[10px] text-brand-muted">· Court {match.court_number}</span>
          )}
        </div>
      </div>
      {match.status === 'completed' && match.team_1_score != null && (
        <span className="text-xs font-bold text-brand-dark shrink-0 tabular-nums">
          {match.team_1_score}–{match.team_2_score}
        </span>
      )}
      <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${badgeClass}`}>
        {statusLabel}
      </span>
      {canReschedule && (
        <button
          onClick={onReschedule}
          className="shrink-0 p-1 text-brand-muted hover:text-brand-dark transition-colors"
          title="Reschedule"
        >
          <Clock size={13} />
        </button>
      )}
    </div>
  )
}
