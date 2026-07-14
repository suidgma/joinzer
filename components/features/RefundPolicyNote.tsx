// Player-facing refund policy + no-refund date, shown near the register/join CTA
// so players see the terms before they pay. Server-safe (no client hooks).

function formatNoRefundDate(d: string): string {
  // `d` is a 'YYYY-MM-DD' date string; render at local midnight to avoid a TZ shift.
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function RefundPolicyNote({
  policy,
  noRefundDate,
  className = '',
}: {
  policy?: string | null
  noRefundDate?: string | null
  className?: string
}) {
  if (!policy && !noRefundDate) return null
  return (
    <div className={`bg-brand-soft/60 border border-brand-border rounded-xl p-3 text-xs text-brand-muted space-y-1 ${className}`}>
      <p className="font-semibold text-brand-dark">Refund policy</p>
      {policy && <p className="whitespace-pre-line">{policy}</p>}
      {noRefundDate && (
        <p>
          No refunds on or after{' '}
          <span className="font-medium text-brand-dark">{formatNoRefundDate(noRefundDate)}</span>.
        </p>
      )}
    </div>
  )
}
