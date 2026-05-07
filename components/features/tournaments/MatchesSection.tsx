'use client'

import { useState } from 'react'
import BracketView from './BracketView'

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
  user_profile: { name: string } | null
}

type Division = {
  id: string
  name: string
  format_type: string
  tournament_registrations: Registration[]
}

type Props = {
  tournamentId: string
  divisions: Division[]
  initialMatches: Match[]
  isOrganizer: boolean
}

type StandingRow = { regId: string; name: string; wins: number; losses: number; pf: number; pa: number }

function teamLabel(regId: string | null, regs: Registration[]): string {
  if (!regId) return 'BYE'
  const r = regs.find(x => x.id === regId)
  if (!r) return '—'
  return r.team_name || r.user_profile?.name || regId.slice(0, 8)
}

function computeStandings(matches: Match[], regs: Registration[], poolNum?: number): StandingRow[] {
  const map = new Map<string, StandingRow>()
  regs.filter(r => r.status === 'registered').forEach(r => {
    map.set(r.id, { regId: r.id, name: teamLabel(r.id, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
  })

  const relevant = matches.filter(m =>
    m.status === 'completed' &&
    m.team_1_registration_id &&
    m.team_2_registration_id &&
    (poolNum === undefined || m.pool_number === poolNum)
  )

  for (const m of relevant) {
    const t1 = m.team_1_registration_id!
    const t2 = m.team_2_registration_id!
    const s1 = m.team_1_score ?? 0
    const s2 = m.team_2_score ?? 0
    if (!map.has(t1)) map.set(t1, { regId: t1, name: teamLabel(t1, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
    if (!map.has(t2)) map.set(t2, { regId: t2, name: teamLabel(t2, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
    const r1 = map.get(t1)!
    const r2 = map.get(t2)!
    if (m.winner_registration_id === t1) { r1.wins++; r2.losses++ }
    else if (m.winner_registration_id === t2) { r2.wins++; r1.losses++ }
    r1.pf += s1; r1.pa += s2
    r2.pf += s2; r2.pa += s1
  }

  return Array.from(map.values()).sort((a, b) => {
    const wdiff = b.wins - a.wins
    if (wdiff !== 0) return wdiff
    const diffA = a.pf - a.pa, diffB = b.pf - b.pa
    if (diffB !== diffA) return diffB - diffA
    return b.pf - a.pf
  })
}

function StandingsTable({ rows }: { rows: StandingRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_28px_28px_32px_32px_36px] gap-x-1 text-[10px] font-semibold text-brand-muted uppercase tracking-wide px-1 pb-0.5">
        <span>Team</span><span className="text-center">W</span><span className="text-center">L</span>
        <span className="text-center">PF</span><span className="text-center">PA</span><span className="text-center">+/-</span>
      </div>
      {rows.map((row, i) => {
        const diff = row.pf - row.pa
        return (
          <div key={row.regId} className={`grid grid-cols-[1fr_28px_28px_32px_32px_36px] gap-x-1 text-xs px-1 py-1 rounded-lg ${i === 0 ? 'bg-brand-soft' : ''}`}>
            <span className="font-medium text-brand-dark truncate">{i + 1}. {row.name}</span>
            <span className="text-center font-semibold text-brand-dark">{row.wins}</span>
            <span className="text-center text-brand-dark">{row.losses}</span>
            <span className="text-center text-brand-muted">{row.pf}</span>
            <span className="text-center text-brand-muted">{row.pa}</span>
            <span className={`text-center font-semibold ${diff >= 0 ? 'text-brand-active' : 'text-red-600'}`}>
              {diff >= 0 ? '+' : ''}{diff}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MatchCard({
  match, regs, isOrganizer, scoringId, score1, score2, scoreLoading, scoreError,
  onStartScoring, onCancelScoring, onSaveScore, onScore1Change, onScore2Change,
}: {
  match: Match
  regs: Registration[]
  isOrganizer: boolean
  scoringId: string | null
  score1: string
  score2: string
  scoreLoading: boolean
  scoreError: string | null
  onStartScoring: (id: string) => void
  onCancelScoring: () => void
  onSaveScore: (id: string) => void
  onScore1Change: (v: string) => void
  onScore2Change: (v: string) => void
}) {
  const t1 = teamLabel(match.team_1_registration_id, regs)
  const t2 = teamLabel(match.team_2_registration_id, regs)
  const isDone = match.status === 'completed'
  const isBye = !match.team_2_registration_id
  const isScoring = scoringId === match.id
  const w = match.winner_registration_id

  const stageLabel: Record<string, string> = {
    round_robin: 'Round Robin', winners_bracket: 'Winners', losers_bracket: 'Losers',
    championship: 'Championship', pool_play: 'Pool Play', playoffs: 'Playoffs', consolation: 'Consolation',
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold truncate ${isDone && w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-dark'}`}>
              {t1}
            </span>
            {isDone && match.team_1_score != null && (
              <span className={`text-sm font-bold shrink-0 ${w === match.team_1_registration_id ? 'text-brand-active' : 'text-brand-muted'}`}>
                {match.team_1_score}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold truncate ${isDone && w === match.team_2_registration_id ? 'text-brand-active' : isBye ? 'text-brand-muted italic' : 'text-brand-dark'}`}>
              {t2}
            </span>
            {isDone && match.team_2_score != null && !isBye && (
              <span className={`text-sm font-bold shrink-0 ${w === match.team_2_registration_id ? 'text-brand-active' : 'text-brand-muted'}`}>
                {match.team_2_score}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
            isDone ? 'bg-brand-soft text-brand-active' :
            match.status === 'in_progress' ? 'bg-yellow-50 text-yellow-700' :
            'bg-gray-100 text-gray-500'
          }`}>
            {isDone ? (isBye ? 'Bye' : 'Done') : match.status.replace('_', ' ')}
          </span>
          <div className="text-right">
            <span className="text-[10px] text-brand-muted block">#{match.match_number}</span>
            {match.round_number && (
              <span className="text-[10px] text-brand-muted block">
                {stageLabel[match.match_stage] ?? match.match_stage} R{match.round_number}
              </span>
            )}
          </div>
        </div>
      </div>

      {isOrganizer && !isDone && !isBye && !isScoring && (
        <button
          onClick={() => onStartScoring(match.id)}
          className="w-full py-1.5 rounded-lg border border-brand-border text-xs text-brand-active hover:bg-brand-soft transition-colors font-medium"
        >
          Enter Score
        </button>
      )}

      {isScoring && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-brand-muted mb-1 truncate">{t1}</label>
              <input type="number" value={score1} onChange={e => onScore1Change(e.target.value)}
                placeholder="0" min={0} className="w-full input text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-brand-muted mb-1 truncate">{t2}</label>
              <input type="number" value={score2} onChange={e => onScore2Change(e.target.value)}
                placeholder="0" min={0} className="w-full input text-sm" />
            </div>
          </div>
          {scoreError && <p className="text-xs text-red-600">{scoreError}</p>}
          <div className="flex gap-2">
            <button onClick={() => onSaveScore(match.id)} disabled={scoreLoading}
              className="flex-1 py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors">
              {scoreLoading ? 'Saving…' : 'Save Score'}
            </button>
            <button onClick={onCancelScoring}
              className="px-3 py-1.5 rounded-lg border border-brand-border text-xs text-brand-muted hover:bg-brand-soft transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MatchesSection({ tournamentId, divisions, initialMatches, isOrganizer }: Props) {
  const [matchesByDiv, setMatchesByDiv] = useState<Record<string, Match[]>>(() => {
    const map: Record<string, Match[]> = {}
    for (const div of divisions) map[div.id] = []
    for (const m of initialMatches) {
      if (!map[m.division_id]) map[m.division_id] = []
      map[m.division_id].push(m)
    }
    return map
  })

  const [generating, setGenerating] = useState<Record<string, boolean>>({})
  const [genError, setGenError] = useState<Record<string, string | null>>({})
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [score1, setScore1] = useState('')
  const [score2, setScore2] = useState('')
  const [scoreLoading, setScoreLoading] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)

  async function handleGenerate(div: Division) {
    setGenerating(prev => ({ ...prev, [div.id]: true }))
    setGenError(prev => ({ ...prev, [div.id]: null }))

    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${div.id}/generate-matches`,
      { method: 'POST' }
    )
    const json = await res.json()

    if (!res.ok) {
      setGenError(prev => ({ ...prev, [div.id]: json.error ?? 'Failed to generate matches' }))
      setGenerating(prev => ({ ...prev, [div.id]: false }))
      return
    }

    setMatchesByDiv(prev => ({ ...prev, [div.id]: json.matches }))
    setGenerating(prev => ({ ...prev, [div.id]: false }))
  }

  async function handleSaveScore(matchId: string, divId: string) {
    const s1 = Number(score1)
    const s2 = Number(score2)

    if (!Number.isInteger(s1) || !Number.isInteger(s2) || score1 === '' || score2 === '') {
      setScoreError('Scores must be whole numbers'); return
    }
    if (s1 < 0 || s2 < 0) { setScoreError('Scores cannot be negative'); return }
    if (s1 === s2) { setScoreError('Tie scores are not allowed'); return }

    setScoreLoading(true)
    setScoreError(null)

    const res = await fetch(`/api/tournaments/${tournamentId}/matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_1_score: s1, team_2_score: s2 }),
    })
    const json = await res.json()

    if (!res.ok) { setScoreError(json.error ?? 'Failed to save score'); setScoreLoading(false); return }

    setMatchesByDiv(prev => ({
      ...prev,
      [divId]: prev[divId].map(m => m.id === matchId ? json.match : m),
    }))
    setScoringId(null)
    setScore1(''); setScore2('')
    setScoreLoading(false)
  }

  const showsStandings = (ft: string) => ft === 'round_robin' || ft === 'pool_play_playoffs'
  const showsBracket = (ft: string) => ft === 'single_elimination' || ft === 'double_elimination' || ft === 'pool_play_playoffs'

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-base font-bold text-brand-dark">Matches</h2>

      {divisions.map(div => {
        const divMatches = (matchesByDiv[div.id] ?? []).sort((a, b) => a.match_number - b.match_number)
        const hasMatches = divMatches.length > 0
        const pools = Array.from(new Set(divMatches.filter(m => m.pool_number != null).map(m => m.pool_number!))).sort((a, b) => a - b)
        const hasCompletedMatches = divMatches.some(m => m.status === 'completed' && m.team_2_registration_id)

        const matchCardProps = {
          regs: div.tournament_registrations,
          isOrganizer,
          scoringId,
          score1, score2, scoreLoading, scoreError,
          onStartScoring: (id: string) => { setScoringId(id); setScore1(''); setScore2(''); setScoreError(null) },
          onCancelScoring: () => { setScoringId(null); setScoreError(null) },
          onSaveScore: (id: string) => handleSaveScore(id, div.id),
          onScore1Change: setScore1,
          onScore2Change: setScore2,
        }

        return (
          <div key={div.id} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-heading text-sm font-bold text-brand-dark">{div.name}</p>
              <span className="text-xs text-brand-muted">{div.format_type.replace(/_/g, ' ')}</span>
            </div>

            {!hasMatches && isOrganizer && (
              <div className="space-y-2">
                <button
                  onClick={() => handleGenerate(div)}
                  disabled={generating[div.id]}
                  className="w-full py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
                >
                  {generating[div.id] ? 'Generating…' : 'Generate Matches'}
                </button>
                {genError[div.id] && <p className="text-xs text-red-600">{genError[div.id]}</p>}
              </div>
            )}

            {!hasMatches && !isOrganizer && (
              <p className="text-xs text-brand-muted">No matches scheduled yet.</p>
            )}

            {hasMatches && (
              <div className="space-y-3">
                {/* Pool play / round-robin: card list per pool */}
                {pools.length > 0 && (
                  <div className="space-y-2">
                    {pools.map(poolNum => (
                      <div key={poolNum} className="space-y-2">
                        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Pool {poolNum}</p>
                        {divMatches.filter(m => m.pool_number === poolNum).map(m => (
                          <MatchCard key={m.id} match={m} {...matchCardProps} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Bracket view for elimination formats */}
                {showsBracket(div.format_type) && (
                  <BracketView
                    matches={divMatches.filter(m => m.pool_number == null)}
                    regs={div.tournament_registrations}
                    isOrganizer={isOrganizer}
                    tournamentId={tournamentId}
                    divisionId={div.id}
                    onScoreUpdate={(updated) => {
                      setMatchesByDiv(prev => ({
                        ...prev,
                        [div.id]: prev[div.id].map(m => m.id === updated.id ? updated : m),
                      }))
                    }}
                  />
                )}

                {/* Flat list for plain round-robin (no pools, no bracket) */}
                {pools.length === 0 && !showsBracket(div.format_type) && (
                  <div className="space-y-2">
                    {divMatches.map(m => <MatchCard key={m.id} match={m} {...matchCardProps} />)}
                  </div>
                )}

                {showsStandings(div.format_type) && hasCompletedMatches && (
                  <div className="border-t border-brand-border pt-3 space-y-3">
                    <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Standings</p>
                    {pools.length > 0 ? (
                      pools.map(poolNum => (
                        <div key={poolNum} className="space-y-1">
                          <p className="text-[10px] font-semibold text-brand-muted uppercase">Pool {poolNum}</p>
                          <StandingsTable rows={computeStandings(divMatches, div.tournament_registrations, poolNum)} />
                        </div>
                      ))
                    ) : (
                      <StandingsTable rows={computeStandings(divMatches, div.tournament_registrations)} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
