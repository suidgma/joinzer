import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CheckinButton from './CheckinButton'

export default async function CheckinPage(
  props: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ div?: string; done?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const returnUrl = `/tournaments/${params.id}/checkin?div=${searchParams.div ?? ''}`
  if (!user) redirect(`/login?return=${encodeURIComponent(returnUrl)}`)

  const divisionId = searchParams.div
  if (!divisionId) {
    return (
      <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-2xl">⚠️</p>
          <p className="text-sm text-brand-muted">Invalid check-in link — missing division.</p>
          <Link href="/tournaments" className="text-sm text-brand-active underline">Back to Tournaments</Link>
        </div>
      </main>
    )
  }

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: tournament }, { data: division }, { data: reg }, { data: profile }] = await Promise.all([
    db.from('tournaments').select('id, name, start_date').eq('id', params.id).single(),
    db.from('tournament_divisions').select('id, name').eq('id', divisionId).single(),
    db.from('tournament_registrations')
      .select('id, status, checked_in')
      .eq('tournament_id', params.id)
      .eq('division_id', divisionId)
      .eq('user_id', user.id)
      .eq('status', 'registered')
      .maybeSingle(),
    db.from('profiles').select('name').eq('id', user.id).single(),
  ])

  if (!tournament || !division) {
    return (
      <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-2xl">⚠️</p>
          <p className="text-sm text-brand-muted">Tournament or division not found.</p>
          <Link href="/tournaments" className="text-sm text-brand-active underline">Back to Tournaments</Link>
        </div>
      </main>
    )
  }

  const playerName = (profile as any)?.name ?? 'Player'

  if (!reg) {
    return (
      <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-brand-border p-6 text-center space-y-4">
          <p className="text-3xl">🚫</p>
          <h1 className="font-heading text-lg font-bold text-brand-dark">Not Registered</h1>
          <p className="text-sm text-brand-muted">
            {playerName}, you don&apos;t have an active registration in{' '}
            <span className="font-medium text-brand-dark">{division.name}</span>.
          </p>
          <Link
            href={`/tournaments/${params.id}`}
            className="block w-full py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
          >
            View Tournament
          </Link>
        </div>
      </main>
    )
  }

  if (reg.checked_in || searchParams.done === '1') {
    return (
      <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl border border-brand-border p-6 text-center space-y-4">
          <p className="text-5xl">✅</p>
          <h1 className="font-heading text-xl font-bold text-brand-dark">Checked In!</h1>
          <p className="text-sm text-brand-muted">
            <span className="font-medium text-brand-dark">{playerName}</span> — {division.name}
          </p>
          <p className="text-xs text-brand-muted">{tournament.name}</p>
          <Link
            href={`/tournaments/${params.id}`}
            className="block w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
          >
            View My Matches
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-brand-border p-6 text-center space-y-5">
        <div>
          <p className="text-xs font-bold text-brand-muted uppercase tracking-widest mb-2">Check In</p>
          <h1 className="font-heading text-xl font-bold text-brand-dark">{tournament.name}</h1>
          <p className="text-sm text-brand-muted mt-1">{division.name}</p>
        </div>

        <div className="bg-brand-soft rounded-xl px-4 py-3">
          <p className="text-base font-semibold text-brand-dark">{playerName}</p>
          <p className="text-xs text-brand-muted mt-0.5">Ready to play?</p>
        </div>

        <CheckinButton
          tournamentId={params.id}
          divisionId={divisionId}
          regId={reg.id}
        />
      </div>
    </main>
  )
}
