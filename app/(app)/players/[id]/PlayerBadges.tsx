import type { Badge } from '@/lib/profile/badges'

// Compute-on-read achievement chips. Hidden when the player has earned none.
export default function PlayerBadges({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <span key={b.key} className="inline-flex items-center gap-1 text-xs font-medium bg-brand-soft text-brand-dark rounded-full px-2.5 py-1">
          <span aria-hidden>{b.emoji}</span>
          {b.label}
        </span>
      ))}
    </div>
  )
}
