type Props = { searchParams: Promise<{ error?: string }> }

export default async function UnsubscribedPage(props: Props) {
  const searchParams = await props.searchParams;
  const isError = searchParams.error === '1'

  return (
    <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Joinzer" className="w-16 h-16 object-contain mx-auto" />

        {isError ? (
          <>
            <h1 className="font-heading text-xl font-bold text-brand-dark">Something went wrong</h1>
            <p className="text-sm text-brand-muted">
              We couldn&apos;t update your preferences. You can manage notifications from your profile settings.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-heading text-xl font-bold text-brand-dark">You&apos;re unsubscribed</h1>
            <p className="text-sm text-brand-muted">
              You won&apos;t receive new session notifications anymore. You can re-enable them anytime from your profile.
            </p>
          </>
        )}

        <a
          href="/events"
          className="inline-block bg-brand text-brand-dark text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-hover transition-colors"
        >
          Go to Play
        </a>
      </div>
    </main>
  )
}
