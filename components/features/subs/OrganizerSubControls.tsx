'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import PlayerCombobox, { type PlayerOption } from '@/components/ui/PlayerCombobox'

// Organizer operational controls for a FILLED substitute request. Before play is generated: reopen
// to the pool, cancel, or replace the substitute — all of which REVERSE the placement. After play is
// generated those three stop working by design (rewriting generated rounds/fixtures is unsupported),
// and the only remaining action is "Close record", which corrects the REQUEST RECORD and leaves the
// lineup and results exactly as they are. All go through /organizer-correct; hard gates are enforced
// server-side and surfaced as friendly errors.
export default function OrganizerSubControls({ requestId, subName }: { requestId: string; subName: string | null }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [candidates, setCandidates] = useState<PlayerOption[] | null>(null)
  const [selected, setSelected] = useState('')

  async function correct(mode: 'reopen' | 'cancel' | 'replace', newSubUserId?: string) {
    setBusy(mode); setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${requestId}/organizer-correct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, new_sub_user_id: newSubUserId ?? null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not complete.'); return }
      setDone(mode === 'reopen' ? 'Reopened to the substitute pool.' : mode === 'cancel' ? 'Request closed.' : 'Substitute replaced.')
    } catch { setError('Network error. Try again.') } finally { setBusy(null) }
  }

  async function closeRecord(reason: 'no_show' | 'other') {
    setBusy('close_record'); setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${requestId}/organizer-correct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'close_record', reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not complete.'); return }
      setDone('Record closed. The lineup and results are unchanged.')
    } catch { setError('Network error. Try again.') } finally { setBusy(null); setConfirmingClose(false) }
  }

  async function openPicker() {
    setPicking(true)
    if (candidates === null) {
      const supabase = createClient()
      const { data } = await supabase.from('profiles').select('id, name').order('name').limit(1000)
      setCandidates((data ?? []) as PlayerOption[])
    }
  }

  if (done) return <p role="status" className="text-xs font-semibold text-brand-active">{done}</p>

  return (
    <div className="rounded-xl border border-brand-border bg-brand-page px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-brand-muted">Organizer controls{subName ? ` · ${subName} is covering` : ''}</p>
      {picking ? (
        <div className="space-y-2">
          <PlayerCombobox options={candidates ?? []} value={selected} onChange={setSelected} placeholder="Pick a replacement…" emptyText="No players" />
          <div className="flex gap-2">
            <button onClick={() => selected && correct('replace', selected)} disabled={!selected || busy !== null} className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy === 'replace' ? 'Replacing…' : 'Replace'}</button>
            <button onClick={() => setPicking(false)} className="text-xs font-medium text-brand-muted">Cancel</button>
          </div>
        </div>
      ) : confirmingClose ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-brand-dark">Close this substitute record?</p>
          <p className="text-[11px] leading-snug text-brand-muted">
            Use this when {subName ?? 'the substitute'} never played. The record will show the request as closed.
            <span className="font-semibold text-brand-dark"> Matches, lineups and standings are not changed</span> — this only corrects the record.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => closeRecord('no_show')} disabled={busy !== null} className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy === 'close_record' ? 'Closing…' : "Didn't show"}</button>
            <button onClick={() => closeRecord('other')} disabled={busy !== null} className="rounded-lg border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-50">Another reason</button>
            <button onClick={() => setConfirmingClose(false)} disabled={busy !== null} className="text-xs font-medium text-brand-muted disabled:opacity-50">Keep it</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => correct('reopen')} disabled={busy !== null} className="rounded-lg border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-50">{busy === 'reopen' ? '…' : 'Remove & reopen'}</button>
          <button onClick={openPicker} disabled={busy !== null} className="rounded-lg border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-50">Replace</button>
          <button onClick={() => correct('cancel')} disabled={busy !== null} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">{busy === 'cancel' ? '…' : 'Remove & cancel'}</button>
          <button onClick={() => setConfirmingClose(true)} disabled={busy !== null} className="rounded-lg border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-brand-muted hover:bg-brand-soft disabled:opacity-50">Close record</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
