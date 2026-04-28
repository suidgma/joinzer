'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Player = { id: string; name: string }

type Props = {
  sessionId: string
  leagueId: string
  players: Player[]
}

export default function MatchEntryForm({ sessionId, leagueId, players }: Props) {
  const router = useRouter()
  const [t1p1, setT1p1] = useState('')
  const [t1p2, setT1p2] = useState('')
  const [t2p1, setT2p1] = useState('')
  const [t2p2, setT2p2] = useState('')
  const [t1Score, setT1Score] = useState('')
  const [t2Score, setT2Score] = useState('')
  const [court, setCourt] = useState('')
  const [round, setRound] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = new Set([t1p1, t1p2, t2p1, t2p2].filter(Boolean))

  function playerOptions(exclude: string[]) {
    return players.filter((p) => !exclude.includes(p.id) || selected.has(p.id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!t1p1 || !t2p1) { setError('At least Team 1 Player 1 and Team 2 Player 1 are required.'); return }
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: insertErr } = await supabase.from('league_matches').insert({
      session_id: sessionId,
      round_number: parseInt(round) || 1,
      court_number: court ? parseInt(court) : null,
      team1_player1_id: t1p1 || null,
      team1_player2_id: t1p2 || null,
      team2_player1_id: t2p1 || null,
      team2_player2_id: t2p2 || null,
      team1_score: t1Score !== '' ? parseInt(t1Score) : null,
      team2_score: t2Score !== '' ? parseInt(t2Score) : null,
    })

    if (insertErr) { setError(insertErr.message); setLoading(false); return }

    // Reset form
    setT1p1(''); setT1p2(''); setT2p1(''); setT2p2('')
    setT1Score(''); setT2Score(''); setCourt('')
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
          <input
            type="number" min="0" value={t1Score}
            onChange={(e) => setT1Score(e.target.value)}
            placeholder="Score"
            className="w-full input text-sm"
          />
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
          <input
            type="number" min="0" value={t2Score}
            onChange={(e) => setT2Score(e.target.value)}
            placeholder="Score"
            className="w-full input text-sm"
          />
        </div>
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
