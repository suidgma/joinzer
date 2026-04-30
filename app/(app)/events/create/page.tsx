import { createClient } from '@/lib/supabase/server'
import CreateEventForm from '@/components/features/events/CreateEventForm'
import type { LocationOption } from '@/lib/types'
import Link from 'next/link'

export default async function CreateEventPage() {
  const supabase = createClient()

  const { data } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const locations = (data ?? []) as LocationOption[]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/events" className="text-sm text-gray-500 hover:text-black">
        ← Back to play
      </Link>
      <h1 className="text-xl font-bold">Create Play</h1>
      <CreateEventForm locations={locations} />
    </main>
  )
}
