import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import CreateTournamentForm from '@/components/features/tournaments/CreateTournamentForm'
import type { LocationOption } from '@/lib/types'

export default async function CreateTournamentPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: locationData } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea')
    .eq('is_active', true)
    .order('name', { ascending: true })

  const locations = (locationData ?? []) as LocationOption[]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/tournaments" className="text-brand-muted text-sm">← Back</Link>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Create Tournament</h1>
      <CreateTournamentForm locations={locations} />
    </main>
  )
}
