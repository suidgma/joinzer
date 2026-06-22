'use client'

import { useState, useEffect, useCallback } from 'react'
import { enqueue, drainQueue, getQueue } from '@/lib/pendingQueue'

type Match = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  pool_number: number | null
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
}

type Registration = {
  id: string
  user_id: string
  team_name: string | null
  status: string
  seed?: number | null
  user_profile: { name: string } | null
  partner_user_id?: string | null
  partner_profile?: { name: string } | null
}

type Props = {
  matches: Match[]
  regs: Registration[]
  isOrganizer: boolean
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (updatedMatches: Match[]) => void
  listLayout?: boolean
  pointsToWin?: number
  showSeeds?: boolean
}

// Returns false if a null-null scheduled WB/LB match traces back to at least one
// real team through its same-stage predecessors. Returns true (phantom) when it's
// a padded bracket slot that will never have players — e.g. the null-null R1 pair
// created when 5 teams are padded to an 8-slot bracket.
function hasRealPredecessor(match: Match, allMatches: Match[], depth = 0): boolean {
  if (depth > 6) return false
  // A completed match already had its winner advanced — it can't feed a null-null slot downstream
  if (match.status === 'completed') return false
  if (match.team_1_registration_id || match.team_2_registration_id) return true
  if (match.match_stage === 'championship') return true
  const round = match.round_number ?? 1
  // LB R1 is fed by WB R1 losers (cross-stage) — not phantom when WB R1 has real teams
  if (match.match_stage === 'losers_bracket' && round <= 1) {
    return allMatches.some(m =>
      m.match_stage === 'winners_bracket' && m.round_number === 1 &&
      (m.team_1_registration_id != null || m.team_2_registration_id != null)
    )
  }
  if (round <= 1) return false  // WB/SE R1 null-null = phantom by definition
  const sameRound = allMatches
    .filter(m => m.match_stage === match.match_stage && m.round_number === round)
    .sort((a, b) => a.match_number - b.match_number)
  const idx = sameRound.findIndex(m => m.id === match.id)
  if (idx === -1) return false
  const prevRound = allMatches
    .filter(m => m.match_stage === match.match_stage && m.round_number === round - 1)
    .sort((a, b) => a.match_number - b.match_number)
  const f1 = prevRound[idx * 2]
  const f2 = prevRound[idx * 2 + 1]
  return (
    (f1 != null && hasRealPredecessor(f1, allMatches, depth + 1)) ||
    (f2 != null && hasRealPredecessor(f2, allMatches, depth + 1))
  )
}

function isPhantomMatch(match: Match, allMatches: Match[]): boolean {
  const stage = match.match_stage
  if (stage !== 'winners_bracket' && stage !== 'losers_bracket' && stage !== 'single_elimination') return false
  if (match.team_1_registration_id || match.team_2_registration_id) return false
  // A "completed" match with no team IDs is a phantom BYE slot written by the
  // generation cascade — hide it so it doesn't render as "TBD vs TBD".
  if (match.status === 'completed') return true
  return !hasRealPredecessor(match, allMatches, 0)
}

