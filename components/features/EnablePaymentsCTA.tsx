// Shown wherever an organizer would set up charging money but isn't approved yet. Paid events
// are gated behind a quick call (book-a-call) — free events stay open to everyone.
const BOOK_A_CALL_URL = 'https://calendly.com/martysuidgeest/30-minute-zoom-with-marty'

export default function EnablePaymentsCTA({
  what = 'this',
  className = '',
}: {
  what?: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-brand-border bg-brand-soft/40 p-3 ${className}`}>
      <p className="text-sm font-semibold text-brand-dark">💳 Want to charge for {what}?</p>
      <p className="text-xs text-brand-muted mt-0.5">
        Free events are open to everyone. To collect entry fees you just need payments enabled on
        your account — it takes one quick call to get you set up with Stripe payouts.
      </p>
      <a
        href={BOOK_A_CALL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-brand-active hover:text-brand-dark"
      >
        Book a call to enable payments →
      </a>
    </div>
  )
}
