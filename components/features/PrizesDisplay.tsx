import { normalizePrizes, prizeIcon } from '@/lib/prizes'

// Shared read-only "Prizes & Awards" panel for the tournament / league / play detail pages.
// Renders nothing when no prizes are listed. Advertised only — no money moves through Joinzer.
export default function PrizesDisplay({ prizes, className = '' }: { prizes: unknown; className?: string }) {
  const list = normalizePrizes(prizes)
  if (list.length === 0) return null
  return (
    <div className={`rounded-2xl border border-brand-border bg-brand-surface p-4 ${className}`}>
      <h3 className="text-sm font-bold text-brand-dark mb-2">🏆 Prizes &amp; Awards</h3>
      <ul className="space-y-1.5">
        {list.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="shrink-0" aria-hidden>{prizeIcon(p.type)}</span>
            <span className="min-w-0 break-words">
              {p.place && <span className="font-semibold text-brand-dark">{p.place}</span>}
              {p.place && p.description && <span className="text-brand-muted"> — </span>}
              {p.description && <span className="text-brand-dark">{p.description}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
