'use client'

import { useState } from 'react'
import { useDialog } from '@/components/ui/DialogProvider'

// Only settled teams (paid/waived/comped) get bracket/pool slots.
const SETTLED = ['paid', 'waived', 'comped']

type Reg = {
  id: string
  partner_registration_id: string | null
  pool_number?: number | null
  payment_status?: string | null
  user_profile: { name: string | null } | null
}

type Props = {
  tournamentId: string
  divisionId: string
  numPools: number
  /** Active (non-cancelled) registrations for the division. */
  registrations: Reg[]
  /** Called after a save so the parent can mirror pool_number onto both partners. */
  onAssigned: (regId: string, partnerId: string | null, poolNumber: number | null) => void
}

function firstName(name: string | null | undefined): string {
  return name ? name.trim().split(/\s+/)[0] : '?'
}

/**
 * Organizer tool for manually assigning teams to pools before a pool-play bracket
 * is generated. Each team picks a pool (or "Auto"); unassigned teams are
 * auto-balanced by seed at generation time. Renders null until there are settled
 * teams. Caller decides when to mount it (pool-play division, no matches yet).
 */
export default function PoolAssignment({ tournamentId, divisionId, numPools, registrations, onAssigned }: Props) {
  const [savingId, setSavingId] = useState<string | null>(null)
  const { alert } = useDialog()

  const settled = registrations.filter(r => SETTLED.includes(r.payment_status ?? ''))

  // Dedupe to one canonical entry per team (matches dedupeRegistrationsToTeams:
  // the lexicographically-smaller registration id of a doubles pair).
  type Team = { id: string; partnerId: string | null; label: string; pool: number | null }
  const teams: Team[] = []
  const seen = new Set<string>()
  for (const r of settled) {
    const partnerId = r.partner_registration_id
    if (!partnerId) {
      teams.push({ id: r.id, partnerId: null, label: firstName(r.user_profile?.name), pool: r.pool_number ?? null })
      continue
    }
    const canonical = r.id < partnerId ? r.id : partnerId
    if (seen.has(canonical)) continue
    seen.add(canonical)
    const canonReg = settled.find(x => x.id === canonical) ?? r
    const otherReg = settled.find(x => x.id === (canonical === r.id ? partnerId : r.id))
    const names = [firstName(canonReg.user_profile?.name), otherReg ? firstName(otherReg.user_profile?.name) : '?']
      .sort((a, b) => a.localeCompare(b))
    teams.push({ id: canonReg.id, partnerId: otherReg?.id ?? null, label: names.join('/'), pool: canonReg.pool_number ?? null })
  }
  teams.sort((a, b) => a.label.localeCompare(b.label))

  if (teams.length === 0) return null

  async function setPool(team: Team, pool: number | null) {
    setSavingId(team.id)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${divisionId}/assign-pool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_id: team.id, pool_number: pool }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        await alert({ body: err.error ?? 'Failed to set pool' })
        return
      }
      onAssigned(team.id, team.partnerId, pool)
    } finally {
      setSavingId(null)
    }
  }

  const poolNums = Array.from({ length: Math.max(1, numPools) }, (_, i) => i + 1)
  const sections: Array<number | null> = [...poolNums, null]

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Pool Assignment</p>
        <span className="text-xs text-brand-muted">Optional · unassigned auto-balance by seed</span>
      </div>
      <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-3">
        {sections.map(p => {
          const inPool = teams.filter(t => (t.pool ?? null) === p)
          return (
            <div key={p ?? 'unassigned'} className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-brand-dark border-b border-brand-border/60 pb-1">
                {p == null ? `Unassigned · ${inPool.length}` : `Pool ${p} · ${inPool.length}`}
              </p>
              {inPool.length === 0 ? (
                <p className="text-xs text-brand-muted pl-2">—</p>
              ) : inPool.map(t => (
                <div key={t.id} className="flex items-center gap-2 pl-2">
                  <span className="text-sm text-brand-dark flex-1 min-w-0 truncate">{t.label}</span>
                  <select
                    value={t.pool ?? ''}
                    disabled={savingId === t.id}
                    onChange={e => setPool(t, e.target.value === '' ? null : Number(e.target.value))}
                    className="input text-xs py-0.5 flex-shrink-0 disabled:opacity-50"
                  >
                    <option value="">Auto</option>
                    {poolNums.map(n => <option key={n} value={n}>Pool {n}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
