'use client'
import { useDialog } from '@/components/ui/DialogProvider'
import SeededRoster, { type SeededItem } from '@/components/features/leagues/SeededRoster'

// Box seeding lives on the Roster screen (no separate Boxes screen). The seeded
// order is persisted as boxes for the active cycle; re-seeding clears the cycle's
// generated matches. See docs/phases/league-seeded-roster.md.
export default function BoxSeedingSection({
  leagueId, boxSize, entrants, initialSaved,
}: { leagueId: string; boxSize: number; entrants: SeededItem[]; initialSaved: boolean }) {
  const { confirm } = useDialog()

  async function onSave(orderedRegistrationIds: string[]) {
    const post = (force: boolean) =>
      fetch(`/api/leagues/${leagueId}/boxes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedRegistrationIds, force }),
      })

    let res = await post(false)
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}))
      if (j.error === 'completed_exists') {
        const ok = await confirm({
          title: 'Re-seed boxes?',
          body: `${j.completed} scored match${j.completed === 1 ? '' : 'es'} will be deleted when the boxes change. Continue?`,
          confirmLabel: 'Re-seed',
          danger: true,
        })
        if (!ok) throw new Error('') // silent cancel — SeededRoster leaves it unsaved
        res = await post(true)
      }
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? 'Save failed')
    }
  }

  return (
    <div className="mb-5 space-y-1.5">
      <p className="text-[11px] text-brand-muted">
        Players are seeded top-to-bottom into rating-tiered boxes (Box 1 = top). Auto-seed, drag to fine-tune, then save. Saving re-seeds the boxes and clears any generated matches.
      </p>
      <SeededRoster
        // Remount when the entrants/order actually change (e.g. after advancing a
        // cycle) — SeededRoster seeds its order state on mount, so without a fresh
        // key a router.refresh() would keep showing the previous cycle's order.
        key={entrants.map(e => e.id).join(',')}
        items={entrants}
        groupSize={boxSize}
        groupLabel={(tier) => `Box ${tier}`}
        saveLabel="Save boxes"
        initialSaved={initialSaved}
        onSave={onSave}
      />
    </div>
  )
}
