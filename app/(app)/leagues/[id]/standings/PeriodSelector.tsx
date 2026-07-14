'use client'
import { useRouter, usePathname } from 'next/navigation'

export type PeriodOption = { value: string; label: string }

// Dropdown that switches the "Results" view to a chosen period (week / session /
// matchday / cycle) via a URL param the server reads and re-renders on. Mirrors
// CycleSelector's approach (pathname + one param) so it works on the dynamic
// authed standings page and the force-dynamic public /l/[id] page without a
// useSearchParams Suspense boundary. Each page has a single results selector, so
// replacing the query string wholesale is fine.
export default function PeriodSelector({
  param, options, current, label = 'Results:',
}: { param: string; options: PeriodOption[]; current: string; label?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  // Nothing to switch between — don't render a one-option dropdown.
  if (options.length <= 1) return null
  return (
    <label className="flex items-center gap-2 text-xs text-brand-muted whitespace-nowrap">
      {label}
      <select
        value={current}
        onChange={(e) => router.push(`${pathname}?${param}=${encodeURIComponent(e.target.value)}`)}
        className="input text-sm py-1"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
