'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import PlayerCombobox, { type PlayerOption } from '@/components/ui/PlayerCombobox'
import { X } from 'lucide-react'

// The result the parent needs to render the requester status line after a request is created.
export type CreatedRequest = {
  request_id: string
  status: 'open' | 'filled'
  fulfillment_mode: 'open_pool' | 'self_assigned'
  filled_by_user_id?: string
  subName?: string | null
}

type Props = {
  leagueId: string
  // Exactly one of sessionId (round-robin) / periodId (box/ladder).
  scope: { sessionId?: string; periodId?: string }
  currentUserId?: string
  onCreated: (r: CreatedRequest) => void
  onJustAbsent: () => void
  onClose: () => void
}

// The "Can't make it?" decision sheet (mobile-first bottom sheet). One clear follow-up with three
// choices — no internal concepts (open_pool / self_assigned / placement) surface to the player.
// Everything else is derived server-side by create_player_sub_request, so the common path is 2 taps.
export default function SubDecisionSheet({ leagueId, scope, currentUserId, onCreated, onJustAbsent, onClose }: Props) {
  const [view, setView] = useState<'choices' | 'pick'>('choices')
  const [busy, setBusy] = useState<null | 'find' | 'self'>(null)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<PlayerOption[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const firstBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstBtnRef.current?.focus()
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const selectedName = (candidates ?? []).find((c) => c.id === selectedId)?.name ?? ''

  function scopeBody() {
    return scope.sessionId ? { league_session_id: scope.sessionId } : { league_period_id: scope.periodId }
  }

  async function create(mode: 'open_pool' | 'self_assigned', chosenUserId?: string) {
    setBusy(mode === 'open_pool' ? 'find' : 'self')
    setError(null)
    try {
      const res = await fetch('/api/league-sub-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league_id: leagueId, fulfillment_mode: mode, chosen_user_id: chosenUserId ?? null, ...scopeBody() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not create the request.'); return }
      onCreated({
        request_id: body.request_id,
        status: body.status,
        fulfillment_mode: body.fulfillment_mode,
        filled_by_user_id: body.filled_by_user_id,
        subName: chosenUserId ? selectedName : null,
      })
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function openPicker() {
    setView('pick')
    if (candidates === null) {
      const supabase = createClient()
      const { data } = await supabase.from('profiles').select('id, name').order('name').limit(1000)
      setCandidates(((data ?? []) as PlayerOption[]).filter((p) => p.id !== currentUserId))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Can't make it — choose what to do"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-brand-page rounded-t-3xl sm:rounded-3xl p-5 space-y-3 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-brand-dark">Can&apos;t make it?</h2>
          <button onClick={onClose} aria-label="Close" className="text-brand-muted hover:text-brand-dark">
            <X className="w-5 h-5" />
          </button>
        </div>

        {view === 'choices' && (
          <div className="space-y-2">
            <button
              ref={firstBtnRef}
              onClick={() => create('open_pool')}
              disabled={busy !== null}
              aria-busy={busy === 'find'}
              className="w-full rounded-2xl bg-brand-dark px-4 py-3 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {busy === 'find' ? 'Setting it up…' : 'Find me a substitute'}
            </button>
            <button
              onClick={openPicker}
              disabled={busy !== null}
              className="w-full rounded-2xl border border-brand-border bg-brand-surface px-4 py-3 text-sm font-semibold text-brand-dark hover:bg-brand-soft disabled:opacity-60"
            >
              I already have a substitute
            </button>
            <button
              onClick={() => { onJustAbsent(); onClose() }}
              disabled={busy !== null}
              className="w-full rounded-2xl px-4 py-2.5 text-sm font-medium text-brand-muted hover:text-brand-dark disabled:opacity-60"
            >
              Just mark me absent
            </button>
            <p className="text-[11px] text-brand-muted text-center">
              Eligible players can pick up an open request — no organizer approval needed.
            </p>
          </div>
        )}

        {view === 'pick' && (
          <div className="space-y-2">
            <p className="text-sm text-brand-body">Pick the player who&apos;s covering for you.</p>
            <PlayerCombobox
              options={candidates ?? []}
              value={selectedId}
              onChange={(id) => { setSelectedId(id); setError(null) }}
              placeholder="Search players…"
              emptyText="No players available"
            />
            <button
              onClick={() => selectedId && create('self_assigned', selectedId)}
              disabled={!selectedId || busy !== null}
              aria-busy={busy === 'self'}
              className="w-full rounded-2xl bg-brand-dark px-4 py-3 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {busy === 'self' ? 'Confirming…' : selectedName ? `Confirm ${selectedName} as my sub` : 'Confirm my sub'}
            </button>
            <button
              onClick={() => { setView('choices'); setError(null) }}
              disabled={busy !== null}
              className="w-full rounded-2xl px-4 py-2 text-xs font-medium text-brand-muted hover:text-brand-dark"
            >
              ← Back
            </button>
            <p className="text-[11px] text-brand-muted">
              They must be an eligible Joinzer player. Not on Joinzer? Ask your organizer to add them.
            </p>
          </div>
        )}

        {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
      </div>
    </div>
  )
}
