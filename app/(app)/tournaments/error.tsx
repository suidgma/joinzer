'use client'

export default function TournamentsError({ error }: { error: Error }) {
  console.error('[TournamentsError]', error.message)
  return (
    <main className="max-w-lg mx-auto p-4">
      <p className="text-sm text-brand-muted">Unable to load tournaments. Please try again.</p>
    </main>
  )
}
