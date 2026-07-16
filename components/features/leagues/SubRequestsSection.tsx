'use client'

type SubRequest = {
  id: string
  league_id: string
  league_session_id: string
  status: string
  notes: string | null
  requesting_player: { name: string } | null
  claimed_by: { name: string } | null
  session: { session_date: string; session_number: number } | null
  league: { name: string } | null
}

type Props = {
  initialRequests: SubRequest[]
  // Retained for call-site compatibility (Home passes it); unused while the claim action is paused.
  currentUserId: string
}

function dateStr(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Phase 1: read-only. The old "I can sub" claim wrote a 'claimed' status and never actually placed
// the substitute; it is being replaced by the Phase 2 atomic accept-and-place flow. Until then this
// keeps open requests visible (awareness) without offering a paused action. This whole section is
// superseded by the Home "Needs Your Attention" Action Center in a later phase.
export default function SubRequestsSection({ initialRequests }: Props) {
  if (initialRequests.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="font-heading text-base font-bold text-brand-dark">Open Sub Requests</h2>

      <div className="space-y-2">
        {initialRequests.map((sr) => (
          <div key={sr.id} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark">
                  {sr.requesting_player?.name ?? 'Someone'} needs a sub
                </p>
                <p className="text-xs text-brand-muted">
                  {sr.league?.name}
                  {sr.session && ` · Session ${sr.session.session_number} · ${dateStr(sr.session.session_date)}`}
                </p>
                {sr.notes && <p className="text-xs text-brand-body mt-1">{sr.notes}</p>}
              </div>
              <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-brand-soft text-brand-active">
                Open
              </span>
            </div>
            <p className="text-xs text-brand-muted">Substitute sign-up is being upgraded — back shortly.</p>
          </div>
        ))}
      </div>
    </div>
  )
}
