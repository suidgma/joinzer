'use client'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/DialogProvider'
import SeededRoster, { type SeededItem } from '@/components/features/leagues/SeededRoster'

// Box seeding lives on the Run Session screen (before play). The organizer picks
// how many boxes; players auto-fill evenly. The seeded order + count is persisted
// as boxes for the active cycle; re-seeding clears the cycle's generated matches.
// See docs/phases/league-seeded-roster.md.
export default function BoxSeedingSection({
  leagueId, initialBoxCount, maxBoxes, entrants, initialSaved,
}: { leagueId: string; initialBoxCount: number; maxBoxes: number; entrants: SeededItem[]; initialSaved: boolean }) {
  const { confirm } = useDialog()
  const router = useRouter()

  async function onSave(orderedRegistrationIds: string[], numBoxes: number) {
    const post = (force: boolean) =>
      fetch(`/api/leagues/${leagueId}/boxes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedRegistrationIds, numBoxes, force }),
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
    // Re-render the server component so the just-created cycle's attendance grid +
    // matches appear immediately (no manual refresh needed).
    router.refresh()
  }

  return (
    <div className="mb-5 space-y-1.5">
      <p className="text-[11px] text-brand-muted">
        Choose how many boxes; players fill them top-to-bottom by rating (Box 1 = top). Auto-seed, adjust the box count, drag to fine-tune, then save. Saving re-seeds the boxes and clears any generated matches.
      </p>
      <SeededRoster
        // Remount when the entrants/order actually change (e.g. after advancing a
        // cycle) — SeededRoster seeds its state on mount, so without a fresh key a
        // router.refresh() would keep showing the previous cycle's order.
        key={entrants.map(e => e.id).join(',')}
        items={entrants}
        initialGroupCount={initialBoxCount}
        maxGroups={maxBoxes}
        groupLabel={(tier) => `Box ${tier}`}
        saveLabel="Save boxes"
        initialSaved={initialSaved}
        onSave={onSave}
      />
    </div>
  )
}
