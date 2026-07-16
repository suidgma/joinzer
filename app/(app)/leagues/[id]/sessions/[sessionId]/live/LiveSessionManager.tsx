'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDialog } from '@/components/ui/DialogProvider'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/hooks'
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus'
import { enqueue, drainQueue, getQueue } from '@/lib/pendingQueue'
import AttendanceGrid, { type AttendeeRow } from '@/components/features/leagues/AttendanceGrid'
import PlayerCombobox from '@/components/ui/PlayerCombobox'
import { everyoneHasFacedEveryone } from '@/lib/leagues/sessionCompletion'
import type { CompletedRound } from '@/lib/scheduling/leagueScheduler'

// ─── Types ───────────────────────────────────────────────────────────────────

type ActualStatus = 'present' | 'coming' | 'late' | 'cannot_attend' | 'has_sub' | 'not_present'
type PlayerType   = 'roster_player' | 'sub' | 'guest'
type RoundStatus  = 'draft' | 'locked' | 'completed'

type Player = {
  id: string
  user_id: string | null
  display_name: string
  player_type: PlayerType
  expected_status: string
  actual_status: ActualStatus
  arrived_after_round: number | null
  joinzer_rating: number
  sub_for_session_player_id: string | null
}

type Match = {
  id: string
  court_number: number | null
  match_type: 'doubles' | 'singles' | 'bye'
  team1_player1_id: string | null
  team1_player2_id: string | null
  team2_player1_id: string | null
  team2_player2_id: string | null
  singles_player1_id: string | null
  singles_player2_id: string | null
  bye_player_id: string | null
}

type Round = {
  id: string
  round_number: number
  status: RoundStatus
  generation_notes: string | null
  locked_at: string | null
  completed_at: string | null
  matches: Match[]
}

type SubRequest = {
  id: string
  status: string
  requesting_player_id: string
  claimed_by_user_id: string | null
  requesting_player: { name: string } | null
  claimed_by: { name: string } | null
}

type MatchScoreData = {
  round_number: number
  team1_player1_id: string | null
  team1_player2_id: string | null
  team2_player1_id: string | null
  team2_player2_id: string | null
  team1_score: number | null
  team2_score: number | null
}

