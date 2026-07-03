'use client'
import { useRouter, usePathname } from 'next/navigation'

// Switches the Standings view between cycles (past + current) via ?cycle=<id>.
export default function CycleSelector({
  cycles, selectedId,
}: { cycles: { id: string; number: number; active: boolean }[]; selectedId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <label className="flex items-center gap-2 text-xs text-brand-muted whitespace-nowrap">
      Select Cycle:
      <select
        value={selectedId}
        onChange={e => router.push(`${pathname}?cycle=${e.target.value}`)}
        className="input text-sm py-1"
      >
        {cycles.map(c => (
          <option key={c.id} value={c.id}>{c.number}{c.active ? ' (current)' : ''}</option>
        ))}
      </select>
    </label>
  )
}
