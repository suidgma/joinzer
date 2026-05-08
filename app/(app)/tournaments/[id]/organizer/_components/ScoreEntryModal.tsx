'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import type { OrgMatch, OrgRegistration } from './types'

export function teamLabel(regId: string | null, regs: OrgRegistration[]): string {
  if (!regId) return 'BYE'
  const r = regs.find(x => x.id === regId)
  if (!r) return '—'
  return r.team_name || r.player_name || regId.slice(0, 8)
}

type Props = {
  tournamentId: string
  match: OrgMatch
  registrations: OrgRegistration[]
  onClose: () => void
  onSaved: (updated: OrgMatch) => void
  onError: (msg: string) => void
}

export default function ScoreEntryModal({ tournamentId, match, registrations, onClose, onSaved, onError }: Props) {
  const t1 = teamLabel(match.team_1_registration_id, registrations)
  const t2 = teamLabel(match.team_2_registration_id, registrations)
  const [s1, setS1] = useState<number>(match.team_1_score ?? 0)
  const [s2, setS2] = useState<number>(match.team_2_score ?? 0)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleSave() {
    if (s1 === s2) { setLocalError('Scores cannot be tied'); return }
    if (s1 < 0 || s2 < 0) { setLocalError('Scores cannot be negative'); return }

    setSaving(true)
    setLocalError(null)

    // Optimistic update — close modal immediately, roll back on error
    const optimisticWinner = s1 > s2 ? match.team_1_registration_id : match.team_2_registration_id
    const optimistic: OrgMatch = {
      ...match,
      team_1_score: s1,
      team_2_score: s2,
      winner_registration_id: optimisticWinner,
      status: 'completed',
    }
    onSaved(optimistic)
    onClose()

    const res = await fetch(`/api/tournaments/${tournamentId}/matches/${match.id}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_1_score: s1, team_2_score: s2 }),
    })
    const json = await res.json()

    if (!res.ok) {
      onSaved(match) // roll back
      onError(json.error ?? 'Failed to save score')
    } else {
      onSaved(json.match)
    }
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-5 pb-safe-bottom"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Enter Score</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <ScoreRow label={t1} value={s1} onChange={setS1} />
          <div className="text-center text-brand-muted text-xs font-semibold tracking-widest uppercase">vs</div>
          <ScoreRow label={t2} value={s2} onChange={setS2} />
        </div>

        {localError && <p className="text-xs text-red-600 text-center">{localError}</p>}

        <p className="text-[11px] text-brand-muted text-center">Saving will mark this match as complete.</p>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-4 rounded-xl bg-brand text-brand-dark font-bold text-base hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Score'}
        </button>
      </div>
    </div>
  )
}

function ScoreRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-sm font-semibold text-brand-dark truncate">{label}</span>
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-11 h-11 rounded-full border-2 border-brand-border text-2xl font-bold text-brand-dark flex items-center justify-center hover:bg-brand-soft active:scale-95 transition-transform"
        >
          −
        </button>
        <span className="w-10 text-center text-3xl font-bold text-brand-dark tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-11 h-11 rounded-full border-2 border-brand-border text-2xl font-bold text-brand-dark flex items-center justify-center hover:bg-brand-soft active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
    </div>
  )
}