function formatMatchTime(scheduled_time: string | null): string {
  if (!scheduled_time) return ''
  const d = new Date(scheduled_time)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day} · ${time}`
}

function firstName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

function TeamNameDisplay({ regId, regs, isDoubles, showSeeds }: {
  regId: string | null
  regs: Registration[]
  isDoubles: boolean
  showSeeds?: boolean
}) {
  if (!regId) return <span>TBD</span>
  const r = regs.find(x => x.id === regId)
  if (!r) return <span>—</span>
  const seedPrefix = showSeeds && r.seed != null
    ? <span className="text-[9px] font-bold text-brand-muted mr-0.5">#{r.seed}</span>
    : null
  if (!isDoubles) return <span>{seedPrefix}{r.team_name || firstName(r.user_profile?.name) || regId.slice(0, 8)}</span>
  const p1 = firstName(r.user_profile?.name) || r.team_name || regId.slice(0, 8)
  if (r.partner_profile?.name) {
    const names = [p1, firstName(r.partner_profile.name)].sort((a, b) => a.localeCompare(b))
    return <span>{seedPrefix}{names[0]}/{names[1]}</span>
  }
  return <span>{seedPrefix}{p1}/<span className="text-yellow-500 font-bold">?</span></span>
}

function getRoundLabel(roundNum: number, totalRounds: number, stage: string): string {
  // Round 2 of the Championship is the double-elim bracket reset (the decider
  // played only when the losers-bracket champion wins the first final).
  if (stage === 'championship') return roundNum >= 2 ? 'Final (Reset)' : 'Final'
  if (stage === 'winners_bracket' || stage === 'losers_bracket') {
    // label by stage
    if (totalRounds - roundNum === 0) return 'Final'
    if (totalRounds - roundNum === 1) return 'Semis'
    return `Round ${roundNum}`
  }
  if (totalRounds === 1) return 'Final'
  if (roundNum === totalRounds) return 'Final'
  if (roundNum === totalRounds - 1) return 'Semis'
  if (roundNum === totalRounds - 2) return 'Quarters'
  return `Round ${roundNum}`
}

// Height of one match card in px — must match actual rendered card height.
// All cards are forced to this height via flex-col + flex-1 spacer so the
// centering math (topPad = gap/2) stays correct across rounds.
const CARD_H = 96

// Queue key scoped to this tournament's bracket score ops
const bracketQueueKey = (tournamentId: string) => `bracket_${tournamentId}`

function BracketMatchCard({
  match, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, pointsToWin, showSeeds,
}: {
  match: Match
  regs: Registration[]
  isOrganizer: boolean
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (updatedMatches: Match[]) => void
  pointsToWin?: number
  showSeeds?: boolean
}) {
  const ptw = pointsToWin ?? 11
  const [scoring, setScoring] = useState(false)
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pendingSync, setPendingSync] = useState(() => {
    // Check if this match already has a queued score on mount
    try {
      const q = getQueue(bracketQueueKey(tournamentId))
      return q.some(op => op.dedupeKey === match.id)
    } catch { return false }
  })

  const isDone = match.status === 'completed'
  // Structural BYE: completed with a winner but no team_2 (auto-advanced during bracket gen
  // or induced cascade). A pending match where team_1 is set but team_2 is null is NOT a bye
  // — team_2 is just TBD (waiting for the other half of the bracket to produce a winner).
  const isBye = isDone && !match.team_2_registration_id && !!match.team_1_registration_id
  const w = match.winner_registration_id
  // A slot is "resolved" only if its registration is still in the active set. A
  // cancelled player keeps their id on the match row but drops out of `regs`, so it
  // renders as "—" — don't offer to score a match against a no-longer-present player.
  const team1Resolved = !!match.team_1_registration_id && regs.some(r => r.id === match.team_1_registration_id)
  const team2Resolved = !!match.team_2_registration_id && regs.some(r => r.id === match.team_2_registration_id)

  async function saveScore() {
    const n1 = Number(s1), n2 = Number(s2)
    if (s1 === '' || s2 === '' || !Number.isInteger(n1) || !Number.isInteger(n2)) {
      setErr('Enter valid scores'); return
    }
    if (n1 < 0 || n2 < 0) { setErr('Scores cannot be negative'); return }
    if (n1 === n2) { setErr('Tie not allowed'); return }

    setLoading(true); setErr(null)

    const url = `/api/tournaments/${tournamentId}/matches/${match.id}`
    const body = JSON.stringify({ team_1_score: n1, team_2_score: n2 })

    if (!navigator.onLine) {
      enqueue(bracketQueueKey(tournamentId), { url, method: 'PATCH', body, dedupeKey: match.id })
      setLoading(false)
      setScoring(false); setS1(''); setS2('')
      setPendingSync(true)
      return
    }

    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const json = await res.json()
      setLoading(false)
      if (!res.ok) { setErr(json.error ?? 'Failed'); return }
      setScoring(false); setS1(''); setS2('')
      const changed: Match[] = [json.match, ...(json.advancedMatches ?? [])]
      onScoreUpdate(changed)
    } catch {
      // Network error — queue for retry
      enqueue(bracketQueueKey(tournamentId), { url, method: 'PATCH', body, dedupeKey: match.id })
      setLoading(false)
      setScoring(false); setS1(''); setS2('')
      setPendingSync(true)
    }
  }

  function handleS1Change(val: string) {
    const cleaned = val.replace(/\D/g, '').slice(0, 2)
    setS1(cleaned)
    setErr(null)
    const n = Number(cleaned)
    if (cleaned !== '' && n < ptw) setS2(String(ptw))
  }

  function handleS2Change(val: string) {
    const cleaned = val.replace(/\D/g, '').slice(0, 2)
    setS2(cleaned)
    setErr(null)
    const n = Number(cleaned)
    if (cleaned !== '' && n < ptw) setS1(String(ptw))
  }

  return (
    <div className={`w-36 rounded-xl border bg-white text-[11px] overflow-hidden flex flex-col ${pendingSync ? 'border-amber-400' : 'border-brand-border'}`}
      style={{ minHeight: `${CARD_H}px` }}>
      {/* Team 1 */}
      <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b border-brand-border/60 ${isDone && w === match.team_1_registration_id ? 'bg-brand-soft' : ''}`}>
        {scoring ? (
          <input
            type="text" inputMode="numeric" value={s1}
            onChange={e => handleS1Change(e.target.value)}
            placeholder={String(ptw)} maxLength={2}
            className="w-7 shrink-0 border border-brand-border rounded px-0.5 py-0.5 text-[10px] text-center"
          />
        ) : isDone && match.team_1_score != null ? (
          <span className={`w-7 shrink-0 font-bold text-right ${w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-muted'}`}>{match.team_1_score}</span>
        ) : null}
        <span className={`font-semibold truncate ${isDone && w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}><TeamNameDisplay regId={match.team_1_registration_id} regs={regs} isDoubles={isDoubles} showSeeds={showSeeds} /></span>
      </div>
      {/* Team 2 */}
      <div className={`flex items-center gap-1.5 px-2 py-1.5 ${isDone && w === match.team_2_registration_id ? 'bg-brand-soft' : ''}`}>
        {scoring ? (
          <input
            type="text" inputMode="numeric" value={s2}
            onChange={e => handleS2Change(e.target.value)}
            placeholder={String(ptw)} maxLength={2}
            className="w-7 shrink-0 border border-brand-border rounded px-0.5 py-0.5 text-[10px] text-center"
          />
        ) : isDone && match.team_2_score != null && !isBye ? (
          <span className={`w-7 shrink-0 font-bold text-right ${w === match.team_2_registration_id ? 'text-brand-active' : 'text-brand-muted'}`}>{match.team_2_score}</span>
        ) : isDone ? <span className="w-7 shrink-0" /> : null}
        <span className={`font-semibold truncate ${isBye ? 'text-brand-muted italic' : isDone && w === match.team_2_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}>{isBye ? 'BYE' : <TeamNameDisplay regId={match.team_2_registration_id} regs={regs} isDoubles={isDoubles} showSeeds={showSeeds} />}</span>
      </div>

      {/* Assignment info: court + time */}
      {(match.court_number != null || match.scheduled_time) && (
        <div className="px-2 py-1 border-t border-brand-border/40 text-[9px] text-brand-muted flex items-center gap-1 flex-wrap">
          {match.court_number != null && <span className="font-medium">Ct.{match.court_number}</span>}
          {match.court_number != null && match.scheduled_time && <span>·</span>}
          {match.scheduled_time && <span>{formatMatchTime(match.scheduled_time)}</span>}
        </div>
      )}

      {/* Pending sync indicator */}
      {pendingSync && (
        <div className="px-2 py-1 border-t border-amber-200 bg-amber-50 text-[9px] text-amber-700 font-medium flex items-center gap-1">
          <span className="animate-pulse">●</span> Pending sync
        </div>
      )}

      {/* Spacer: pushes Score section to the bottom, ensuring every card fills CARD_H */}
      <div className="flex-1" />

      {/* Score entry controls */}
      {isOrganizer && !isDone && !isBye && team1Resolved && team2Resolved && (
        scoring ? (
          <div className="px-2 py-1 border-t border-brand-border/60 bg-gray-50 space-y-1">
            {err && <p className="text-[9px] text-red-600">{err}</p>}
            <div className="flex gap-1">
              <button onClick={saveScore} disabled={loading}
                className="flex-1 py-0.5 rounded bg-brand text-brand-dark text-[10px] font-semibold disabled:opacity-50">
                {loading ? '…' : 'Save'}
              </button>
              <button onClick={() => { setScoring(false); setS1(''); setS2(''); setErr(null) }}
                className="px-1.5 py-0.5 rounded border border-brand-border text-[10px] text-brand-muted">
                ✕
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setScoring(true); setS1(''); setS2('') }}
            className="w-full border-t border-brand-border/60 py-1 text-[10px] text-brand-active hover:bg-brand-soft transition-colors font-medium">
            Score
          </button>
        )
      )}
    </div>
  )
}

