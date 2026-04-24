import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import PlayersClient from './PlayersClient'

export default async function PlayersPage() {
  const supabase = createClient()

  const { data } = await supabase
    .from('profiles')
    .select('id, name, profile_photo_url, rating_source, dupr_rating, estimated_rating')
    .order('name', { ascending: true })

  const players = (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    profile_photo_url: p.profile_photo_url as string | null,
    rating_source: p.rating_source as string | null,
    dupr_rating: p.dupr_rating as number | null,
    estimated_rating: p.estimated_rating as number | null,
  }))

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="font-heading text-xl font-bold text-brand-dark">Players</h1>
      <Suspense>
        <PlayersClient players={players} />
      </Suspense>
    </main>
  )
}
