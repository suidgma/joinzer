'use client'
import { useState } from 'react'
import type { OrgMatch, OrgRegistration } from './types'
import QuickActionsBar from './QuickActionsBar'
import OpsHealthStrip from './OpsHealthStrip'
import CourtCard from './CourtCard'
import UpNextRow from './UpNextRow'
import ScoreEntryModal from './ScoreEntryModal'
import AnnounceModal from './AnnounceModal'
import { Toast, useToast } from './Toast'

type Props = {
  tournamentId: string
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: { id: string; name: string }[]
  onMatchUpdate: (updated: OrgMatch) => void
}

export default function LiveTab({ tournamentId, matches, registrations, divisions, onMatchUpdate }: Props) {
  const [scoringMatch, setScoringMatch] = useState<OrgMatch | null>(null)
  const [showAnnounce, setShowAnnounce] = useState(false)
  const { message: toastMsg, show: showToast } = useToast()

  // TODO: derive courts from competition_courts table once migrated (CLAUDE.md Section 6)
  // For now, derive distinct court numbers from match.court_number fields
  const courtNumbers = Array.from(
    new Set(matches.filter(m => m.court_number != null).map(m => m.court_number!))
  ).sort((a, b) => a - b)
  if (courtNumbers.length === 0) courtNumbers.push(1)

  const inProgressByCourt = new Map<number, OrgMatch>(
    matches
      .filter(m => m.status === 'in_progress' && m.court_number != null)
      .map(m => [m.court_number!, m])
  )

  const pending = matches
    .filter(m => m.status === 'pending')
    .sort((a, b) => {
      if (a.scheduled_time && b.scheduled_time) return a.scheduled_time.localeCompare(b.scheduled_time)
      return a.match_number - b.match_number
    })
    .slice(0, 5)

  const completed = matches.filter(m => m.status === 'completed')
  const playerCount = Array.from(
    new Set(registrations.filter(r => r.status === 'registered').map(r => r.user_id))
  ).length
  const pct = Math.round((completed.length / Math.max(matches.length, 1)) * 100)

  return (
    <div className="space-y-5">
      <QuickActionsBar
        onAnnounce={() => setShowAnnounce(true)}
        onReschedule={() => {
          // TODO: implement reschedule flow (reschedule_match RPC)
          showToast('Reschedule coming soon')
        }}
        onExport={() => {
          // TODO: implement CSV/PDF export
          showToast('Export coming soon')
        }}
      />

      <OpsHealthStrip matches={matches} />

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Live Now</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {courtNumbers.map(cn => (
            <CourtCard
              key={cn}
              courtNumber={cn}
              match={inProgressByCourt.get(cn) ?? null}
              registrations={registrations}
              onUpdateScore={m => setScoringMatch(m)}
            />
          ))}
        </div>
      </section>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Up Next</h3>
          <div className="bg-white rounded-xl border border-brand-border divide-y divide-brand-border px-3">
            {pending.map(m => (
              <UpNextRow
                key={m.id}
                match={m}
                registrations={registrations}
                tournamentId={tournamentId}
                onMarkedReady={id => onMatchUpdate({ ...m, status: 'in_progress' })}
                onError={showToast}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between text-xs text-brand-muted mb-1.5">
          <span>{completed.length} of {matches.length} matches complete</span>
          <span>{pct}%</span>
        </div>
        <div className="w-full h-2 bg-brand-border rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      {scoringMatch && (
        <ScoreEntryModal
          tournamentId={tournamentId}
          match={scoringMatch}
          registrations={registrations}
          onClose={() => setScoringMatch(null)}
          onSaved={updated => { onMatchUpdate(updated); showToast('Score updated') }}
          onError={showToast}
        />
      )}

      {showAnnounce && (
        <AnnounceModal
          tournamentId={tournamentId}
          playerCount={playerCount}
          divisions={divisions}
          onClose={() => setShowAnnounce(false)}
          onSent={() => showToast('Announcement sent')}
        />
      )}

      <Toast message={toastMsg} />
    </div>
  )
}