function BracketColumn({
  roundNum, matches, totalRounds, rIdx, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, pointsToWin, showSeeds,
}: {
  roundNum: number
  matches: Match[]
  totalRounds: number
  rIdx: number
  regs: Registration[]
  isOrganizer: boolean
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (updatedMatches: Match[]) => void
  pointsToWin?: number
  showSeeds?: boolean
}) {
  // spacing between cards doubles each round: 0, CARD_H, 3*CARD_H, 7*CARD_H...
  const gap = (Math.pow(2, rIdx) - 1) * CARD_H
  // top offset to vertically center: half the gap
  const topPad = gap / 2

  const stage = matches[0]?.match_stage ?? ''
  const label = getRoundLabel(roundNum, totalRounds, stage)

  return (
    <div className="flex flex-col items-center" style={{ paddingTop: `${topPad}px` }}>
      <span className="text-[9px] font-bold uppercase tracking-widest text-brand-muted mb-2 whitespace-nowrap">{label}</span>
      {matches.map((match, i) => (
        <div key={match.id} style={{ marginBottom: i < matches.length - 1 ? `${gap}px` : 0 }}>
          <BracketMatchCard
            match={match} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
            pointsToWin={pointsToWin} showSeeds={showSeeds}
          />
        </div>
      ))}
    </div>
  )
}

