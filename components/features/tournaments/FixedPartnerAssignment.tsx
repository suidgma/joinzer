'use client'

import { useState } from 'react'
import { useDialog } from '@/components/ui/DialogProvider'

// Settled = the organizer has a confirmed entrant (paid, waived, or comped).
// Pending/unpaid regs aren't shown — they may never become real entrants.
const SETTLED = ['paid', 'waived', 'comped']

type Reg = {
  id: string
  user_id: string
  partner_registration_id: string | null
  payment_status?: string | null
  user_profile: { name: string | null } | null
}

type Props = {
  tournamentId: string
  divisionId: string
  /** Active (non-cancelled) registrations for the division. */
  registrations: Reg[]
  /**
   * Called after a successful save so the parent can update its own
   * registration state bidirectionally (and clear any displaced back-links).
   */
  onAssigned: (reg1Id: string, reg2Id: string | null) => void
}

/**
 * Organizer-only UI for pairing players into fixed teams before a doubles
 * bracket is generated. Renders settled registrations as confirmed teams plus
 * an "Unassigned" list, each with an inline partner picker. Returns null when
 * there are no settled registrations yet. Caller decides when to mount it
 * (fixed-mode doubles division, no matches generated).
 */
export default function FixedPartnerAssignment({ tournamentId, divisionId, registrations, onAssigned }: Props) {
  const [assigningRegId, setAssigningRegId] = useState<string | null>(null)
  const { alert } = useDialog()
  const [partnerSelections, setPartnerSelections] = useState<Record<string, string>>({})
  const [savingRegId, setSavingRegId] = useState<string | null>(null)

  const settled = registrations.filter(r => SETTLED.includes(r.payment_status ?? ''))
  if (settled.length === 0) return null

  // Dedupe paired registrations into teams (each pair links both directions).
  const seenPairs = new Set<string>()
  const teams: Array<{ r1: Reg; r2: Reg; label: string }> = []
  for (const r of settled) {
    if (!r.partner_registration_id) continue
    const partner = settled.find(x => x.id === r.partner_registration_id)
    if (!partner) continue
    const canonical = r.id < r.partner_registration_id ? `${r.id}|${r.partner_registration_id}` : `${r.partner_registration_id}|${r.id}`
    if (seenPairs.has(canonical)) continue
    seenPairs.add(canonical)
    const n1 = (r.user_profile?.name ?? '?').split(' ')[0]
    const n2 = (partner.user_profile?.name ?? '?').split(' ')[0]
    const [first, second] = n1.localeCompare(n2) <= 0 ? [n1, n2] : [n2, n1]
    teams.push({ r1: r, r2: partner, label: `Team ${first}/${second}` })
  }
  teams.sort((a, b) => a.label.localeCompare(b.label))
  const unassigned = settled.filter(r => !r.partner_registration_id)

  async function handleAssign(reg1Id: string) {
    const reg2Id = partnerSelections[reg1Id] || null
    setSavingRegId(reg1Id)
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/divisions/${divisionId}/assign-partner`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reg1_id: reg1Id, reg2_id: reg2Id }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        await alert({ body: err.error ?? 'Failed to assign partner' })
        return
      }
      onAssigned(reg1Id, reg2Id)
      setAssigningRegId(null)
      setPartnerSelections(prev => { const n = { ...prev }; delete n[reg1Id]; return n })
    } finally {
      setSavingRegId(null)
    }
  }

  // Eligible partners for a given player: any other settled reg that is itself
  // unpaired or already linked to this player.
  const eligibleFor = (regId: string) =>
    settled.filter(o => o.id !== regId && (!o.partner_registration_id || o.partner_registration_id === regId))

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Fixed Partners</p>
        <span className="text-xs text-brand-muted">Required for schedule generation</span>
      </div>
      <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-2">

        {teams.map(({ r1, r2, label }) => (
          <div key={`${r1.id}-${r2.id}`} className="border-b border-brand-border last:border-0 pb-2 last:pb-0 space-y-1.5">
            <span className="text-sm font-semibold text-brand-dark">{label}</span>
            {[r1, r2].map(r => {
              const isAssigning = assigningRegId === r.id
              return (
                <div key={r.id} className="flex items-center gap-2 pl-2">
                  <span className="text-xs text-brand-muted flex-1 truncate">{r.user_profile?.name ?? '—'}</span>
                  {isAssigning ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <select
                        value={partnerSelections[r.id] ?? r.partner_registration_id ?? ''}
                        onChange={e => setPartnerSelections(prev => ({ ...prev, [r.id]: e.target.value }))}
                        className="input text-xs py-0.5"
                      >
                        <option value="">— No partner —</option>
                        {eligibleFor(r.id).map(o => (
                          <option key={o.id} value={o.id}>{o.user_profile?.name ?? o.id}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAssign(r.id)}
                        disabled={savingRegId === r.id}
                        className="text-xs px-2 py-0.5 rounded bg-brand text-brand-dark font-semibold disabled:opacity-40"
                      >
                        {savingRegId === r.id ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setAssigningRegId(null)} className="text-xs text-brand-muted">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAssigningRegId(r.id); setPartnerSelections(prev => ({ ...prev, [r.id]: r.partner_registration_id ?? '' })) }}
                      className="text-xs text-brand-active underline underline-offset-2 flex-shrink-0"
                    >
                      Change
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {unassigned.length > 0 && (
          <>
            {teams.length > 0 && <p className="text-[10px] font-semibold text-brand-muted uppercase tracking-wide pt-1">Unassigned</p>}
            {unassigned.map(r => {
              const isAssigning = assigningRegId === r.id
              return (
                <div key={r.id} className="flex items-center gap-2 py-1 border-b border-brand-border last:border-0">
                  <span className="text-sm font-medium text-brand-dark flex-1 min-w-0 truncate">{r.user_profile?.name ?? '—'}</span>
                  <span className="text-xs text-red-500 font-medium flex-shrink-0">No partner</span>
                  {isAssigning ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <select
                        value={partnerSelections[r.id] ?? ''}
                        onChange={e => setPartnerSelections(prev => ({ ...prev, [r.id]: e.target.value }))}
                        className="input text-xs py-0.5"
                      >
                        <option value="">— Select partner —</option>
                        {eligibleFor(r.id).map(o => (
                          <option key={o.id} value={o.id}>{o.user_profile?.name ?? o.id}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAssign(r.id)}
                        disabled={savingRegId === r.id}
                        className="text-xs px-2 py-0.5 rounded bg-brand text-brand-dark font-semibold disabled:opacity-40"
                      >
                        {savingRegId === r.id ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setAssigningRegId(null)} className="text-xs text-brand-muted">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAssigningRegId(r.id); setPartnerSelections(prev => ({ ...prev, [r.id]: '' })) }}
                      className="text-xs text-brand-active underline underline-offset-2 flex-shrink-0"
                    >
                      Assign
                    </button>
                  )}
                </div>
              )
            })}
          </>
        )}

        {teams.length === 0 && unassigned.length === 0 && (
          <p className="text-xs text-brand-muted">No settled registrations yet.</p>
        )}
      </div>
    </div>
  )
}
