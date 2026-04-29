'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

type ActualStatus = 'present' | 'not_present' | 'late' | 'left_early'
type PlayerType   = 'roster_player' | 'sub' | 'guest'
type RoundStatus  = 'draft' | 'locked' | 'completed'

type Player = {
  id: string
  userId: string | null
  display_name: string
  player_type: PlayerType
  expected_status: string
  actual_status: ActualStatus
  arrived_after_round: number | null
  joinzer_rating: number
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

type Props = {
  sessionId: string
  leagueId: string
  initialPlayers: Player[]
  initialRounds: Round[]
  numberOfCourts: number
  roundsPlanned: number
  initialScoredRounds: number[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ActualStatus, string> = {
  present:      'Present',
  not_present:  'Not Here',
  late:         'Late',
  left_early:   'Left',
}

const STATUS_STYLE: Record<ActualStatus, string> = {
  present:     'bg-brand/20 border-brand text-brand-dark',
  late:        'bg-yellow-50 border-yellow-300 text-yellow-800',
  left_early:  'bg-red-50 border-red-200 text-red-600',
  not_present: 'bg-brand-surface border-brand-border text-brand-muted',
}

const BTN_STATUS_STYLE: Record<ActualStatus, string> = {
  present:     'bg-brand text-brand-dark',
  late:        'bg-yellow-100 text-yellow-800 border border-yellow-300',
  left_early:  'bg-red-100 text-red-700 border border-red-200',
  not_present: 'bg-brand-soft text-brand-muted border border-brand-border',
}

function playerName(id: string | null, players: Player[]) {
  if (!id) return '?'
  return players.find(p => p.id === id)?.display_name ?? '?'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlayerRow({
  player,
  onStatusChange,
  disabled,
}: {
  player: Player
  onStatusChange: (id: string, status: ActualStatus) => void
  disabled: boolean
}) {
  const statuses: ActualStatus[] = ['present', 'late', 'left_early', 'not_present']
  const isSub = player.player_type === 'sub'
  const isGuest = player.player_type === 'guest'

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${STATUS_STYLE[player.actual_status]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex-1 text-sm font-medium leading-tight">
          {player.display_name}
          {(isSub || isGuest) && (
            <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isSub ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'}`}>
              {isSub ? 'Sub' : 'Guest'}
            </span>
          )}
        </span>
        <span className="text-[10px] text-brand-muted">{player.joinzer_rating ?? 1000}</span>
      </div>
      <div className="flex gap-1.5">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => onStatusChange(player.id, s)}
            disabled={disabled || player.actual_status === s}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:cursor-default ${
              player.actual_status === s
                ? BTN_STATUS_STYLE[s]
                : 'bg-brand-surface text-brand-muted border border-brand-border hover:border-brand-active'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

function MatchCard({ match, players }: { match: Match; players: Player[] }) {
  if (match.match_type === 'doubles') {
    return (
      <div className="bg-brand-surface border border-brand-border rounded-xl p-3">
        <p className="text-[10px] font-semibold text-brand-muted uppercase mb-2">
          {match.court_number ? `Court ${match.court_number} — Doubles` : 'Doubles'}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <div className="flex-1 space-y-0.5">
            <p className="font-medium text-brand-dark">{playerName(match.team1_player1_id, players)}</p>
            <p className="font-medium text-brand-dark">{playerName(match.team1_player2_id, players)}</p>
          </div>
          <span className="text-brand-muted font-bold text-xs">vs</span>
          <div className="flex-1 text-right space-y-0.5">
            <p className="font-medium text-brand-dark">{playerName(match.team2_player1_id, players)}</p>
            <p className="font-medium text-brand-dark">{playerName(match.team2_player2_id, players)}</p>
          </div>
        </div>
      </div>
    )
  }

  if (match.match_type === 'singles') {
    return (
      <div className="bg-brand-surface border border-yellow-200 rounded-xl p-3">
        <p className="text-[10px] font-semibold text-yellow-700 uppercase mb-2">
          {match.court_number ? `Court ${match.court_number} — Singles` : 'Singles'}
        </p>
        <div className="flex items-center gap-2 text-sm">
          <p className="flex-1 font-medium text-brand-dark">{playerName(match.singles_player1_id, players)}</p>
          <span className="text-brand-muted font-bold text-xs">vs</span>
          <p className="flex-1 text-right font-medium text-brand-dark">{playerName(match.singles_player2_id, players)}</p>
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
  onLock,
  onUnlock,
  onComplete,
  onRegenerate,
  loading,
}: {
  round: Round
  players: Player[]
  onLock: (id: string) => void
  onUnlock: (id: string) => void
  onComplete: (id: string) => void
  onRegenerate: () => void
  loading: boolean
}) {
  const notes = round.generation_notes?.split('\n').filter(Boolean) ?? []
  const doublesCount = round.matches.filter(m => m.match_type === 'doubles').length
  const singlesCount = round.matches.filter(m => m.match_type === 'singles').length
  const byeCount     = round.matches.filter(m => m.match_type === 'bye').length

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
          <p className="text-xs text-brand-muted">
            {doublesCount}D {singlesCount > 0 ? `· ${singlesCount}S` : ''} {byeCount > 0 ? `· ${byeCount} bye` : ''}
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${statusStyle}`}>{statusLabel}</span>
      </div>

      {/* Matches */}
      <div className="p-3 space-y-2">
        {round.matches
          .sort((a, b) => (a.court_number ?? 99) - (b.court_number ?? 99))
          .map(m => <MatchCard key={m.id} match={m} players={players} />)
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

function AddSubModal({ sessionId, onClose, onAdded }: { sessionId: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name.trim(), playerType: 'sub' }),
    })
    if (res.ok) { onAdded(); onClose() }
    else { const d = await res.json(); setError(d.error ?? 'Failed to add sub') }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="font-heading text-lg font-bold text-brand-dark">Add Sub</h2>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Sub's name"
          className="w-full input"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-muted">Cancel</button>
          <button
            onClick={handleAdd}
            disabled={saving || !name.trim()}
            className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add Sub'}
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
  roundsPlanned,
  initialScoredRounds,
}: Props) {
  const router = useRouter()
  const currentRoundRef = useRef<HTMLElement>(null)
  const [players, setPlayers]   = useState<Player[]>(initialPlayers)
  const [rounds, setRounds]     = useState<Round[]>(initialRounds)
  const [loading, setLoading]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showAddSub, setShowAddSub] = useState(false)
  const [showFairness, setShowFairness] = useState(false)
  const [endingDay, setEndingDay] = useState(false)
  const [scoredRounds, setScoredRounds] = useState(() => new Set(initialScoredRounds))

  // Sync when server re-fetches after router.refresh()
  useEffect(() => {
    setScoredRounds(new Set(initialScoredRounds))
  }, [initialScoredRounds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to current round on initial load (e.g. arriving from Results page)
  useEffect(() => {
    const hasActive = initialRounds.some(r => r.status === 'draft' || r.status === 'locked')
    if (hasActive) {
      setTimeout(() => currentRoundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const presentPlayers  = players.filter(p => p.actual_status === 'present')
  const presentCount    = presentPlayers.length
  const presentRoster   = presentPlayers.filter(p => p.player_type === 'roster_player').length
  const presentSubs     = presentPlayers.filter(p => p.player_type === 'sub').length
  const completedCount  = rounds.filter(r => r.status === 'completed').length
  const draftRound      = rounds.find(r => r.status === 'draft')
  const lockedRound     = rounds.find(r => r.status === 'locked')
  const activeRound     = draftRound ?? lockedRound
  const nextRoundNumber = rounds.length === 0 ? 1 : Math.max(...rounds.map(r => r.round_number)) + 1

  // Last completed round must have scores before allowing the next generation
  const completedRoundsSorted = rounds.filter(r => r.status === 'completed').sort((a, b) => a.round_number - b.round_number)
  const lastCompletedRound = completedRoundsSorted[completedRoundsSorted.length - 1]
  const pendingScores = lastCompletedRound != null && !scoredRounds.has(lastCompletedRound.round_number)

  // --- Quick court preview ---
  function courtsPreview() {
    if (presentCount < 2) return 'No players present yet.'
    const courts = numberOfCourts
    const maxD = Math.min(Math.floor(presentCount / 4), courts)
    const rem = presentCount - maxD * 4
    const courtsLeft = courts - maxD
    const singles = rem >= 2 && courtsLeft >= 1 ? 1 : 0
    const byes = rem - (singles > 0 ? 2 : 0)
    const parts = [`${maxD} doubles`]
    if (singles) parts.push('1 singles')
    if (byes > 0) parts.push(`${byes} bye${byes > 1 ? 's' : ''}`)
    return `${presentCount} players present — ${parts.join(', ')} across ${courts} courts.`
  }

  // --- Status update ---
  const handleStatusChange = useCallback(async (playerId: string, status: ActualStatus) => {
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

    await fetch(`/api/league-sessions/${sessionId}/players/${playerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    // No router.refresh() — state is already updated optimistically
  }, [sessionId, players, rounds])

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
      if (confirm(`Round ${data.existing_round_id ? 'already has' : 'already has'} a draft. Replace it?`)) {
        setGenerating(false)
        return handleGenerate(true)
      }
      setGenerating(false)
      return
    }

    if (!res.ok) { setError(data.error ?? 'Failed to generate round'); setGenerating(false); return }

    // Refresh rounds from router (server re-fetches)
    router.refresh()
    // Optimistically add the new round so UI updates immediately
    const newRound = data.round
    if (newRound) {
      setRounds(prev => {
        const without = prev.filter(r => r.id !== newRound.id)
        return [...without, newRound].sort((a, b) => a.round_number - b.round_number)
      })
      // Scroll to the current round section after React re-renders
      setTimeout(() => currentRoundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
    setGenerating(false)
  }

  // --- Round actions ---
  async function roundAction(roundId: string, action: 'lock' | 'unlock' | 'complete') {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/league-rounds/${roundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error); setLoading(false); return }
    const updated = await res.json()
    setRounds(prev => prev.map(r => r.id === roundId ? { ...r, status: updated.status, locked_at: updated.locked_at, completed_at: updated.completed_at } : r))
    setLoading(false)
    if (action === 'complete') {
      router.push(`/compete/leagues/${leagueId}/sessions/${sessionId}/results`)
    }
  }

  // --- End the day ---
  async function handleEndDay() {
    if (!confirm('Mark this session as completed and end the day?')) return
    setEndingDay(true)
    const res = await fetch(`/api/league-sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    if (res.ok) {
      router.push(`/compete/leagues/${leagueId}`)
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to end session')
      setEndingDay(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const rosterPlayers   = players.filter(p => p.player_type === 'roster_player')
  const subPlayers      = players.filter(p => p.player_type !== 'roster_player')
  const completedRounds = rounds.filter(r => r.status === 'completed')

  return (
    <div className="space-y-5">

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Present', value: presentCount, color: 'text-brand-dark font-bold' },
          { label: 'Roster', value: presentRoster, color: 'text-brand-muted' },
          { label: 'Subs', value: presentSubs, color: presentSubs > 0 ? 'text-yellow-700 font-semibold' : 'text-brand-muted' },
          { label: `Rnd ${completedCount}/${roundsPlanned}`, value: '', color: 'text-brand-muted' },
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
          <button
            onClick={() => setShowAddSub(true)}
            className="text-xs bg-brand-soft border border-brand-border text-brand-active font-medium px-3 py-1 rounded-full hover:bg-brand-surface"
          >
            + Add Sub
          </button>
        </div>

        {/* Roster players */}
        {rosterPlayers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Roster Players</p>
            {rosterPlayers.map(p => (
              <PlayerRow key={p.id} player={p} onStatusChange={handleStatusChange} disabled={loading || generating} />
            ))}
          </div>
        )}

        {/* Subs */}
        {subPlayers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Subs & Guests</p>
            {subPlayers.map(p => (
              <PlayerRow key={p.id} player={p} onStatusChange={handleStatusChange} disabled={loading || generating} />
            ))}
          </div>
        )}
      </section>

      {/* ── Generate round section ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="bg-brand-soft border border-brand-border rounded-xl p-3">
          <p className="text-sm text-brand-dark">{courtsPreview()}</p>
          {presentSubs > 0 && presentCount >= 10 && (
            <p className="text-xs text-brand-muted mt-1">Subs will be preferred for singles if a singles match is needed.</p>
          )}
        </div>

        {pendingScores && !draftRound && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm text-yellow-800">
            Enter scores for Round {lastCompletedRound!.round_number} before generating the next round.
          </div>
        )}

        <button
          onClick={() => handleGenerate(false)}
          disabled={generating || presentCount < 2 || !!draftRound || pendingScores}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover disabled:opacity-40 transition-colors"
        >
          {generating ? 'Generating…' : draftRound ? `Round ${draftRound.round_number} draft ready` : `Generate Round ${nextRoundNumber}`}
        </button>

        {draftRound && !generating && (
          <p className="text-xs text-brand-muted text-center">
            Lock or complete Round {draftRound.round_number} before generating a new round, or use Regenerate to replace the draft.
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
            <RoundCard
              key={r.id}
              round={r}
              players={players}
              onLock={() => {}}
              onUnlock={() => {}}
              onComplete={() => {}}
              onRegenerate={() => {}}
              loading={false}
            />
          ))}
        </section>
      )}

      {/* ── Enter Match Results ────────────────────────────────── */}
      {completedRounds.length > 0 && (
        <Link
          href={`/compete/leagues/${leagueId}/sessions/${sessionId}/results`}
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
      {completedCount >= roundsPlanned && !activeRound && (
        <section className="pt-2 border-t border-brand-border">
          <p className="text-xs text-brand-muted text-center mb-3">
            All {roundsPlanned} rounds complete. Ready to wrap up?
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
          onClose={() => setShowAddSub(false)}
          onAdded={() => router.refresh()}
        />
      )}
    </div>
  )
}