function SingleBracket({
  matches, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, title, pointsToWin, showSeeds,
}: {
  matches: Match[]
  regs: Registration[]
  isOrganizer: boolean
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (updatedMatches: Match[]) => void
  title?: string
  pointsToWin?: number
  showSeeds?: boolean
}) {
  if (matches.length === 0) return null

  const roundMap = new Map<number, Match[]>()
  for (const m of matches) {
    const r = m.round_number ?? 1
    if (!roundMap.has(r)) roundMap.set(r, [])
    roundMap.get(r)!.push(m)
  }
  const roundNums = Array.from(roundMap.keys()).sort((a, b) => a - b)
  const totalRounds = roundNums.length

  return (
    <div className="space-y-2">
      {title && <p className="text-[10px] font-bold uppercase tracking-wide text-brand-muted">{title}</p>}
      <div className="overflow-x-auto -mx-4 px-4 pb-2">
        <div className="flex gap-3 min-w-max">
          {roundNums.map((rNum, rIdx) => (
            <BracketColumn
              key={rNum}
              roundNum={rNum}
              matches={(roundMap.get(rNum) ?? []).sort((a, b) => a.match_number - b.match_number)}
              totalRounds={totalRounds}
              rIdx={rIdx}
              regs={regs}
              isOrganizer={isOrganizer}
              isDoubles={isDoubles}
              tournamentId={tournamentId}
              divisionId={divisionId}
              onScoreUpdate={onScoreUpdate}
              pointsToWin={pointsToWin}
              showSeeds={showSeeds}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function RoundRobinList({
  matches, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, pointsToWin, showSeeds,
}: Omit<Props, 'listLayout'>) {
  const roundMap = new Map<number, Match[]>()
  for (const m of matches) {
    const r = m.round_number ?? 1
    if (!roundMap.has(r)) roundMap.set(r, [])
    roundMap.get(r)!.push(m)
  }
  const roundNums = Array.from(roundMap.keys()).sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      {roundNums.map(rNum => (
        <div key={rNum}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-muted mb-2">Round {rNum}</p>
          <div className="flex flex-wrap gap-2">
            {(roundMap.get(rNum) ?? [])
              .sort((a, b) => a.match_number - b.match_number)
              .map(m => (
                <BracketMatchCard
                  key={m.id}
                  match={m}
                  regs={regs}
                  isOrganizer={isOrganizer}
                  isDoubles={isDoubles}
                  tournamentId={tournamentId}
                  divisionId={divisionId}
                  onScoreUpdate={onScoreUpdate}
                  pointsToWin={pointsToWin}
                  showSeeds={showSeeds}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BracketView({ matches, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, listLayout, pointsToWin, showSeeds }: Props) {
  const handleOnline = useCallback(async () => {
    const qKey = bracketQueueKey(tournamentId)
    const queue = getQueue(qKey)
    if (queue.length === 0) return
    const { synced } = await drainQueue(qKey)
    if (synced > 0) {
      // Refresh the page so parent reloads scores from DB
      window.location.reload()
    }
  }, [tournamentId])

  useEffect(() => {
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [handleOnline])

  if (listLayout) {
    return (
      <RoundRobinList
        matches={matches} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
        tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
        pointsToWin={pointsToWin} showSeeds={showSeeds}
      />
    )
  }

  // Strip phantom padded slots (null-null scheduled matches with no real upstream feeder)
  // before rendering so the bracket doesn't show disconnected TBD vs TBD ghost cards.
  const visibleMatches = matches.filter(m => !isPhantomMatch(m, matches))

  // Separate by stage for double elimination
  const winners = visibleMatches.filter(m => m.match_stage === 'winners_bracket' || m.match_stage === 'single_elimination')
  const losers = visibleMatches.filter(m => m.match_stage === 'losers_bracket')
  const championship = visibleMatches.filter(m => m.match_stage === 'championship')
  const playoffs = visibleMatches.filter(m => m.match_stage === 'playoffs' || m.match_stage === 'consolation')

  const hasDoubleElim = losers.length > 0

  if (hasDoubleElim) {
    return (
      <div className="space-y-5">
        <SingleBracket matches={winners} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
          tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
          title="Winners Bracket" pointsToWin={pointsToWin} showSeeds={showSeeds} />
        {losers.length > 0 && (
          <SingleBracket matches={losers} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
            title="Losers Bracket" pointsToWin={pointsToWin} showSeeds={showSeeds} />
        )}
        {championship.length > 0 && (
          <SingleBracket matches={championship} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
            title="Championship" pointsToWin={pointsToWin} showSeeds={showSeeds} />
        )}
      </div>
    )
  }

  // Pool play playoffs or single elim — render all non-pool matches
  const bracketMatches = playoffs.length > 0 ? playoffs : [...winners, ...championship]
  return (
    <SingleBracket matches={bracketMatches} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
      tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
      pointsToWin={pointsToWin} showSeeds={showSeeds} />
  )
}
