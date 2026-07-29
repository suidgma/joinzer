import Link from 'next/link'
import {
  hrefFor, toggle, countFilters, activeFilterChips,
  type FacetDef, type FacetView, type Selection, type SortKey,
} from '@/lib/directory/facets'

// Server component. Every control is a plain <Link>, so filtering works with JS disabled and
// crawlers can follow the links through to facility pages. No client hooks, no new deps.
//
// COPY RULE: nothing here may imply a negative. A chip states what a set of rows IS ("Free (51)"),
// never what the rest are not. Where a facet isn't fully researched, the coverage line says so
// out loud rather than letting the chips imply full coverage — see lib/directory/facets.ts.

function Chip({ href, label, count, selected }: { href: string; label: string; count: number; selected: boolean }) {
  return (
    <Link
      href={href}
      aria-pressed={selected}
      // min-h-11 ≈ 44px tap target — this surface is mobile-first (ADR-09).
      className={`inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full border text-sm transition-colors ${
        selected
          ? 'bg-brand text-brand-dark border-brand font-semibold'
          : 'bg-white text-brand-body border-brand-border hover:border-brand-active hover:text-brand-dark'
      }`}
    >
      <span>{label}</span>
      <span className={selected ? 'text-brand-dark/70 text-xs' : 'text-brand-muted text-xs'}>{count}</span>
    </Link>
  )
}

function FacetGroups({
  basePath, views, selection, facets, sort,
}: {
  basePath: string; views: FacetView[]; selection: Selection; facets: FacetDef[]; sort: SortKey
}) {
  return (
    <div className="space-y-5">
      {views.map((view) => (
        <div key={view.key}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-brand-dark">{view.label}</h3>
            {view.knownCount < view.totalCount && (
              // The honest coverage line. Never phrased as a negative about the remainder.
              <p className="text-xs text-brand-muted">
                Confirmed for {view.knownCount} of {view.totalCount}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {view.options.map((option) => (
              <Chip
                key={option.value}
                href={hrefFor(basePath, toggle(selection, view.key, option.value), facets, sort)}
                label={option.label}
                count={option.count}
                selected={option.selected}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function FacetPanel({
  basePath, views, selection, facets, sort,
}: {
  basePath: string; views: FacetView[]; selection: Selection; facets: FacetDef[]; sort: SortKey
}) {
  if (views.length === 0) return null
  const active = countFilters(selection)

  return (
    <div className="mb-8">
      {/* Mobile: collapsed <details> so results stay above the fold at 375px.
          Desktop: always open. Two branches rendering one shared child — a single <details> that is
          open only at md+ isn't achievable in CSS without relying on overriding UA behavior. */}
      <details className="md:hidden border border-brand-border rounded-xl bg-brand-soft/40">
        <summary className="min-h-11 flex items-center justify-between px-4 cursor-pointer list-none text-sm font-semibold text-brand-dark [&::-webkit-details-marker]:hidden">
          <span>Filters{active > 0 ? ` (${active})` : ''}</span>
          <span aria-hidden className="text-brand-muted text-xs">Tap to {active > 0 ? 'change' : 'filter'}</span>
        </summary>
        <div className="px-4 pb-4 pt-1">
          <FacetGroups basePath={basePath} views={views} selection={selection} facets={facets} sort={sort} />
        </div>
      </details>

      <div className="hidden md:block border border-brand-border rounded-xl bg-brand-soft/40 p-5">
        <FacetGroups basePath={basePath} views={views} selection={selection} facets={facets} sort={sort} />
      </div>
    </div>
  )
}

/**
 * Active filters, rendered above the results so selection is never hidden behind a collapsed panel
 * on mobile. Each chip removes itself; "Clear all" returns to the canonical unfiltered URL.
 *
 * Built from the SELECTION, not from the facet views. A facet can be dropped from the panel above
 * (fewer than two non-zero options) while its filter is still applied — reading the views here left
 * that filter invisible AND unremovable. See activeFilterChips() in lib/directory/facets.ts.
 *
 * Chips carry no count, deliberately. A chip's claim is "this filter is applied — tap to remove",
 * which makes no numeric assertion and so cannot make a false one. The panel already shows the
 * honest count wherever its facet survives; duplicating it here would only create two numbers that
 * could disagree. Note also that whenever the result set is empty and each facet holds one value,
 * every chip's count is necessarily zero — so a count would disambiguate nothing anyway.
 */
export function ActiveFilters({
  basePath, selection, facets, sort,
}: {
  basePath: string; selection: Selection; facets: FacetDef[]; sort: SortKey
}) {
  const active = activeFilterChips(selection, facets)
  if (active.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <span className="text-xs font-semibold uppercase tracking-widest text-brand-muted">Filtered by</span>
      {active.map((option) => (
        <Link
          key={`${option.key}:${option.value}`}
          href={hrefFor(basePath, toggle(selection, option.key, option.value), facets, sort)}
          className="inline-flex items-center gap-1.5 min-h-11 md:min-h-0 md:py-1 px-3 rounded-full bg-brand text-brand-dark border border-brand text-sm font-semibold hover:bg-brand-hover transition-colors"
        >
          {option.label}
          <span aria-hidden className="text-brand-dark/60">×</span>
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      <Link
        href={hrefFor(basePath, {}, facets, sort)}
        className="text-sm font-semibold text-brand-active hover:text-brand-dark underline underline-offset-2"
      >
        Clear all
      </Link>
    </div>
  )
}
