import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import PlayersClient from './PlayersClient'

export default async function PlayersPage() {
  const supabase = createClient()

  const todayVegas = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  const [{ data }, { data: availabilityData }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, profile_photo_url, rating_source, dupr_rating, estimated_rating, joinzer_rating')
      .order('name', { ascending: true }),
    supabase
      .from('player_availability')
      .select('user_id, time_window')
      .eq('date', todayVegas),
  ])

  // Group all time windows per user
  const availabilityMap: Record<string, string[]> = {}
  for (const a of availabilityData ?? []) {
    const uid = a.user_id as string
    if (!availabilityMap[uid]) availabilityMap[uid] = []
    availabilityMap[uid].push(a.time_window as string)
  }

  const players = (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    profile_photo_url: p.profile_photo_url as string | null,
    rating_source: p.rating_source as string | null,
    dupr_rating: p.dupr_rating as number | null,
    estimated_rating: p.estimated_rating as number | null,
    availableToday: !!availabilityMap[p.id as string],
    timeWindows: availabilityMap[p.id as string] ?? [],
    joinzer_rating: p.joinzer_rating as number ?? 1000,
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
