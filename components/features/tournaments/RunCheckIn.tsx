'use client'

import { useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'

type Reg = { id: string; checked_in?: boolean | null; [k: string]: unknown }

// Organizer check-in list for run mode. Toggling applies locally (RunMode writes the store +
// enqueues the outbox); disabled while its op is in flight to avoid a double-tap racing itself.
export default function RunCheckIn({
  regs,
  teamName,
  onToggle,
  readOnly = false,
}: {
  regs: Reg[]
  teamName: (regId: string) => string
  onToggle: (regId: string, checkedIn: boolean) => Promise<void>
  readOnly?: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const inCount = regs.filter(r => r.checked_in).length

  if (regs.length === 0) {
    return <p className="text-sm text-brand-muted px-1">No registered players in this division.</p>
  }

  async function toggle(reg: Reg) {
    if (busy) return
    setBusy(reg.id)
    try {
      await onToggle(reg.id, !reg.checked_in)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide px-1">
        {inCount}/{regs.length} checked in
      </p>
      <div className="overflow-hidden rounded-xl border border-brand-border divide-y divide-brand-border">
        {regs.map(reg => {
          const on = !!reg.checked_in
          const rowInner = (
            <>
              <span className={`text-sm font-medium truncate ${on ? 'text-brand-dark' : 'text-brand-muted'}`}>
                {teamName(reg.id)}
              </span>
              {on ? (
                <CheckCircle2 className="w-5 h-5 text-brand-active shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-brand-border shrink-0" />
              )}
            </>
          )
          return readOnly ? (
            <div key={reg.id} className="w-full flex items-center justify-between gap-3 px-3 py-2.5">
              {rowInner}
            </div>
          ) : (
            <button
              key={reg.id}
              onClick={() => toggle(reg)}
              disabled={busy === reg.id}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-brand-soft/50 disabled:opacity-50 transition-colors"
            >
              {rowInner}
            </button>
          )
        })}
      </div>
    </div>
  )
}
