type Props = { searchParams: Promise<{ token?: string; state?: string }> }

// The confirm step exists so the opt-out is a POST. This page deliberately does NOT verify
// the token — POST /api/unsubscribe re-verifies it authoritatively before writing, and
// duplicating the check here would imply the page's judgment counts for something.
//
// Known and accepted UX cost of that choice: hitting /unsubscribe/confirm?token=garbage
// directly renders a working-looking form, and the token is only rejected on submit. The
// normal path never sees this — the emailed link goes to /api/unsubscribe, which validates
// first and redirects here with a state instead of a token. Adding a second check here
// would buy a marginally nicer error for hand-edited URLs at the cost of a second place
// that looks authoritative about tokens.
export default async function UnsubscribeConfirmPage(props: Props) {
  const { token, state } = await props.searchParams
  const isExpired = state === 'expired'
  const isOurFault = state === 'error'
  const isBroken = !token || state === 'invalid' || isOurFault

  return (
    <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Joinzer" className="w-16 h-16 object-contain mx-auto" />

        {isBroken ? (
          <>
            <h1 className="font-heading text-xl font-bold text-brand-dark">
              {isOurFault
                ? 'Something went wrong on our end'
                : isExpired
                  ? 'This link has expired'
                  : "This link isn't valid"}
            </h1>
            <p className="text-sm text-brand-muted">
              {isOurFault
                ? "Your link is fine — we couldn't process it. You can turn new session notifications off from your profile settings in the meantime."
                : 'You can turn new session notifications off from your profile settings at any time.'}
            </p>
            <a
              href="/profile/edit"
              className="inline-block bg-brand text-brand-dark text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-hover transition-colors"
            >
              Go to profile settings
            </a>
          </>
        ) : (
          <>
            <h1 className="font-heading text-xl font-bold text-brand-dark">Unsubscribe?</h1>
            <p className="text-sm text-brand-muted">
              You&apos;ll stop receiving emails about new play sessions. Everything else — registration
              confirmations, reminders for sessions you&apos;ve joined — keeps coming.
            </p>

            <form method="POST" action="/api/unsubscribe" className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full bg-brand text-brand-dark text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-hover transition-colors"
              >
                Yes, unsubscribe me
              </button>
              <a
                href="/play"
                className="block text-sm text-brand-muted hover:text-brand-dark transition-colors"
              >
                No, keep me subscribed
              </a>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
