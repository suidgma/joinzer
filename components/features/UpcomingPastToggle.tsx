import Link from 'next/link'

// Segmented "Upcoming / Past" control for the Play / Leagues / Tournaments lists.
// Server component (two Links) — no client hooks, so no Suspense boundary needed.
// Preserves every other search param (active filters/search) when switching; `?when=past`
// drives the list's server query, and dropping the param returns to the upcoming default.
export default function UpcomingPastToggle({
  basePath,
  searchParams,
  when,
  pastLabel = 'Past',
}: {
  basePath: string
  searchParams: Record<string, string | undefined>
  when: 'upcoming' | 'past'
  pastLabel?: string
}) {
  const build = (next: 'upcoming' | 'past') => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && k !== 'when') p.set(k, v)
    }
    if (next === 'past') p.set('when', 'past')
    const qs = p.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }
  const tab = (target: 'upcoming' | 'past', label: string) => (
    <Link
      href={build(target)}
      aria-current={when === target ? 'page' : undefined}
      className={`px-3 py-1 rounded-full transition-colors ${
        when === target ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <div className="inline-flex shrink-0 rounded-full border border-brand-border bg-white p-0.5 text-xs font-semibold">
      {tab('upcoming', 'Upcoming')}
      {tab('past', pastLabel)}
    </div>
  )
}
