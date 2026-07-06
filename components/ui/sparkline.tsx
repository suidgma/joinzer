// Inline SVG sparkline — a small trend line. Higher values plot higher. Shared by
// the round-robin standings and the ladder rankings (for rank-over-time; pass
// negated positions so climbing shows as an upward line).

export default function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return <span className="text-xs text-brand-muted">—</span>
  const W = 72, H = 24, pad = 3
  if (values.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <circle cx={W / 2} cy={H / 2} r="3" fill="#65a30d" />
      </svg>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const coords = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * (W - pad * 2),
    y: H - pad - ((v - min) / range) * (H - pad * 2),
  }))
  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline points={polyline} fill="none" stroke="#84cc16" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => <circle key={i} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r="2" fill="#65a30d" />)}
    </svg>
  )
}
