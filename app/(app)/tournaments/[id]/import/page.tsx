import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { canManageTournament } from '@/lib/tournament/access'
import ImportTeams, { type DivisionOption } from './_components/ImportTeams'

export default async function ImportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: tournament } = await service
    .from('tournaments')
    .select('id, name, organizer_id')
    .eq('id', params.id)
    .single()
  if (!tournament) notFound()

  const allowed = await canManageTournament(service, params.id, user.id)
  if (!allowed) redirect(`/tournaments/${params.id}`)

  const { data: divisions } = await service
    .from('tournament_divisions')
    .select('id, name, team_type, status')
    .eq('tournament_id', params.id)
    .neq('status', 'closed')
    .order('created_at', { ascending: true })

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href={`/tournaments/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Import teams from CSV</h1>
        <p className="text-sm text-brand-muted mt-1">
          Bulk-add registered teams. Players must already have a Joinzer account — unknown emails are skipped.
        </p>
      </div>
      <ImportTeams
        tournamentId={params.id}
        divisions={(divisions ?? []) as DivisionOption[]}
      />
    </main>
  )
}
