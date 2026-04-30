import { createClient } from '@/lib/supabase/server'
import type { LocationOption } from '@/lib/types'
import CreateTournamentForm from './CreateTournamentForm'
import Link from 'next/link'

export default async function CreateTournamentPage() {
  const supabase = createClient()

  const { data } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const locations = (data ?? []) as LocationOption[]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/compete" className="text-brand-muted text-sm">← Compete</Link>
      </div>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Create Tournament</h1>
      <CreateTournamentForm locations={locations} />
    </main>
  )
}
