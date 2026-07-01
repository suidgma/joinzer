'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback, createContext, useContext, type ReactNode } from 'react'
import { enqueue, drainQueue, getQueue } from '@/lib/pendingQueue'
import { phantomMatchIds } from '@/lib/tournament/resolveCompletion'
import type { MatchRow } from '@/lib/tournament/bracketBuilder'
import { scoreLocally } from '@/lib/offline/localAdvance'
import type { LocalMatch } from '@/lib/offline/applyMutations'

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

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
  // Position placeholders (e.g. {label:'Pool 1 #1'}) shown until a real team is seeded.
  team_1_source?: { label?: string } | null
  team_2_source?: { label?: string } | null
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
  // When true, the caller owns sync-on-reconnect (run mode reconciles + re-renders in place), so
  // BracketView skips its own drain-and-reload. Offline scoring/queueing is unchanged.
  externalSync?: boolean
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

function TeamNameDisplay({ regId, source, regs, isDoubles, showSeeds }: {
  regId: string | null
  source?: { label?: string } | null
  regs: Registration[]
  isDoubles: boolean
  showSeeds?: boolean
}) {
  // No team yet: show the position label ("1st", "Pool 1 #2") if this is a
  // placeholder slot, else a plain TBD (a slot waiting on an upstream winner).
  if (!regId) return <span className="text-brand-muted italic">{source?.label ?? 'TBD'}</span>
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

// The full division match set, provided by BracketView so a card can advance the bracket
// LOCALLY (offline / on network error) via the shared engine — without threading the whole
// array through every layer. See docs/phases/offline-scoring-phase-1.md.
const AllMatchesContext = createContext<Match[]>([])

// Matches that changed from a local score+advance, cast back to the display shape. A
// freshly-inserted row (the double-elim reset) is stamped with the division id + null
// schedule so it renders until the authoritative row arrives on sync.
function changedAfterLocalScore(before: Match[], after: LocalMatch[], divisionId: string): Match[] {
  const byId = new Map(before.map(m => [m.id, m]))
  const out: Match[] = []
  for (const a of after) {
    const b = byId.get(a.id)
    if (!b) {
      out.push({ ...(a as unknown as Match), division_id: divisionId, pool_number: null, court_number: null, scheduled_time: null, team_1_score: null, team_2_score: null })
    } else if (
      b.team_1_registration_id !== a.team_1_registration_id ||
      b.team_2_registration_id !== a.team_2_registration_id ||
      b.winner_registration_id !== a.winner_registration_id ||
      b.status !== a.status ||
      b.team_1_score !== a.team_1_score ||
      b.team_2_score !== a.team_2_score
    ) {
      out.push(a as unknown as Match)
    }
  }
  return out
}

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
  const allMatches = useContext(AllMatchesContext)
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

    // Offline or on a network error: advance the bracket LOCALLY with the shared engine
    // (so the round progresses with no server), and queue the PATCH to replay on reconnect.
    // The server runs the same deterministic engine on sync, so state converges.
    const advanceLocally = () => {
      enqueue(bracketQueueKey(tournamentId), { url, method: 'PATCH', body, dedupeKey: match.id })
      const after = scoreLocally(allMatches as unknown as LocalMatch[], match.id, n1, n2)
      onScoreUpdate(changedAfterLocalScore(allMatches, after, divisionId))
      setLoading(false)
      setScoring(false); setS1(''); setS2('')
      setPendingSync(true)
    }

    if (!navigator.onLine) { advanceLocally(); return }

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
      advanceLocally() // network error — advance locally + queue for retry
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
        <span className={`font-semibold truncate ${isDone && w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}><TeamNameDisplay regId={match.team_1_registration_id} source={match.team_1_source} regs={regs} isDoubles={isDoubles} showSeeds={showSeeds} /></span>
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
        <span className={`font-semibold truncate ${isBye ? 'text-brand-muted italic' : isDone && w === match.team_2_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}>{isBye ? 'BYE' : <TeamNameDisplay regId={match.team_2_registration_id} source={match.team_2_source} regs={regs} isDoubles={isDoubles} showSeeds={showSeeds} />}</span>
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

      {/* Score entry / edit controls. Completed matches get an "Edit Score" action
          that re-opens the same inputs pre-filled with the current result. */}
      {isOrganizer && !isBye && team1Resolved && team2Resolved && (
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
        ) : isDone ? (
          <button onClick={() => { setScoring(true); setS1(String(match.team_1_score ?? '')); setS2(String(match.team_2_score ?? '')); setErr(null) }}
            className="w-full border-t border-brand-border/60 py-1 text-[10px] text-brand-muted hover:bg-brand-soft transition-colors font-medium">
            Edit Score
          </button>
        ) : (
          <button onClick={() => { setScoring(true); setS1(''); setS2(''); setErr(null) }}
            className="w-full border-t border-brand-border/60 py-1 text-[10px] text-brand-active hover:bg-brand-soft transition-colors font-medium">
            Score
          </button>
        )
      )}
    </div>
  )
}

