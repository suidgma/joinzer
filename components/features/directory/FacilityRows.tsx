import Link from 'next/link'
import type { FacilityListItem } from '@/lib/directory/loadFacilities'
import { isApproximateLocation, APPROXIMATE_LOCATION_SHORT } from '@/lib/directory/locationPrecision'

const ACCESS_LABEL: Record<string, string> = {
  public: 'Public', private: 'Private', membership: 'Membership', school: 'School', hoa: 'HOA', unknown: '',
}

const FEE_LABEL: Record<string, string> = {
  free: 'Free', fee: 'Pay to play', membership: 'Membership', unknown: '',
}

/**
 * Row summary chips. Only affirmative facts are rendered — an absent or 'unknown' value produces no
 * text at all rather than a "no"/"none" label, matching the filter rule (lib/directory/facets.ts).
 */
function summary(f: FacilityListItem): string {
  const parts = [
    f.indoor === true ? 'Indoor' : f.indoor === false ? 'Outdoor' : null,
    ACCESS_LABEL[f.access_type ?? ''] || null,
    FEE_LABEL[f.fee_type ?? ''] || null,
  ]
  return parts.filter(Boolean).join(' · ')
}

export default function FacilityRows({ facilities, showCourtCount = false }: { facilities: FacilityListItem[]; showCourtCount?: boolean }) {
  return (
    <ul className="divide-y divide-brand-border">
      {facilities.map((f) => (
        <li key={f.slug}>
          {/* prefetch={false}: /courts/[slug] is now ISR (app/courts/[slug]/page.tsx), so each of
              these links full-prefetches its target on scroll-into-view — a metro page can render up
              to ~176 of them (Phoenix), which turned into a background-request storm large enough to
              blow past the 30s networkidle window in the e2e suite once ISR made these routes
              prefetch-eligible (2026-07-30). The destination is already ISR-cached, so the latency
              prefetch would save on click is small relative to the request volume it costs. */}
          <Link href={`/courts/${f.slug}`} prefetch={false} className="flex items-start justify-between gap-3 py-3 group">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-brand-dark group-hover:text-brand-active transition-colors">{f.name}</span>
              {showCourtCount && f.court_count != null && (
                <span className="block text-xs text-brand-muted mt-0.5">
                  {f.court_count} court{f.court_count === 1 ? '' : 's'}
                </span>
              )}
              {/* ADR-16. Marked here as well as on the venue page so a metro list never implies a
                  precision it does not have — a reader scanning 40 rows should not have to click
                  through to learn which pins are approximate. Short phrase, not a glyph or a colour;
                  see lib/directory/locationPrecision.ts. */}
              {isApproximateLocation(f.location_precision) && (
                <span className="block text-xs text-brand-muted mt-0.5 italic">{APPROXIMATE_LOCATION_SHORT}</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-brand-muted text-right">{summary(f)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
