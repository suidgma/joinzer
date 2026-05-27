import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import StaffManager, { type StaffEntry } from './_components/StaffManager'

export default async function StaffPage(props: { params: Promise<{ id: string }> }) {
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
  if (tournament.organizer_id !== user.id) redirect(`/tournaments/${params.id}`)

  const { data: staff } = await service
    .from('tournament_staff')
    .select('id, user_id, role, created_at, profiles:user_id (id, name, email)')
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href={`/tournaments/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Staff &amp; volunteers</h1>
        <p className="text-sm text-brand-muted mt-1">
          Invite co-organizers to share full management, or volunteers who can only enter scores and check players in.
        </p>
      </div>
      <StaffManager
        tournamentId={params.id}
        initialStaff={(staff ?? []) as unknown as StaffEntry[]}
      />
    </main>
  )
}
