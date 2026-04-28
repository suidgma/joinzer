import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

export default async function LeagueRosterPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, max_players')
    .eq('id', params.id)
    .single()

  if (!league) notFound()
  if (league.created_by !== user.id) redirect(`/compete/leagues/${params.id}`)

  const [{ data: registrations }, { data: subInterest }, { data: sessions }] = await Promise.all([
    supabase
      .from('league_registrations')
      .select('status, registered_at, profile:profiles(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source)')
      .eq('league_id', params.id)
      .neq('status', 'cancelled')
      .order('registered_at', { ascending: true }),
    supabase
      .from('league_sub_interest')
      .select('created_at, profile:profiles(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('league_sessions')
      .select('id, session_number, session_date, league_session_subs(user_id, profile:profiles(id, name))')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
  ])

  const registered = (registrations ?? []).filter((r) => r.status === 'registered')
  const waitlisted = (registrations ?? []).filter((r) => r.status === 'waitlist')

  function ratingStr(p: { rating_source: string | null; dupr_rating: number | null; estimated_rating: number | null }) {
    if (p.rating_source === 'dupr_known' && p.dupr_rating) return `DUPR ${p.dupr_rating}`
    if (p.rating_source === 'estimated' && p.estimated_rating) return `~${p.estimated_rating}`
    return '—'
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      </div>

      <h1 className="font-heading text-xl font-bold text-brand-dark">Roster & Subs</h1>

      {/* Registered */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
          Registered ({registered.length}{league.max_players ? ` / ${league.max_players}` : ''})
        </h2>
        {registered.length === 0 ? (
          <p className="text-sm text-brand-muted">No registered players yet.</p>
        ) : (
          <div className="space-y-1">
            {registered.map((r, i) => {
              const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null; dupr_rating: number | null; estimated_rating: number | null; rating_source: string | null }
              return (
                <div key={i} className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
                  <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                    {p.profile_photo_url
                      ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                      : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                    }
                  </div>
                  <span className="flex-1 text-sm font-medium text-brand-dark">{p.name}</span>
                  <span className="text-xs text-brand-muted">{ratingStr(p)}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Waitlist */}
      {waitlisted.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Waitlist ({waitlisted.length})</h2>
          <div className="space-y-1">
            {waitlisted.map((r, i) => {
              const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null; dupr_rating: number | null; estimated_rating: number | null; rating_source: string | null }
              return (
                <div key={i} className="flex items-center gap-3 bg-brand-surface border border-yellow-200 rounded-xl px-3 py-2">
                  <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                  <span className="flex-1 text-sm text-brand-dark">{p.name}</span>
                  <span className="text-xs text-yellow-700 font-medium">Waitlist</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Sub interest */}
      {(subInterest?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Sub Interest ({subInterest!.length})</h2>
          <div className="space-y-1">
            {subInterest!.map((s, i) => {
              const p = s.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
              return (
                <div key={i} className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                    {p.profile_photo_url
                      ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                      : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                    }
                  </div>
                  <span className="flex-1 text-sm text-brand-dark">{p.name}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Per-session subs */}
      {(sessions?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Session Sub Availability</h2>
          {sessions!.map((s) => {
            const subs = (s.league_session_subs as unknown as { user_id: string; profile: { id: string; name: string } }[]) ?? []
            const dateStr = new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            return (
              <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-brand-dark">Session {s.session_number} · {dateStr}</p>
                  <Link
                    href={`/compete/leagues/${params.id}/sessions/${s.id}/live`}
                    className="text-xs text-brand-active underline underline-offset-2"
                  >
                    Live →
                  </Link>
                </div>
                {subs.length === 0
                  ? <p className="text-xs text-brand-muted">No subs available for this date.</p>
                  : <p className="text-xs text-brand-muted">{subs.map((sb) => sb.profile.name).join(', ')}</p>
                }
              </div>
            )
          })}
        </section>
      )}
    </main>
  )
}
