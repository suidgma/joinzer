'use client'
import SeededRoster, { type SeededItem } from '@/components/features/leagues/SeededRoster'

// Box seeding lives on the Roster screen (no separate Boxes screen). The seeded
// order is persisted as boxes for the active cycle. See
// docs/phases/league-seeded-roster.md.
export default function BoxSeedingSection({
  leagueId, boxSize, entrants,
}: { leagueId: string; boxSize: number; entrants: SeededItem[] }) {
  async function onSave(orderedRegistrationIds: string[]) {
    const res = await fetch(`/api/leagues/${leagueId}/boxes/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedRegistrationIds }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? 'Save failed')
    }
  }

  return (
    <div className="mb-5 space-y-1.5">
      <p className="text-[11px] text-brand-muted">
        Players are seeded top-to-bottom into rating-tiered boxes (Box 1 = top). Auto-seed, drag to fine-tune, then save.
      </p>
      <SeededRoster
        items={entrants}
        groupSize={boxSize}
        groupLabel={(tier) => `Box ${tier}`}
        saveLabel="Save boxes"
        onSave={onSave}
      />
    </div>
  )
}
