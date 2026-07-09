import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import LeagueImportForm from './LeagueImportForm'

// Organizer / co-admin bulk player import for a league. Gated server-side.
export default async function LeagueImportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase.from('leagues').select('id, name, created_by').eq('id', id).single()
  if (!league) notFound()

  let isAdmin = league.created_by === user.id
  if (!isAdmin) {
    const { data: reg } = await supabase
      .from('league_registrations').select('is_co_admin')
      .eq('league_id', id).eq('user_id', user.id).maybeSingle()
    isAdmin = reg?.is_co_admin === true
  }
  if (!isAdmin) redirect(`/leagues/${id}`)

  return <LeagueImportForm leagueId={id} leagueName={league.name} />
}
