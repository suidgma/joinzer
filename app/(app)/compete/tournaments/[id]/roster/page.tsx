import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'

const CATEGORY_LABELS: Record<string, string> = {
  mens_singles: "Men's Singles",
  womens_singles: "Women's Singles",
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
}

export default async function TournamentRosterPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, created_by')
    .eq('id', params.id)
    .single()

  if (!tournament) notFound()
  if (tournament.created_by !== user.id) redirect(`/compete/tournaments/${params.id}`)

  const { data: events } = await supabase
    .from('tournament_events')
    .select('id, name, category, skill_level, max_teams')
    .eq('tournament_id', params.id)
    .order('category')

  const eventIds = (events ?? []).map((e) => e.id)

  const { data: registrations } = eventIds.length > 0
    ? await supabase
        .from('tournament_registrations')
        .select('tournament_event_id, status, partner_name, registered_at, profile:profiles(id, name, profile_photo_url)')
        .in('tournament_event_id', eventIds)
        .neq('status', 'cancelled')
        .order('registered_at', { ascending: true })
    : { data: [] }

  // Group registrations by event
  const regsByEvent = new Map<string, typeof registrations>()
  for (const reg of registrations ?? []) {
    const list = regsByEvent.get(reg.tournament_event_id) ?? []
    list.push(reg)
    regsByEvent.set(reg.tournament_event_id, list)
  }

  const totalRegistered = (registrations ?? []).filter((r) => r.status === 'registered').length
  const totalWaitlisted = (registrations ?? []).filter((r) => r.status === 'waitlist').length

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/tournaments/${params.id}`} className="text-brand-muted text-sm">← {tournament.name}</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Tournament Roster</h1>
        <p className="text-sm text-brand-muted">{totalRegistered} registered · {totalWaitlisted} waitlisted</p>
      </div>

      {(!events || events.length === 0) ? (
        <p className="text-sm text-brand-muted">No events added yet.</p>
      ) : (
        <div className="space-y-6">
          {events.map((evt) => {
            const regs = regsByEvent.get(evt.id) ?? []
            const registered = regs.filter((r) => r.status === 'registered')
            const waitlisted = regs.filter((r) => r.status === 'waitlist')

            return (
              <section key={evt.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-brand-dark">{evt.name}</h2>
                    <p className="text-xs text-brand-muted">
                      {CATEGORY_LABELS[evt.category] ?? evt.category}
                      {evt.skill_level ? ` · ${evt.skill_level}` : ''}
                      {evt.max_teams ? ` · ${registered.length}/${evt.max_teams}` : ` · ${registered.length} registered`}
                    </p>
                  </div>
                </div>

                {regs.length === 0 ? (
                  <p className="text-xs text-brand-muted italic">No registrations yet.</p>
                ) : (
                  <div className="space-y-1">
                    {registered.map((r, i) => {
                      const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
                      return (
                        <div key={i} className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
                          <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                          <div className="w-7 h-7 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                            {p.profile_photo_url
                              ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                              : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                            }
                          </div>
                          <span className="flex-1 text-sm font-medium text-brand-dark">{p.name}</span>
                          {r.partner_name && (
                            <span className="text-xs text-brand-muted">w/ {r.partner_name}</span>
                          )}
                        </div>
                      )
                    })}
                    {waitlisted.map((r, i) => {
                      const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
                      return (
                        <div key={i} className="flex items-center gap-3 bg-brand-surface border border-yellow-200 rounded-xl px-3 py-2">
                          <span className="text-xs text-brand-muted w-5 text-right">{registered.length + i + 1}</span>
                          <span className="flex-1 text-sm text-brand-dark">{p.name}</span>
                          {r.partner_name && (
                            <span className="text-xs text-brand-muted">w/ {r.partner_name}</span>
                          )}
                          <span className="text-xs text-yellow-700 font-medium">Waitlist</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}
