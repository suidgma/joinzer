'use client'
import { useState } from 'react'
import { X, CheckCircle, Circle, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Registration = {
  id: string
  status: string
  payment_status?: string
}

type Division = {
  id: string
  name: string
  cost_cents: number | null
  tournament_registrations: Registration[]
}

type Props = {
  tournamentId: string
  tournamentCostCents: number
  divisions: Division[]
  hasMatches: boolean
  onClose: () => void
  onRegistrationClosed: () => void
}

export default function PrepTournamentModal({
  tournamentId, tournamentCostCents, divisions, hasMatches, onClose, onRegistrationClosed,
}: Props) {
  const [closing, setClosing] = useState(false)
  const [closed, setClosed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allRegs = divisions.flatMap(d => d.tournament_registrations)
  const registered = allRegs.filter(r => r.status === 'registered')
  const unpaid = registered.filter(r => {
    const divCost = divisions.find(d => d.tournament_registrations.some(tr => tr.id === r.id))?.cost_cents
    const effectiveCost = divCost != null ? divCost : tournamentCostCents
    return effectiveCost > 0 && (!r.payment_status || r.payment_status === 'unpaid')
  })

  async function handleCloseRegistration() {
    setClosing(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('tournaments')
      .update({ registration_status: 'closed' })
      .eq('id', tournamentId)
    if (err) { setError(err.message); setClosing(false); return }
    setClosed(true)
    onRegistrationClosed()
    setClosing(false)
  }

  type Step = { label: string; done: boolean; note?: string }
  const steps: Step[] = [
    {
      label: `${registered.length} player${registered.length !== 1 ? 's' : ''} registered`,
      done: registered.length > 0,
      note: registered.length === 0 ? 'No registrations yet' : undefined,
    },
    {
      label: unpaid.length === 0 ? 'All fees collected' : `${unpaid.length} unpaid registration${unpaid.length !== 1 ? 's' : ''}`,
      done: unpaid.length === 0,
      note: unpaid.length > 0 ? 'Use "Mark Paid" or "Refund" in each division' : undefined,
    },
    {
      label: closed ? 'Registration closed' : 'Close registration',
      done: closed,
    },
    {
      label: hasMatches ? 'Matches generated' : 'Generate matches (next step)',
      done: hasMatches,
      note: hasMatches ? undefined : 'Use "Generate Matches" on the main page after closing registration',
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Prep for Tournament Day</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>

        <ul className="space-y-3">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              {step.done
                ? <CheckCircle size={18} className="text-green-500 mt-0.5 shrink-0" />
                : <Circle size={18} className="text-brand-border mt-0.5 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${step.done ? 'text-green-700' : 'text-brand-dark'}`}>
                  {step.label}
                </p>
                {step.note && (
                  <p className="text-xs text-brand-muted mt-0.5 flex items-center gap-1">
                    {!step.done && <AlertTriangle size={11} className="shrink-0 text-amber-500" />}
                    {step.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {!closed && (
          <button
            onClick={handleCloseRegistration}
            disabled={closing}
            className="w-full py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
          >
            {closing ? 'Closing…' : 'Close Registration Now'}
          </button>
        )}

        {closed && !hasMatches && (
          <div className="bg-brand-soft rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-brand-dark">✓ Registration closed</p>
            <p className="text-xs text-brand-muted mt-1">
              Head back and use &ldquo;Generate Matches&rdquo; to build the bracket.
            </p>
          </div>
        )}

        {closed && hasMatches && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-semibold text-green-700">✓ Tournament is ready!</p>
            <p className="text-xs text-green-600 mt-1">Matches generated, registration closed.</p>
          </div>
        )}
      </div>
    </div>
  )
}