function BracketColumn({
  roundNum, matches, totalRounds, span, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, pointsToWin, showSeeds,
}: {
  roundNum: number
  matches: Match[]
  totalRounds: number
  span: number
  regs: Registration[]
  isOrganizer: boolean
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (updatedMatches: Match[]) => void
  pointsToWin?: number
  showSeeds?: boolean
}) {
  // `span` is how many first-round cards this round's card vertically spans
  // (firstRoundCount / thisRoundCount). For a standard halving bracket that's
  // 2^roundIndex; for the losers bracket — whose drop-in rounds keep the same card
  // count instead of halving — it grows only on the rounds that actually halve, so
  // the LB no longer stretches itself out vertically. gap between cards + the
  // top offset that vertically centers each card between the two it descends from.
  const gap = Math.max(0, span - 1) * CARD_H
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

// Scales its children DOWN (never up) so the whole bracket fits the available
// width — a "zoom to fit" so a complete winners/losers bracket is visible at a
// glance instead of scrolling sideways. A transform doesn't affect layout, so we
// also pin the wrapper height to the scaled height to avoid leftover blank space.
function FitToWidth({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ scale: 1, height: 0 })

  useIsoLayoutEffect(() => {
    const compute = () => {
      const cont = containerRef.current, content = contentRef.current
      if (!cont || !content) return
      const avail = cont.clientWidth
      const naturalW = content.scrollWidth
      const scale = naturalW > avail && avail > 0 ? avail / naturalW : 1
      const height = Math.ceil(content.scrollHeight * scale)
      // Guard against re-render loops (setting height re-triggers the observer).
      setDims(prev => (prev.scale === scale && prev.height === height) ? prev : { scale, height })
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (containerRef.current) ro.observe(containerRef.current)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="w-full overflow-hidden" style={{ height: dims.height || undefined }}>
      <div
        ref={contentRef}
        style={{ transformOrigin: 'top left', transform: `scale(${dims.scale})`, width: 'max-content' }}
      >
        {children}
      </div>
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
  // Card count per round, used to size vertical spacing by the real bracket shape
  // (so non-halving losers-bracket rounds don't get over-spaced).
  const firstRoundCount = (roundMap.get(roundNums[0]) ?? []).length || 1

  return (
    <div className="space-y-2">
      {title && <p className="text-[10px] font-bold uppercase tracking-wide text-brand-muted">{title}</p>}
      <FitToWidth>
        <div className="flex gap-3 pb-2">
          {roundNums.map(rNum => (
            <BracketColumn
              key={rNum}
              roundNum={rNum}
              matches={(roundMap.get(rNum) ?? []).sort((a, b) => a.match_number - b.match_number)}
              totalRounds={totalRounds}
              span={firstRoundCount / ((roundMap.get(rNum) ?? []).length || 1)}
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
      </FitToWidth>
    </div>
  )
}

function RoundRobinList({
  matches, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, pointsToWin, showSeeds,
}: Omit<Props, 'listLayout'>) {
  const card = (m: Match) => (
    <BracketMatchCard
      key={m.id} match={m} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
      tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
      pointsToWin={pointsToWin} showSeeds={showSeeds}
    />
  )

  // Group a set of matches by round, sorted.
  const byRound = (ms: Match[]) => {
    const roundMap = new Map<number, Match[]>()
    for (const m of ms) {
      const r = m.round_number ?? 1
      if (!roundMap.has(r)) roundMap.set(r, [])
      roundMap.get(r)!.push(m)
    }
    return Array.from(roundMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([rNum, rMs]) => ({ rNum, matches: rMs.sort((a, b) => a.match_number - b.match_number) }))
  }

  const roundGroups = (ms: Match[], roundClass = 'text-brand-muted') =>
    byRound(ms).map(({ rNum, matches: rMs }) => (
      <div key={rNum}>
        <p className={`text-[10px] font-bold uppercase tracking-widest ${roundClass} mb-2`}>Round {rNum}</p>
        <div className="flex flex-wrap gap-2">{rMs.map(card)}</div>
      </div>
    ))

  // Pool play: split out pool matches (which carry pool_number) and group them by
  // pool so it's clear who's in Pool 1 vs Pool 2. Any non-pool matches (the playoff
  // bracket) render under their own heading. Plain round robin has no pools and
  // falls through to the simple round grouping.
  const poolMatches = matches.filter(m => m.pool_number != null)
  if (poolMatches.length > 0) {
    const pools = Array.from(new Set(poolMatches.map(m => m.pool_number as number))).sort((a, b) => a - b)
    const playoffMatches = matches.filter(m => m.pool_number == null)
    return (
      <div className="space-y-5">
        {pools.map(pNum => (
          <div key={`pool-${pNum}`} className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-dark border-b border-brand-border/60 pb-1">Pool {pNum}</p>
            {roundGroups(poolMatches.filter(m => m.pool_number === pNum))}
          </div>
        ))}
        {playoffMatches.length > 0 && (
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-dark border-b border-brand-border/60 pb-1">Playoffs</p>
            {roundGroups(playoffMatches)}
          </div>
        )}
      </div>
    )
  }

  return <div className="space-y-4">{roundGroups(matches)}</div>
}

// Stages that render as a knockout bracket (not a flat round list). A round-robin
// or pool division gains these once playoffs are generated.
const BRACKET_STAGES = new Set([
  'winners_bracket', 'losers_bracket', 'championship',
  'playoffs', 'single_elimination', 'consolation',
])

// Renders the knockout portion of a division: single elim, the playoffs bracket,
// or the winners/losers/championship split of double elim. Phantom bye slots are
// stripped first so disconnected TBD-vs-TBD ghosts never show.
function BracketStages({
  matches, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, pointsToWin, showSeeds,
}: Omit<Props, 'listLayout'>) {
  const phantoms = phantomMatchIds(matches as MatchRow[])
  const visibleMatches = matches.filter(m => !phantoms.has(m.id))

  // Separate by stage for double elimination
  const winners = visibleMatches.filter(m => m.match_stage === 'winners_bracket' || m.match_stage === 'single_elimination')
  const losers = visibleMatches.filter(m => m.match_stage === 'losers_bracket')
  const championship = visibleMatches.filter(m => m.match_stage === 'championship')
  const playoffs = visibleMatches.filter(m => m.match_stage === 'playoffs' || m.match_stage === 'consolation')

  // Double elim shape: separate winners + losers brackets, then the championship.
  // (A round-robin "double-elim final" has a championship but no losers bracket —
  // it falls through to the single-bracket path below alongside its playoff rounds.)
  if (losers.length > 0) {
    return (
      <div className="space-y-5">
        <SingleBracket matches={winners} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
          tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
          title="Winners Bracket" pointsToWin={pointsToWin} showSeeds={showSeeds} />
        <SingleBracket matches={losers} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
          tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
          title="Losers Bracket" pointsToWin={pointsToWin} showSeeds={showSeeds} />
        {championship.length > 0 && (
          <SingleBracket matches={championship} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
            title="Championship" pointsToWin={pointsToWin} showSeeds={showSeeds} />
        )}
      </div>
    )
  }

  // Single elim, single-elim playoffs, or a round-robin playoff bracket whose final
  // is a double-elim "if-necessary" final (playoffs rounds + a championship final).
  const bracketMatches = [...playoffs, ...winners, ...championship]
  return (
    <SingleBracket matches={bracketMatches} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
      tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
      pointsToWin={pointsToWin} showSeeds={showSeeds} />
  )
}

export default function BracketView({ matches, regs, isOrganizer, isDoubles, tournamentId, divisionId, onScoreUpdate, listLayout, pointsToWin, showSeeds, externalSync }: Props) {
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
    // In run mode the parent reconciles (drains all queues + bulk-refetch + re-render), so we
    // must not also drain-and-reload here — that would race the reconcile and hard-reload the page.
    if (externalSync) return
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [handleOnline, externalSync])

  if (listLayout) {
    // A round-robin / pool division. Once playoffs are generated it also holds
    // bracket-stage matches — render those as a knockout bracket below the list.
    const listMatches = matches.filter(m => !BRACKET_STAGES.has(m.match_stage))
    const bracketMatches = matches.filter(m => BRACKET_STAGES.has(m.match_stage))
    return (
      <AllMatchesContext.Provider value={matches}>
      <div className="space-y-6">
        <RoundRobinList
          matches={listMatches} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
          tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
          pointsToWin={pointsToWin} showSeeds={showSeeds}
        />
        {bracketMatches.length > 0 && (
          <div className="space-y-3 border-t border-brand-border/60 pt-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Playoffs</p>
            <BracketStages
              matches={bracketMatches} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
              tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
              pointsToWin={pointsToWin} showSeeds={showSeeds}
            />
          </div>
        )}
      </div>
      </AllMatchesContext.Provider>
    )
  }

  return (
    <AllMatchesContext.Provider value={matches}>
      <BracketStages
        matches={matches} regs={regs} isOrganizer={isOrganizer} isDoubles={isDoubles}
        tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
        pointsToWin={pointsToWin} showSeeds={showSeeds}
      />
    </AllMatchesContext.Provider>
  )
}
