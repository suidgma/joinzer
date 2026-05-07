type Props = {
  ratingSource: string | null
  duprRating: number | null
  estimatedRating: number | null
  size?: 'sm' | 'xs'
}

export default function RatingBadge({ ratingSource, duprRating, estimatedRating, size = 'xs' }: Props) {
  const textSize = size === 'sm' ? 'text-xs' : 'text-[10px]'
  const px = size === 'sm' ? 'px-2 py-0.5' : 'px-1.5 py-0.5'

  if (ratingSource === 'dupr_known' && duprRating != null) {
    return (
      <span className={`inline-flex items-center gap-1 ${textSize} font-semibold ${px} rounded-full bg-green-100 text-green-700 leading-none`}>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
          <path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        DUPR {duprRating.toFixed(2)}
      </span>
    )
  }

  if (ratingSource === 'estimated' && estimatedRating != null) {
    return (
      <span className={`inline-flex items-center gap-1 ${textSize} font-medium ${px} rounded-full bg-gray-100 text-gray-500 leading-none`}>
        ~{estimatedRating.toFixed(1)} est.
      </span>
    )
  }

  return null
}
