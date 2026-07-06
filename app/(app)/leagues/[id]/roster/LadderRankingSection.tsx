'use client'

import { useRouter } from 'next/navigation'
import SeededRoster, { type SeededItem } from '@/components/features/leagues/SeededRoster'

// The ladder ordering editor — a flat, drag-to-reorder list (reuses SeededRoster).
// Used for the initial seeding and for manual rank adjustments any time. Saving
// replaces the stored ladder positions with this order.
export default function LadderRankingSection({
  leagueId,
  entrants,
  initialSaved,
}: {
  leagueId: string
  entrants: SeededItem[]
  initialSaved: boolean
}) {
  const router = useRouter()

  async function onSave(orderedIds: string[]) {
    const res = await fetch(`/api/leagues/${leagueId}/ladder/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedRegistrationIds: orderedIds }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? 'Save failed')
    }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div>
        <h2 className="font-heading text-base font-bold text-brand-dark">Ladder order</h2>
        <p className="text-xs text-brand-muted">
          Drag to set the starting order (#1 at the top). This seeds the courts on night one; after that, results move players up and down.
        </p>
      </div>
      {entrants.length === 0 ? (
        <p className="text-sm text-brand-muted">Add players below, then set their ladder order here.</p>
      ) : (
        <SeededRoster items={entrants} saveLabel="Save ladder order" initialSaved={initialSaved} onSave={onSave} />
      )}
    </div>
  )
}
