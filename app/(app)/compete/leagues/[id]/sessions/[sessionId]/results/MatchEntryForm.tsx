'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Player = { id: string; name: string }

type Props = {
  sessionId: string
  leagueId: string
  players: Player[]
  pointsToWin: number
}

export default function MatchEntryForm({ sessionId, leagueId, players, pointsToWin }: Props) {
  const router = useRouter()
  const [t1p1, setT1p1] = useState('')
  const [t1p2, setT1p2] = useState('')
  const [t2p1, setT2p1] = useState('')
  const [t2p2, setT2p2] = useState('')
  const [winner, setWinner] = useState<'1' | '2' | ''>('')
  const [loserScore, setLoserScore] = useState('')
  const [court, setCourt] = useState('')
  const [round, setRound] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!t1p1 || !t2p1) { setError('At least Team 1 Player 1 and Team 2 Player 1 are required.'); return }
    if (!winner) { setError('Select a winning team.'); return }
    if (loserScore === '') { setError('Enter the loser score.'); return }
    setLoading(true)
    setError(null)

    const loser = parseInt(loserScore)
    const supabase = createClient()
    const { error: insertErr } = await supabase.from('league_matches').insert({
      session_id: sessionId,
      round_number: parseInt(round) || 1,
      court_number: court ? parseInt(court) : null,
      team1_player1_id: t1p1 || null,
      team1_player2_id: t1p2 || null,
      team2_player1_id: t2p1 || null,
      team2_player2_id: t2p2 || null,
      team1_score: winner === '1' ? pointsToWin : loser,
      team2_score: winner === '2' ? pointsToWin : loser,
    })

    if (insertErr) { setError(insertErr.message); setLoading(false); return }

    setT1p1(''); setT1p2(''); setT2p1(''); setT2p2('')
    setWinner(''); setLoserScore(''); setCourt('')
    router.refresh()
    setLoading(false)
  }

  const selectCls = 'w-full input text-sm'

  return (
    <form onSubmit={handleSubmit} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs font-medium text-brand-muted mb-1">Round</p>
          <input type="number" min="1" value={round} onChange={(e) => setRound(e.target.value)} className="w-full input text-sm" />
        </div>
        <div>
          <p className="text-xs font-medium text-brand-muted mb-1">Court</p>
          <input type="number" min="1" value={court} onChange={(e) => setCourt(e.target.value)} placeholder="optional" className="w-full input text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Team 1 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-brand-dark">Team 1</p>
          <select value={t1p1} onChange={(e) => setT1p1(e.target.value)} className={selectCls}>
            <option value="">Player 1</option>
            {players.filter((p) => p.id !== t1p2 && p.id !== t2p1 && p.id !== t2p2).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select value={t1p2} onChange={(e) => setT1p2(e.target.value)} className={selectCls}>
            <option value="">Player 2</option>
            {players.filter((p) => p.id !== t1p1 && p.id !== t2p1 && p.id !== t2p2).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Team 2 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-brand-dark">Team 2</p>
          <select value={t2p1} onChange={(e) => setT2p1(e.target.value)} className={selectCls}>
            <option value="">Player 1</option>
            {players.filter((p) => p.id !== t1p1 && p.id !== t1p2 && p.id !== t2p2).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select value={t2p2} onChange={(e) => setT2p2(e.target.value)} className={selectCls}>
            <option value="">Player 2</option>
            {players.filter((p) => p.id !== t1p1 && p.id !== t1p2 && p.id !== t2p1).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Winner + loser score */}
      <div>
        <p className="text-xs font-medium text-brand-muted mb-2">Who won?</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWinner('1')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${winner === '1' ? 'bg-brand text-brand-dark' : 'bg-brand-soft text-brand-muted hover:bg-brand-border'}`}
          >
            Team 1
          </button>
          <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
            <span className="text-[10px] text-brand-muted leading-none">Loser score</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={loserScore}
              onChange={(e) => setLoserScore(e.target.value)}
              placeholder="0"
              className="w-16 input text-sm text-center"
            />
          </div>
          <button
            type="button"
            onClick={() => setWinner('2')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${winner === '2' ? 'bg-brand text-brand-dark' : 'bg-brand-soft text-brand-muted hover:bg-brand-border'}`}
          >
            Team 2
          </button>
        </div>
        {winner && loserScore !== '' && (
          <p className="text-center text-xs text-brand-muted mt-1">
            Score: {winner === '1' ? `${pointsToWin} – ${loserScore}` : `${loserScore} – ${pointsToWin}`}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Saving…' : 'Save Match'}
      </button>
    </form>
  )
}
