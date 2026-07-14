// Latest-week match results — the actual court scores from the most recent
// week/session, shown under the standings. Shared by round-robin (per session) and
// ladder (per night) standings. The winning side is bolded.
export type ResultRow = {
  name1: string
  name2: string
  score1: number
  score2: number
  winner1: boolean
  label?: string // optional left tag, e.g. "Ct 3"
}

export default function RecentResults({ heading, rows, right }: { heading: string; rows: ResultRow[]; right?: React.ReactNode }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-heading text-base font-bold text-brand-dark">{heading}</h2>
        {right}
      </div>
      <div className="rounded-xl border border-brand-border overflow-hidden divide-y divide-brand-border">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm bg-white">
            {r.label && <span className="text-[11px] text-brand-muted w-10 shrink-0">{r.label}</span>}
            <span className={`flex-1 text-right truncate ${r.winner1 ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>{r.name1}</span>
            <span className="font-mono text-xs text-brand-dark tabular-nums px-1.5 shrink-0">{r.score1}<span className="text-brand-muted">–</span>{r.score2}</span>
            <span className={`flex-1 truncate ${!r.winner1 ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>{r.name2}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