type Props = {
  sessionId: string
  leagueId: string
  initialPlayers: Player[]
  initialRounds: Round[]
  numberOfCourts: number
  initialScoredRounds: number[]
  initialMatchScores: MatchScoreData[]
  availableSubs: { id: string; name: string }[]
  subRequests: SubRequest[]
  format: string
  teamByUserId?: Record<string, string>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function playerName(id: string | null, players: Player[]) {
  if (!id) return '?'
  const full = players.find(p => p.id === id)?.display_name ?? '?'
  return full.trim().split(/\s+/)[0]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type Score = { t1: number; t2: number }

function ScoreBadge({ score, t1Won }: { score: Score; t1Won: boolean }) {
  return (
    <div className="text-center shrink-0 px-2">
      <p className="text-sm font-bold text-brand-dark">{score.t1} – {score.t2}</p>
    </div>
  )
}

function MatchCard({ match, players, score, teamBySpId = {} }: { match: Match; players: Player[]; score?: Score | null; teamBySpId?: Record<string, string> }) {
  if (match.match_type === 'doubles') {
    const t1Won = score ? score.t1 > score.t2 : null
    const t1Team = match.team1_player1_id ? teamBySpId[match.team1_player1_id] : undefined
    const t2Team = match.team2_player1_id ? teamBySpId[match.team2_player1_id] : undefined
    return (
      <div className="bg-brand-surface border border-brand-border rounded-xl p-3">
        <p className="text-[10px] font-semibold text-brand-muted uppercase mb-2">
          {match.court_number ? `Court ${match.court_number} — Doubles` : 'Doubles'}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <div className={`flex-1 space-y-0.5 ${score && t1Won ? 'font-semibold' : ''}`}>
            {t1Team ? (
              <p className={score && t1Won ? 'text-brand-dark' : score ? 'text-brand-muted' : 'text-brand-dark font-medium'}>{t1Team}</p>
            ) : (
              <>
                <p className={score && t1Won ? 'text-brand-dark' : score ? 'text-brand-muted' : 'text-brand-dark font-medium'}>{playerName(match.team1_player1_id, players)}</p>
                <p className={score && t1Won ? 'text-brand-dark' : score ? 'text-brand-muted' : 'text-brand-dark font-medium'}>{playerName(match.team1_player2_id, players)}</p>
              </>
            )}
          </div>
          {score ? <ScoreBadge score={score} t1Won={!!t1Won} /> : <span className="text-brand-muted font-bold text-xs">vs</span>}
          <div className={`flex-1 text-right space-y-0.5 ${score && !t1Won ? 'font-semibold' : ''}`}>
            {t2Team ? (
              <p className={score && !t1Won ? 'text-brand-dark' : score ? 'text-brand-muted' : 'text-brand-dark font-medium'}>{t2Team}</p>
            ) : (
              <>
                <p className={score && !t1Won ? 'text-brand-dark' : score ? 'text-brand-muted' : 'text-brand-dark font-medium'}>{playerName(match.team2_player1_id, players)}</p>
                <p className={score && !t1Won ? 'text-brand-dark' : score ? 'text-brand-muted' : 'text-brand-dark font-medium'}>{playerName(match.team2_player2_id, players)}</p>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (match.match_type === 'singles') {
    const t1Won = score ? score.t1 > score.t2 : null
    return (
      <div className="bg-brand-surface border border-yellow-200 rounded-xl p-3">
        <p className="text-[10px] font-semibold text-yellow-700 uppercase mb-2">
          {match.court_number ? `Court ${match.court_number} — Singles` : 'Singles'}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <p className={`flex-1 ${score && t1Won ? 'font-semibold text-brand-dark' : score ? 'text-brand-muted' : 'font-medium text-brand-dark'}`}>{playerName(match.singles_player1_id, players)}</p>
          {score ? <ScoreBadge score={score} t1Won={!!t1Won} /> : <span className="text-brand-muted font-bold text-xs">vs</span>}
          <p className={`flex-1 text-right ${score && !t1Won ? 'font-semibold text-brand-dark' : score ? 'text-brand-muted' : 'font-medium text-brand-dark'}`}>{playerName(match.singles_player2_id, players)}</p>
        </div>
      </div>
    )
  }

  // bye
  return (
    <div className="bg-brand-soft border border-brand-border rounded-xl p-3 flex items-center gap-2">
      <span className="text-[10px] font-semibold text-brand-muted uppercase">Bye</span>
      <span className="text-sm text-brand-muted">{playerName(match.bye_player_id, players)}</span>
    </div>
  )
}

function RoundCard({
  round,
  players,
  scoreMap,
  spToUserId,
  teamBySpId,
  onLock,
  onUnlock,
  onComplete,
  onRegenerate,
  loading,
}: {
  round: Round
  players: Player[]
  scoreMap?: Map<string, Score>
  spToUserId?: Map<string, string>
  teamBySpId?: Record<string, string>
  onLock: (id: string) => void
  onUnlock: (id: string) => void
  onComplete: (id: string) => void
  onRegenerate: () => void
  loading: boolean
}) {
  function matchScore(m: Match): Score | null {
    if (!scoreMap || !spToUserId) return null
    const ids: string[] = []
    const candidates = m.match_type === 'singles'
      ? [m.singles_player1_id, m.singles_player2_id]
      : [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id]
    for (const spId of candidates) {
      if (!spId) continue
      const uid = spToUserId.get(spId)
      if (uid) ids.push(uid)
    }
    const sig = `${round.round_number}:${ids.sort().join(',')}`
    return scoreMap.get(sig) ?? null
  }
  const notes = round.generation_notes?.split('\n').filter(Boolean) ?? []
  const statusLabel = round.status === 'draft' ? 'Draft' : round.status === 'locked' ? 'Locked' : 'Completed'
  const statusStyle = round.status === 'draft'
    ? 'bg-yellow-100 text-yellow-800'
    : round.status === 'locked'
    ? 'bg-brand/20 text-brand-dark'
    : 'bg-brand-soft text-brand-muted'

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
        <div>
          <h3 className="font-semibold text-brand-dark text-sm">Round {round.round_number}</h3>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusStyle}`}>{statusLabel}</span>
      </div>

      {/* Matches */}
      <div className="p-3 space-y-2">
        {round.matches
          .sort((a, b) => (a.court_number ?? 99) - (b.court_number ?? 99))
          .map(m => <MatchCard key={m.id} match={m} players={players} score={matchScore(m)} teamBySpId={teamBySpId} />)
        }
      </div>

      {/* Notes */}
      {notes.length > 0 && (
        <div className="px-4 pb-3 space-y-0.5">
          {notes.map((n, i) => (
            <p key={i} className="text-xs text-brand-muted">· {n}</p>
          ))}
        </div>
      )}

      {/* Actions */}
      {round.status !== 'completed' && (
        <div className="flex gap-2 px-4 pb-4">
          {round.status === 'draft' && (
            <>
              <button
                onClick={onRegenerate}
                disabled={loading}
                className="flex-1 py-2 rounded-xl border border-brand-border text-xs font-semibold text-brand-muted hover:bg-brand-soft transition-colors disabled:opacity-50"
              >
                Regenerate
              </button>
              <button
                onClick={() => onLock(round.id)}
                disabled={loading}
                className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                Lock Round
              </button>
            </>
          )}
          {round.status === 'locked' && (
            <>
              <button
                onClick={() => onUnlock(round.id)}
                disabled={loading}
                className="flex-1 py-2 rounded-xl border border-brand-border text-xs font-semibold text-brand-muted hover:bg-brand-soft transition-colors disabled:opacity-50"
              >
                Unlock
              </button>
              <button
                onClick={() => onComplete(round.id)}
                disabled={loading}
                className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                Mark Complete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FairnessSummary({ players, rounds }: { players: Player[]; rounds: Round[] }) {
  type Row = { name: string; games: number; singles: number; byes: number }
  const stats: Record<string, Row> = {}

  const completedRounds = rounds.filter(r => r.status === 'completed')
  for (const player of players) {
    stats[player.id] = { name: player.display_name, games: 0, singles: 0, byes: 0 }
  }

  for (const round of completedRounds) {
    for (const m of round.matches) {
      if (m.match_type === 'doubles') {
        for (const id of [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id]) {
          if (id && stats[id]) stats[id].games++
        }
      } else if (m.match_type === 'singles') {
        for (const id of [m.singles_player1_id, m.singles_player2_id]) {
          if (id && stats[id]) { stats[id].games++; stats[id].singles++ }
        }
      } else if (m.match_type === 'bye' && m.bye_player_id && stats[m.bye_player_id]) {
        stats[m.bye_player_id].byes++
      }
    }
  }

  const rows = Object.values(stats).sort((a, b) => b.games - a.games)
  if (rows.every(r => r.games === 0)) return null

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-border">
        <h3 className="font-semibold text-brand-dark text-sm">Fairness Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-brand-border bg-brand-soft">
              <th className="text-left px-4 py-2 text-brand-muted font-semibold">Player</th>
              <th className="text-right px-3 py-2 text-brand-muted font-semibold">Games</th>
              <th className="text-right px-3 py-2 text-brand-muted font-semibold">Singles</th>
              <th className="text-right px-3 py-2 text-brand-muted font-semibold">Byes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i < rows.length - 1 ? 'border-b border-brand-border' : ''}>
                <td className="px-4 py-2 text-brand-dark font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right text-brand-dark">{r.games}</td>
                <td className="px-3 py-2 text-right text-brand-muted">{r.singles || '—'}</td>
                <td className={`px-3 py-2 text-right ${r.byes > 1 ? 'text-yellow-700 font-semibold' : 'text-brand-muted'}`}>{r.byes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Add Sub Modal ────────────────────────────────────────────────────────────

function AddSubModal({
  sessionId,
  availableSubs,
  onClose,
  onAdded,
}: {
  sessionId: string
  availableSubs: { id: string; name: string }[]
  onClose: () => void
  onAdded: () => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = availableSubs.find(p => p.id === selectedId)

  async function handleAdd() {
    if (!selected) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: selected.name, userId: selected.id, playerType: 'sub' }),
    })
    if (res.ok) { onAdded(); onClose() }
    else { const d = await res.json(); setError(d.error ?? 'Failed to add sub') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="font-heading text-lg font-bold text-brand-dark">Add Sub</h2>
        {availableSubs.length === 0 ? (
          <p className="text-sm text-brand-muted">No available players to add.</p>
        ) : (
          <PlayerCombobox
            autoFocus
            options={availableSubs}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="Type a player's name…"
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-muted">Cancel</button>
          <button
            onClick={handleAdd}
            disabled={saving || !selectedId}
            className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add Sub'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assign Sub Modal ─────────────────────────────────────────────────────────

function AssignSubModal({
  sessionId,
  absentPlayer,
  unassignedSubPlayers,
  availableSubs,
  onClose,
  onAssigned,
}: {
  sessionId: string
  absentPlayer: Player
  unassignedSubPlayers: Player[]
  availableSubs: { id: string; name: string }[]
  onClose: () => void
  onAssigned: (subPlayer: Player) => void
}) {
  const [selectedUserId, setSelectedUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Combine already-in-session subs + available profiles into one list
  const options: { id: string; name: string; inSession: boolean }[] = [
    ...unassignedSubPlayers.map(p => ({ id: p.user_id!, name: p.display_name, inSession: true })),
    ...availableSubs.filter(p => !unassignedSubPlayers.some(sp => sp.user_id === p.id))
      .map(p => ({ id: p.id, name: p.name, inSession: false })),
  ].sort((a, b) => a.name.localeCompare(b.name))

  async function handleAssign() {
    if (!selectedUserId) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}/assign-sub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subUserId: selectedUserId, absentPlayerId: absentPlayer.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to assign sub'); setSaving(false); return }
    onAssigned(data.subPlayer as Player)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="font-heading text-lg font-bold text-brand-dark">Assign Sub</h2>
          <p className="text-sm text-brand-muted">Covering for <span className="font-medium text-brand-dark">{absentPlayer.display_name}</span></p>
        </div>
        {options.length === 0 ? (
          <p className="text-sm text-brand-muted">No available players. Use &quot;+ Add Sub&quot; to add someone first.</p>
        ) : (
          <PlayerCombobox
            autoFocus
            options={options.map(p => ({ id: p.id, name: p.inSession ? `${p.name} (already here)` : p.name }))}
            value={selectedUserId}
            onChange={setSelectedUserId}
            placeholder="Type a player's name…"
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-muted">
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={saving || !selectedUserId}
            className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Main component ───────────────────────────────────────────────────────────

export default function LiveSessionManager({
  sessionId,
  leagueId,
  initialPlayers,
  initialRounds,
  numberOfCourts,
  initialMatchScores,
  availableSubs,
  subRequests,
  format,
  teamByUserId = {},
}: Props) {
  const router = useRouter()
  const currentRoundRef = useRef<HTMLElement>(null)
  const [players, setPlayers]   = useState<Player[]>(initialPlayers)
  const { confirm } = useDialog()
  const [rounds, setRounds]     = useState<Round[]>(initialRounds)
  const [loading, setLoading]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showAddSub, setShowAddSub] = useState(false)
  const [showFairness, setShowFairness] = useState(false)
  const [assignSubForPlayer, setAssignSubForPlayer] = useState<Player | null>(null)
  const [endingDay, setEndingDay] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [reminderSent, setReminderSent] = useState(false)
  const [localSubRequests, setLocalSubRequests] = useState<SubRequest[]>(subRequests)
  const [approvingSubId, setApprovingSubId] = useState<string | null>(null)

  type SyncStatus = 'synced' | 'saving' | 'saved_locally' | 'syncing' | 'sync_failed'
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const isOnline = useOnlineStatus()

  // session_player_id → user_id (for score lookup)
  const spToUserId = new Map<string, string>(
    players.filter(p => p.user_id).map(p => [p.id, p.user_id!])
  )

  // round_number + sorted user_ids → Score (from entered match results)
  const scoreMap = new Map<string, Score>()
  for (const m of initialMatchScores) {
    if (m.team1_score == null || m.team2_score == null) continue
    const ids = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id]
      .filter(Boolean).sort() as string[]
    if (ids.length === 0) continue
    scoreMap.set(`${m.round_number}:${ids.join(',')}`, { t1: m.team1_score, t2: m.team2_score })
  }

  // Scroll to current round on initial load (e.g. arriving from Results page)
  useEffect(() => {
    const hasActive = initialRounds.some(r => r.status === 'draft' || r.status === 'locked')
    if (hasActive) {
      setTimeout(() => currentRoundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: sync player status changes (e.g. self-check-in from player's device)
  const rtStatus = useRealtimeChannel(
    { topic: `session-players-${sessionId}`, postgresChanges: [{ event: 'UPDATE', table: 'league_session_players', filter: `session_id=eq.${sessionId}` }] },
    (evt) => {
      if (evt.kind !== 'postgres_changes') return
      const updated = evt.payload.new as { id: string; actual_status: ActualStatus }
      setPlayers(prev => prev.map(p => p.id === updated.id ? { ...p, actual_status: updated.actual_status } : p))
    },
  )
  const realtimeOk = rtStatus !== 'error'

  // Drain pending queue when coming back online
  useEffect(() => {
    if (!isOnline) return
    const queue = getQueue(sessionId)
    if (queue.length === 0) return
    setSyncStatus('syncing')
    drainQueue(sessionId).then(({ failed }) => {
      setSyncStatus(failed > 0 ? 'sync_failed' : 'synced')
    })
  }, [isOnline, sessionId])

  const presentPlayers  = players.filter(p => p.actual_status === 'present')
  const presentCount    = presentPlayers.length
  const presentRoster   = presentPlayers.filter(p => p.player_type === 'roster_player').length
  const presentSubs     = presentPlayers.filter(p => p.player_type === 'sub').length
  // Only assigned subs (covering an absent player) count toward round generation
  const eligibleCount   = presentPlayers.filter(
    p => p.player_type !== 'sub' || p.sub_for_session_player_id !== null
  ).length
  const completedCount  = rounds.filter(r => r.status === 'completed').length
  const draftRound      = rounds.find(r => r.status === 'draft')
  const lockedRound     = rounds.find(r => r.status === 'locked')
  const activeRound     = draftRound ?? lockedRound
  const nextRoundNumber = rounds.length === 0 ? 1 : Math.max(...rounds.map(r => r.round_number)) + 1

  // The current round must be COMPLETE and FULLY scored before the next can be
  // generated — every non-bye match needs a result, not just some. This forces
  // organizers to enter the round's scores before moving on.
  const completedRoundsSorted = rounds.filter(r => r.status === 'completed').sort((a, b) => a.round_number - b.round_number)
  const lastCompletedRound = completedRoundsSorted[completedRoundsSorted.length - 1]
  const scoredMatchCountByRound = new Map<number, number>()
  for (const m of initialMatchScores) {
    if (m.team1_score == null || m.team2_score == null) continue
    scoredMatchCountByRound.set(m.round_number, (scoredMatchCountByRound.get(m.round_number) ?? 0) + 1)
  }
  const roundFullyScored = (round: Round): boolean => {
    const scoreable = round.matches.filter(m => m.match_type !== 'bye').length
    return scoreable === 0 || (scoredMatchCountByRound.get(round.round_number) ?? 0) >= scoreable
  }
  const currentRoundNeedsScores = lastCompletedRound != null && !roundFullyScored(lastCompletedRound)

  // --- Natural endpoint: has every present player faced every other? ---
  // "Played everyone" is about opponent pairings (who's been on the court against
  // whom), which is known from the completed rounds regardless of scores. When the
  // session reaches this point and there's no round in progress, we surface it as a
  // "generate another round, or end the day?" prompt — the round-robin's soft finish.
  const presentIds = presentPlayers.map(p => p.id)
  const completedForCheck: CompletedRound[] = rounds
    .filter(r => r.status === 'completed')
    .map(r => ({
      roundNumber: r.round_number,
      matches: r.matches.map(m => ({
        matchType: m.match_type,
        team1: [m.team1_player1_id, m.team1_player2_id].filter(Boolean) as string[],
        team2: [m.team2_player1_id, m.team2_player2_id].filter(Boolean) as string[],
        singles: [m.singles_player1_id, m.singles_player2_id].filter(Boolean) as string[],
        byePlayerId: m.bye_player_id,
      })),
    }))
  const sessionComplete = everyoneHasFacedEveryone(presentIds, completedForCheck)
  const showCompletionPrompt = sessionComplete && !activeRound

  // The "everyone's played everyone" prompt is an INLINE card (below), not a modal. To stop it
  // flickering out, it's LATCHED: turned on once we reach the endpoint and cleared ONLY when a new
  // round actually starts (the organizer chose to keep playing). A transient re-render — the page's
  // realtime refresh could momentarily flip `sessionComplete` via a stray player-status event — can
  // no longer drop it, because we don't clear the latch when it goes false, only when a round begins.
  const [endpointLatched, setEndpointLatched] = useState(false)
  useEffect(() => {
    if (showCompletionPrompt) setEndpointLatched(true)
    else if (activeRound) setEndpointLatched(false)
  }, [showCompletionPrompt, activeRound])
  const showEndpointCard = endpointLatched && !activeRound

  // --- Quick court preview ---
  function courtsPreview() {
    if (eligibleCount === 0) return 'No players present yet.'
    if (eligibleCount === 1) return '1 player present — need at least 2 to generate a round.'
    const courts = numberOfCourts
    const isSingles = format.includes('singles')

    if (isSingles) {
      const maxS = Math.min(Math.floor(eligibleCount / 2), courts)
      const byes = eligibleCount - maxS * 2
      const parts = [`${maxS} singles`]
      if (byes > 0) parts.push(`${byes} bye${byes > 1 ? 's' : ''}`)
      return `${eligibleCount} players eligible — ${parts.join(', ')} across ${maxS} court${maxS !== 1 ? 's' : ''}.`
    }

    const maxD = Math.min(Math.floor(eligibleCount / 4), courts)
    const rem = eligibleCount - maxD * 4
    const courtsLeft = courts - maxD
    const singles = rem >= 2 && courtsLeft >= 1 ? 1 : 0
    const byes = rem - (singles > 0 ? 2 : 0)
    const courtsInUse = maxD + singles
    const parts = [`${maxD} doubles`]
    if (singles) parts.push('1 singles')
    if (byes > 0) parts.push(`${byes} bye${byes > 1 ? 's' : ''}`)
    return `${eligibleCount} players eligible — ${parts.join(', ')} across ${courtsInUse} court${courtsInUse !== 1 ? 's' : ''}.`
  }

  // --- Status update (offline-safe) ---
  const handleStatusChange = useCallback(async (playerId: string, status: ActualStatus) => {
    // Remember previous status for rollback
    const prev_status = players.find(p => p.id === playerId)?.actual_status
    // Optimistic update
    setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, actual_status: status } : p))

    const completedRoundCount = rounds.filter(r => r.status === 'completed').length
    const body: Record<string, unknown> = { actual_status: status }
    if (status === 'present') {
      const player = players.find(p => p.id === playerId)
      if (completedRoundCount > 0 && !player?.arrived_after_round) {
        body.arrived_after_round = completedRoundCount
      }
    }

    const url = `/api/league-sessions/${sessionId}/players/${playerId}`
    const bodyStr = JSON.stringify(body)

    if (!isOnline) {
      enqueue(sessionId, { url, method: 'PATCH', body: bodyStr, dedupeKey: `player-status-${playerId}` })
      setSyncStatus('saved_locally')
      return
    }

    setSyncStatus('saving')
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      })
      if (res.ok) {
        setSyncStatus('synced')
      } else {
        // Roll back optimistic update and queue for retry
        if (prev_status) setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, actual_status: prev_status } : p))
        enqueue(sessionId, { url, method: 'PATCH', body: bodyStr, dedupeKey: `player-status-${playerId}` })
        setSyncStatus('sync_failed')
      }
    } catch {
      // Network error — queue it
      enqueue(sessionId, { url, method: 'PATCH', body: bodyStr, dedupeKey: `player-status-${playerId}` })
      setSyncStatus('saved_locally')
    }
  }, [sessionId, players, rounds, isOnline])

  const handleSetAllStatus = useCallback(async (playerIds: string[], status: ActualStatus) => {
    await Promise.all(playerIds.map(id => handleStatusChange(id, status)))
  }, [handleStatusChange])

  // --- Generate round ---
  async function handleGenerate(replaceExisting = false) {
    setGenerating(true)
    setError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}/generate-next-round`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_existing_draft: replaceExisting }),
    })
    const data = await res.json()

    if (res.status === 409) {
      // Draft already exists — ask to replace
      if (await confirm({ title: 'Replace draft round?', body: 'This round already has a draft. Replace it?', confirmLabel: 'Replace' })) {
        setGenerating(false)
        return handleGenerate(true)
      }
      setGenerating(false)
      return
    }

    if (!res.ok) { setError(data.error ?? 'Failed to generate round'); setGenerating(false); return }

    // Optimistically update rounds so UI reflects changes immediately
    const newRound = data.round
    if (newRound) {
      setRounds(prev => {
        // When replacing, remove the old draft (deleted on server) and avoid duplicates
        const without = replaceExisting
          ? prev.filter(r => r.status !== 'draft' && r.id !== newRound.id)
          : prev.filter(r => r.id !== newRound.id)
        return [...without, newRound].sort((a, b) => a.round_number - b.round_number)
      })
      // Scroll to the current round section after React re-renders
      setTimeout(() => currentRoundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
    setGenerating(false)
  }

  // --- Round actions ---
  async function roundAction(roundId: string, action: 'lock' | 'unlock' | 'complete') {
    if (!isOnline) {
      setError('You\'re offline. Please reconnect before locking or completing a round.')
      return
    }
    setLoading(true)
    setError(null)
    setSyncStatus('saving')
    const res = await fetch(`/api/league-rounds/${roundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error)
      setLoading(false)
      setSyncStatus('sync_failed')
      return
    }
    const updated = await res.json()
    setRounds(prev => prev.map(r => r.id === roundId ? { ...r, status: updated.status, locked_at: updated.locked_at, completed_at: updated.completed_at } : r))
    setLoading(false)
    setSyncStatus('synced')
    if (action === 'complete') {
      router.push(`/leagues/${leagueId}/sessions/${sessionId}/results`)
    }
  }

  // --- End the day ---
  async function doEndDay() {
    setEndingDay(true)
    const res = await fetch(`/api/league-sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    if (res.ok) {
      router.push(`/leagues/${leagueId}`)
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to end session')
      setEndingDay(false)
    }
  }
  async function handleEndDay() {
    if (!(await confirm({ title: 'End the day?', body: 'Mark this session as completed and end the day?', confirmLabel: 'End day' }))) return
    await doEndDay()
  }

  // --- Send reminder ---
  async function handleSendReminder() {
    if (!(await confirm({ title: 'Send reminder?', body: 'Send a check-in reminder email to all registered players?', confirmLabel: 'Send' }))) return
    setSendingReminder(true)
    const res = await fetch(`/api/league-sessions/${sessionId}/send-reminder`, { method: 'POST' })
    setSendingReminder(false)
    if (res.ok) setReminderSent(true)
    else { const d = await res.json(); setError(d.error ?? 'Failed to send reminder') }
  }

  // --- Approve sub ---
  async function handleApproveSub(subRequestId: string) {
    setApprovingSubId(subRequestId)
    const res = await fetch(`/api/league-sub-requests/${subRequestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    setApprovingSubId(null)
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to approve sub'); return }
    setLocalSubRequests(prev => prev.map(sr => sr.id === subRequestId ? { ...sr, status: 'approved' } : sr))
  }

  // --- Handle sub assignment ---
  function handleSubAssigned(subPlayer: Player) {
    setPlayers(prev => {
      const exists = prev.find(p => p.id === subPlayer.id)
      if (exists) {
        return prev.map(p => p.id === subPlayer.id ? { ...p, ...subPlayer } : p)
      }
      return [...prev, subPlayer]
    })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const rosterPlayers   = players.filter(p => p.player_type === 'roster_player')
  const subPlayers      = players.filter(p => p.player_type !== 'roster_player')
  const completedRounds = rounds.filter(r => r.status === 'completed')

  // Map session_player.id → teamName for fixed-partner display
  const teamBySpId: Record<string, string> = {}
  const isFixedPartner = Object.keys(teamByUserId).length > 0
  if (isFixedPartner) {
    for (const p of players) {
      if (p.user_id && teamByUserId[p.user_id]) teamBySpId[p.id] = teamByUserId[p.user_id]
    }
  }

  // absentPlayerId → sub player (for roster row "Subbed by X" display)
  const subByAbsentId = new Map<string, Player>()
  for (const p of subPlayers) {
    if (p.sub_for_session_player_id) subByAbsentId.set(p.sub_for_session_player_id, p)
  }

  // sub player id → absent roster player name (for sub row "for X" display)
  const absentNameById = new Map<string, string>()
  for (const p of rosterPlayers) {
    const sub = subByAbsentId.get(p.id)
    if (sub) absentNameById.set(sub.id, p.display_name)
  }

  // Unassigned present/late sub players eligible for new assignments
  const unassignedSubPlayers = subPlayers.filter(
    p => !p.sub_for_session_player_id &&
      (p.actual_status === 'present' || p.actual_status === 'coming' || p.actual_status === 'late') &&
      p.user_id
  )

  // Normalize session players into the shared AttendanceGrid's row shape. No self-report badge
  // under the name — the player's status is shown only by the radio columns (status = actual_status,
  // which now faithfully reflects the self-report).
  const rosterRows: AttendeeRow[] = rosterPlayers.map(p => ({
    id: p.id,
    displayName: p.display_name,
    kind: 'roster',
    status: p.actual_status,
    teamName: p.user_id ? teamByUserId[p.user_id] : undefined,
    subbedByName: subByAbsentId.get(p.id)?.display_name,
  }))
  const subRows: AttendeeRow[] = subPlayers.map(p => ({
    id: p.id,
    displayName: p.display_name,
    kind: p.player_type === 'sub' ? 'sub' : 'guest',
    status: p.actual_status,
    coveringName: absentNameById.get(p.id),
  }))

  // ─── Sync / connection status bar ────────────────────────────────────────────
  const syncBar = (() => {
    if (!isOnline) return { text: 'Offline — changes saved locally', bg: 'bg-yellow-50 border-yellow-300 text-yellow-800' }
    if (syncStatus === 'syncing')     return { text: 'Syncing changes…', bg: 'bg-blue-50 border-blue-200 text-blue-800' }
    if (syncStatus === 'saved_locally') return { text: 'Saved locally — will sync when reconnected', bg: 'bg-yellow-50 border-yellow-300 text-yellow-800' }
    if (syncStatus === 'sync_failed') return { text: 'Sync failed — tap to retry', bg: 'bg-red-50 border-red-300 text-red-800', retry: true }
    if (syncStatus === 'saving')      return { text: 'Saving…', bg: 'bg-brand-soft border-brand-border text-brand-muted' }
    if (!realtimeOk)                  return { text: 'Live updates paused — reconnecting…', bg: 'bg-yellow-50 border-yellow-300 text-yellow-800' }
    return null
  })()

  return (
    <div className="space-y-5">

      {/* Connection / sync status bar */}
      {syncBar && (
        <div className={`border rounded-xl px-3 py-2 text-xs font-medium flex items-center justify-between gap-2 ${syncBar.bg}`}>
          <span>{syncBar.text}</span>
          {(syncBar as any).retry && (
            <button
              onClick={() => {
                setSyncStatus('syncing')
                drainQueue(sessionId).then(({ failed }) => setSyncStatus(failed > 0 ? 'sync_failed' : 'synced'))
              }}
              className="underline font-semibold"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Present', value: presentCount, color: 'text-brand-dark font-bold' },
          { label: 'Roster', value: presentRoster, color: 'text-brand-muted' },
          { label: 'Subs', value: presentSubs, color: presentSubs > 0 ? 'text-yellow-700 font-semibold' : 'text-brand-muted' },
        ].map(s => (
          <div key={s.label} className="bg-brand-surface border border-brand-border rounded-xl p-2 text-center">
            <p className={`text-lg ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-brand-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 text-xs flex-shrink-0">✕</button>
        </div>
      )}

      {/* ── Attendance section ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Attendance</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder || reminderSent}
              className="text-xs bg-brand-soft border border-brand-border text-brand-active font-medium px-3 py-1 rounded-full hover:bg-brand-surface disabled:opacity-50"
            >
              {reminderSent ? '✓ Sent' : sendingReminder ? 'Sending…' : 'Send Reminder'}
            </button>
            <button
              onClick={() => setShowAddSub(true)}
              className="text-xs bg-brand-soft border border-brand-border text-brand-active font-medium px-3 py-1 rounded-full hover:bg-brand-surface"
            >
              + Add Sub
            </button>
          </div>
        </div>

        {/* Sub requests panel */}
        {localSubRequests.filter(sr => ['open', 'claimed'].includes(sr.status)).length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-3">
            <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">Sub Requests</p>
            {localSubRequests.filter(sr => ['open', 'claimed'].includes(sr.status)).map(sr => (
              <div key={sr.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-brand-dark">
                    <span className="font-medium">{sr.requesting_player?.name ?? 'Unknown'}</span>
                    <span className="text-brand-muted"> needs a sub</span>
                  </p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                    sr.status === 'claimed' ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {sr.status === 'claimed'
                      ? `${sr.claimed_by?.name ?? 'Someone'} volunteered`
                      : 'Open'}
                  </span>
                </div>
                {sr.status === 'claimed' && (
                  <button
                    onClick={() => handleApproveSub(sr.id)}
                    disabled={approvingSubId === sr.id}
                    className="w-full py-1.5 rounded-lg text-xs font-semibold bg-brand text-brand-dark hover:bg-brand-hover disabled:opacity-50 transition-colors"
                  >
                    {approvingSubId === sr.id ? 'Approving…' : `Approve ${sr.claimed_by?.name ?? 'Sub'}`}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Attendance grid (shared with box + future league types) */}
        <AttendanceGrid
          roster={rosterRows}
          subs={subRows}
          onSetStatus={handleStatusChange}
          onSetAll={handleSetAllStatus}
          onAssignSub={(rowId) => {
            const pl = players.find(p => p.id === rowId)
            if (pl) setAssignSubForPlayer(pl)
          }}
          disabled={loading || generating}
        />
      </section>

      {/* ── Generate round section ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="bg-brand-soft border border-brand-border rounded-xl p-3">
          <p className="text-sm text-brand-dark">{courtsPreview()}</p>
          {presentSubs > 0 && presentCount >= 10 && (
            <p className="text-xs text-brand-muted mt-1">Subs will be preferred for singles if a singles match is needed.</p>
          )}
        </div>

        {/* Natural-endpoint decision prompt — a PERSISTENT inline card (replaces a modal that kept
            getting dropped by the page's realtime refresh). Stays visible until the organizer picks
            a next step: generate another round, or end the day. */}
        {showEndpointCard && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-base font-bold text-emerald-900">🎉 Everyone’s played everyone</p>
              <p className="text-sm text-emerald-700 mt-0.5">
                Every player here has faced each other at least once — a natural stopping point. What next?
              </p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => handleGenerate(false)}
                disabled={generating || eligibleCount < 2 || !!activeRound || currentRoundNeedsScores}
                className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {generating ? 'Generating…' : currentRoundNeedsScores ? 'Enter this round’s scores first' : 'Generate another round'}
              </button>
              <button
                onClick={handleEndDay}
                disabled={endingDay}
                className="w-full py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {endingDay ? 'Ending…' : '🏁 End the day'}
              </button>
            </div>
          </div>
        )}

        {currentRoundNeedsScores && !activeRound && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800 flex items-center justify-between gap-3">
            <span>Enter all scores for Round {lastCompletedRound!.round_number} before generating the next round.</span>
            <Link
              href={`/leagues/${leagueId}/sessions/${sessionId}/results`}
              className="underline font-semibold whitespace-nowrap shrink-0"
            >
              Enter results →
            </Link>
          </div>
        )}

        <button
          onClick={() => handleGenerate(false)}
          disabled={generating || eligibleCount < 2 || !!activeRound || currentRoundNeedsScores}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover disabled:opacity-40 transition-colors"
        >
          {generating
            ? 'Generating…'
            : draftRound
              ? `Round ${draftRound.round_number} draft ready`
              : lockedRound
                ? `Finish Round ${lockedRound.round_number} first`
                : `Generate Round ${nextRoundNumber}`}
        </button>

        {draftRound && !generating && (
          <p className="text-xs text-brand-muted text-center">
            Lock or complete Round {draftRound.round_number} before generating a new round, or use Regenerate to replace the draft.
          </p>
        )}

        {lockedRound && !generating && (
          <p className="text-xs text-brand-muted text-center">
            Complete Round {lockedRound.round_number} and enter its scores before generating the next round.
          </p>
        )}
      </section>

      {/* ── Active round (draft / locked) ─────────────────────── */}
      {activeRound && (
        <section ref={currentRoundRef} className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Current Round</h2>
          <RoundCard
            round={activeRound}
            players={players}
            teamBySpId={teamBySpId}
            onLock={id => roundAction(id, 'lock')}
            onUnlock={id => roundAction(id, 'unlock')}
            onComplete={id => roundAction(id, 'complete')}
            onRegenerate={() => handleGenerate(true)}
            loading={loading || generating}
          />
        </section>
      )}

      {/* ── Completed rounds ───────────────────────────────────── */}
      {completedRounds.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-brand-dark">Completed Rounds</h2>
          {[...completedRounds].reverse().map(r => (
            <div key={r.id} id={`completed-round-${r.id}`}>
              <RoundCard
                round={r}
                players={players}
                scoreMap={scoreMap}
                spToUserId={spToUserId}
                teamBySpId={teamBySpId}
                onLock={() => {}}
                onUnlock={() => {}}
                onComplete={() => {}}
                onRegenerate={() => {}}
                loading={false}
              />
            </div>
          ))}
        </section>
      )}

      {/* ── Enter Match Results ────────────────────────────────── */}
      {completedRounds.length > 0 && (
        <Link
          href={`/leagues/${leagueId}/sessions/${sessionId}/results`}
          className="block w-full text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
        >
          Enter Match Results →
        </Link>
      )}

      {/* ── Fairness summary ───────────────────────────────────── */}
      {completedRounds.length > 0 && (
        <section className="space-y-2">
          <button
            onClick={() => setShowFairness(v => !v)}
            className="w-full text-left flex items-center justify-between"
          >
            <h2 className="font-heading text-base font-bold text-brand-dark">Fairness Summary</h2>
            <span className="text-xs text-brand-muted">{showFairness ? 'Hide ▲' : 'Show ▼'}</span>
          </button>
          {showFairness && <FairnessSummary players={players} rounds={rounds} />}
        </section>
      )}

      {/* ── End the Day ───────────────────────────────────────── */}
      {/* Hidden at the natural endpoint — the decision card above already offers End the day. */}
      {completedCount >= 1 && !activeRound && !showEndpointCard && (
        <section className="pt-2 border-t border-brand-border">
          <p className="text-xs text-brand-muted text-center mb-3">
            {`${completedCount} ${completedCount === 1 ? 'round' : 'rounds'} played. Generate more above, or wrap up when you're done.`}
          </p>
          <button
            onClick={handleEndDay}
            disabled={endingDay}
            className="w-full py-3 rounded-xl bg-brand-dark text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {endingDay ? 'Ending…' : '🏁 End the Day'}
          </button>
        </section>
      )}


      {/* ── Add sub modal ──────────────────────────────────────── */}
      {showAddSub && (
        <AddSubModal
          sessionId={sessionId}
          availableSubs={availableSubs}
          onClose={() => setShowAddSub(false)}
          onAdded={() => window.location.reload()}
        />
      )}

      {/* ── Assign sub modal ───────────────────────────────────── */}
      {assignSubForPlayer && (
        <AssignSubModal
          sessionId={sessionId}
          absentPlayer={assignSubForPlayer}
          unassignedSubPlayers={unassignedSubPlayers}
          availableSubs={availableSubs}
          onClose={() => setAssignSubForPlayer(null)}
          onAssigned={handleSubAssigned}
        />
      )}
    </div>
  )
}
