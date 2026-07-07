// Honest rating chip. Verification (green ✓) appears ONLY when dupr_verified is true —
// a real, integration-verified DUPR. A self-entered DUPR shows "DUPR 3.50 · self-entered"
// (grey); an estimate shows "~3.5 · self-reported". It reads the new self_reported_*
// fields when given them, and falls back to the legacy props (ratingSource /
// estimatedRating) so existing call sites become truthful without changes.
// See docs/phases/rating-system.md.
type Props = {
  // Preferred (Phase 0+) fields:
  selfReportedRating?: number | null
  selfReportedScale?: string | null // 'dupr' | 'self' | 'other'
  duprRating?: number | null
  duprVerified?: boolean | null
  // Legacy fallback (pre-Phase-0 call sites):
  ratingSource?: string | null
  estimatedRating?: number | null
  size?: 'sm' | 'xs'
}

export default function RatingBadge({
  selfReportedRating,
  selfReportedScale,
  duprRating,
  duprVerified,
  ratingSource,
  estimatedRating,
  size = 'xs',
}: Props) {
  const textSize = size === 'sm' ? 'text-xs' : 'text-[10px]'
  const px = size === 'sm' ? 'px-2 py-0.5' : 'px-1.5 py-0.5'

  // Resolve the self-reported number + scale from new fields, else legacy props.
  const selfRating =
    selfReportedRating ??
    estimatedRating ??
    (ratingSource === 'dupr_known' ? duprRating ?? null : null)
  const scale =
    selfReportedScale ??
    (ratingSource === 'dupr_known' ? 'dupr' : ratingSource === 'estimated' ? 'self' : null)

  // Verified DUPR — the ONLY green checkmark. Requires real verification.
  if (duprVerified && duprRating != null) {
    return (
      <span className={`inline-flex items-center gap-1 ${textSize} font-semibold ${px} rounded-full bg-green-100 text-green-700 leading-none`}>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
          <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        DUPR {duprRating.toFixed(2)} · Verified
      </span>
    )
  }

  // Self-entered DUPR — grey, explicitly not verified.
  if (scale === 'dupr' && selfRating != null) {
    return (
      <span className={`inline-flex items-center gap-1 ${textSize} font-medium ${px} rounded-full bg-gray-100 text-gray-500 leading-none`}>
        DUPR {selfRating.toFixed(2)} · self-entered
      </span>
    )
  }

  // Self-reported / estimated skill.
  if (selfRating != null) {
    return (
      <span className={`inline-flex items-center gap-1 ${textSize} font-medium ${px} rounded-full bg-gray-100 text-gray-500 leading-none`}>
        ~{selfRating.toFixed(1)} · self-reported
      </span>
    )
  }

  return null
}
