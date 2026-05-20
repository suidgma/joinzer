import Link from 'next/link'

export const metadata = { title: 'Refund Policy — Joinzer' }

export default function RefundPolicyPage() {
  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div>
        <Link href="/tournaments" className="text-sm text-brand-muted hover:text-brand-dark">
          ← Back to tournaments
        </Link>
        <h1 className="text-xl font-bold text-brand-dark mt-3">Refund Policy</h1>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-4 text-sm text-brand-body">
        <section className="space-y-2">
          <h2 className="font-semibold text-brand-dark">Tournament registration fees</h2>
          <p>
            Registration fees are <strong>fully refundable</strong> if you cancel your registration before
            the registration deadline shown on the tournament page.
          </p>
          <p>
            After the registration deadline passes, registrations are <strong>non-refundable</strong>.
            No exceptions — this policy allows organizers to confirm court bookings and finalize brackets.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-brand-dark">How refunds work</h2>
          <p>
            Refunds are issued automatically to your original payment method when you cancel before the
            deadline. Refunds typically appear within 5–10 business days depending on your bank or card issuer.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-brand-dark">Organizer cancellations</h2>
          <p>
            If a tournament is cancelled by the organizer, all paid registrations receive a full refund
            regardless of the deadline.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-brand-dark">Questions?</h2>
          <p>
            Email <a href="mailto:support@joinzer.com" className="underline text-brand-active">support@joinzer.com</a> or
            contact the tournament organizer directly from the tournament page.
          </p>
        </section>
      </div>
    </main>
  )
}
