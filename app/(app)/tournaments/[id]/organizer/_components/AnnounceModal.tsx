'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

type Division = { id: string; name: string }

type AudienceFilter =
  | { type: 'all' }
  | { type: 'division'; division_id: string }
  | { type: 'unpaid' }
  | { type: 'waitlisted' }

type Props = {
  tournamentId: string
  playerCount: number
  divisions: Division[]
  onClose: () => void
  onSent: () => void
}

export default function AnnounceModal({ tournamentId, playerCount, divisions, onClose, onSent }: Props) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audienceType, setAudienceType] = useState<AudienceFilter['type']>('all')
  const [divisionId, setDivisionId] = useState<string>(divisions[0]?.id ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audienceLabel =
    audienceType === 'all' ? `all ${playerCount} registered players` :
    audienceType === 'division' ? `${divisions.find(d => d.id === divisionId)?.name ?? 'division'} players` :
    audienceType === 'unpaid' ? 'unpaid players' :
    'waitlisted players'

  function buildFilter(): AudienceFilter {
    if (audienceType === 'division') return { type: 'division', division_id: divisionId }
    return { type: audienceType } as AudienceFilter
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, filter: buildFilter() }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to send'); return }
      onSent()
      onClose()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSending(false)
    }
  }

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && !sending

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Email players</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>

        {/* Audience selector */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Send to</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(['all', 'unpaid', 'waitlisted'] as const).map(type => (
              <button
                key={type}
                onClick={() => setAudienceType(type)}
                className={`py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  audienceType === type
                    ? 'bg-brand-dark text-white border-brand-dark'
                    : 'bg-white text-brand-dark border-brand-border hover:border-brand-dark'
                }`}
              >
                {type === 'all' ? 'All registered' : type === 'unpaid' ? 'Unpaid only' : 'Waitlisted'}
              </button>
            ))}
            {divisions.length > 0 && (
              <button
                onClick={() => setAudienceType('division')}
                className={`py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  audienceType === 'division'
                    ? 'bg-brand-dark text-white border-brand-dark'
                    : 'bg-white text-brand-dark border-brand-border hover:border-brand-dark'
                }`}
              >
                By division
              </button>
            )}
          </div>

          {audienceType === 'division' && divisions.length > 0 && (
            <select
              value={divisionId}
              onChange={e => setDivisionId(e.target.value)}
              className="input w-full text-sm"
            >
              {divisions.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject line…"
          className="input w-full"
          autoFocus
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={`Your message to ${audienceLabel}…`}
          rows={4}
          className="input resize-none w-full"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending…' : `Send to ${audienceLabel}`}
        </button>
      </div>
    </div>
  )
}
