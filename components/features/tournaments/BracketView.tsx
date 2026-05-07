'use client'

import { useState } from 'react'

type Match = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  pool_number: number | null
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
  user_profile: { name: string } | null
}

type Props = {
  matches: Match[]
  regs: Registration[]
  isOrganizer: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (updatedMatch: Match) => void
}

function teamLabel(regId: string | null, regs: Registration[]): string {
  if (!regId) return 'TBD'
  const r = regs.find(x => x.id === regId)
  if (!r) return '—'
  return r.team_name || r.user_profile?.name || regId.slice(0, 8)
}

function getRoundLabel(roundNum: number, totalRounds: number, stage: string): string {
  if (stage === 'championship') return 'Final'
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

// Height of one match card in px (must match the rendered card)
const CARD_H = 72

function BracketMatchCard({
  match, regs, isOrganizer, tournamentId, divisionId, onScoreUpdate,
}: {
  match: Match
  regs: Registration[]
  isOrganizer: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (m: Match) => void
}) {
  const [scoring, setScoring] = useState(false)
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const t1 = teamLabel(match.team_1_registration_id, regs)
  const t2 = match.team_2_registration_id ? teamLabel(match.team_2_registration_id, regs) : 'BYE'
  const isDone = match.status === 'completed'
  const isBye = !match.team_2_registration_id
  const w = match.winner_registration_id

  async function saveScore() {
    const n1 = Number(s1), n2 = Number(s2)
    if (s1 === '' || s2 === '' || !Number.isInteger(n1) || !Number.isInteger(n2)) {
      setErr('Enter valid scores'); return
    }
    if (n1 < 0 || n2 < 0) { setErr('Scores cannot be negative'); return }
    if (n1 === n2) { setErr('Tie not allowed'); return }

    setLoading(true); setErr(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_1_score: n1, team_2_score: n2 }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error ?? 'Failed'); return }
    setScoring(false); setS1(''); setS2('')
    onScoreUpdate(json.match)
  }

  return (
    <div className={`w-36 rounded-xl border bg-white text-[11px] overflow-hidden ${isDone ? 'border-brand-border' : 'border-brand-border'}`}
      style={{ minHeight: `${CARD_H}px` }}>
      {/* Team 1 */}
      <div className={`flex items-center justify-between px-2 py-1.5 border-b border-brand-border/60 ${isDone && w === match.team_1_registration_id ? 'bg-brand-soft' : ''}`}>
        <span className={`font-semibold truncate max-w-[88px] ${isDone && w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}>{t1}</span>
        {isDone && match.team_1_score != null && (
          <span className={`font-bold ml-1 shrink-0 ${w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-muted'}`}>{match.team_1_score}</span>
        )}
      </div>
      {/* Team 2 */}
      <div className={`flex items-center justify-between px-2 py-1.5 ${isDone && w === match.team_2_registration_id ? 'bg-brand-soft' : ''}`}>
        <span className={`font-semibold truncate max-w-[88px] ${isBye ? 'text-brand-muted italic' : isDone && w === match.team_2_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}>{t2}</span>
        {isDone && match.team_2_score != null && !isBye && (
          <span className={`font-bold ml-1 shrink-0 ${w === match.team_2_registration_id ? 'text-brand-active' : 'text-brand-muted'}`}>{match.team_2_score}</span>
        )}
      </div>

      {/* Score entry */}
      {isOrganizer && !isDone && !isBye && (
        scoring ? (
          <div className="px-2 py-1.5 border-t border-brand-border/60 space-y-1 bg-gray-50">
            <div className="flex gap-1">
              <input type="number" value={s1} onChange={e => setS1(e.target.value)} placeholder={t1.slice(0, 4)}
                className="w-full border border-brand-border rounded px-1.5 py-0.5 text-[10px] text-center" />
              <input type="number" value={s2} onChange={e => setS2(e.target.value)} placeholder={t2.slice(0, 4)}
                className="w-full border border-brand-border rounded px-1.5 py-0.5 text-[10px] text-center" />
            </div>
            {err && <p className="text-[9px] text-red-600">{err}</p>}
            <div className="flex gap-1">
              <button onClick={saveScore} disabled={loading}
                className="flex-1 py-0.5 rounded bg-brand text-brand-dark text-[10px] font-semibold disabled:opacity-50">
                {loading ? '…' : 'Save'}
              </button>
              <button onClick={() => { setScoring(false); setErr(null) }}
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
  roundNum, matches, totalRounds, rIdx, regs, isOrganizer, tournamentId, divisionId, onScoreUpdate,
}: {
  roundNum: number
  matches: Match[]
  totalRounds: number
  rIdx: number
  regs: Registration[]
  isOrganizer: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (m: Match) => void
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
            match={match} regs={regs} isOrganizer={isOrganizer}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate}
          />
        </div>
      ))}
    </div>
  )
}

function SingleBracket({
  matches, regs, isOrganizer, tournamentId, divisionId, onScoreUpdate, title,
}: {
  matches: Match[]
  regs: Registration[]
  isOrganizer: boolean
  tournamentId: string
  divisionId: string
  onScoreUpdate: (m: Match) => void
  title?: string
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
              tournamentId={tournamentId}
              divisionId={divisionId}
              onScoreUpdate={onScoreUpdate}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function BracketView({ matches, regs, isOrganizer, tournamentId, divisionId, onScoreUpdate }: Props) {
  // Separate by stage for double elimination
  const winners = matches.filter(m => m.match_stage === 'winners_bracket' || m.match_stage === 'single_elimination')
  const losers = matches.filter(m => m.match_stage === 'losers_bracket')
  const championship = matches.filter(m => m.match_stage === 'championship')
  const playoffs = matches.filter(m => m.match_stage === 'playoffs' || m.match_stage === 'consolation')

  const hasDoubleElim = losers.length > 0

  if (hasDoubleElim) {
    return (
      <div className="space-y-5">
        <SingleBracket matches={winners} regs={regs} isOrganizer={isOrganizer}
          tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate} title="Winners Bracket" />
        {losers.length > 0 && (
          <SingleBracket matches={losers} regs={regs} isOrganizer={isOrganizer}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate} title="Losers Bracket" />
        )}
        {championship.length > 0 && (
          <SingleBracket matches={championship} regs={regs} isOrganizer={isOrganizer}
            tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate} title="Championship" />
        )}
      </div>
    )
  }

  // Pool play playoffs or single elim — render all non-pool matches
  const bracketMatches = playoffs.length > 0 ? playoffs : [...winners, ...championship]
  return (
    <SingleBracket matches={bracketMatches} regs={regs} isOrganizer={isOrganizer}
      tournamentId={tournamentId} divisionId={divisionId} onScoreUpdate={onScoreUpdate} />
  )
}
