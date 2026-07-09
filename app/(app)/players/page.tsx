import { createClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import PlayersClient from './PlayersClient'

export default async function PlayersPage(props: { searchParams: Promise<{ dummies?: string }> }) {
  const supabase = createClient()

  // Opt-in test-data view: `/players?dummies=1` includes seeded dummy accounts
  // (badged "Test") so they can be clicked through for QA. Default view is unchanged.
  const { dummies } = await props.searchParams
  const showDummies = dummies === '1' || dummies === 'true'

  const todayVegas = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  const { data: { user } } = await supabase.auth.getUser()

  const profilesQuery = supabase
    .from('profiles')
    .select('id, name, display_name, profile_photo_url, rating_source, dupr_rating, estimated_rating, self_reported_rating, self_reported_scale, dupr_verified, primary_joinzer_score, primary_joinzer_level, primary_confidence, primary_games, gender, dummy')
    .eq('discoverable', true)
    .order('name', { ascending: true })
  if (!showDummies) profilesQuery.eq('dummy', false)

  const [{ data }, { data: availabilityData }, { data: mySessions }] = await Promise.all([
    profilesQuery,
    supabase
      .from('player_availability')
      .select('user_id, time_window')
      .eq('date', todayVegas),
    user
      ? supabase
          .from('events')
          .select('id, title, starts_at, location:locations!location_id(name)')
          .eq('captain_user_id', user.id)
          .in('status', ['open', 'full'])
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(10)
      : Promise.resolve({ data: [] }),
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
    display_name: p.display_name as string | null,
    profile_photo_url: p.profile_photo_url as string | null,
    self_reported_rating:
      (p.self_reported_rating as number | null) ??
      ((p.rating_source === 'estimated' ? p.estimated_rating : p.rating_source === 'dupr_known' ? p.dupr_rating : null) as number | null),
    self_reported_scale:
      (p.self_reported_scale as string | null) ??
      (p.rating_source === 'dupr_known' ? 'dupr' : p.rating_source === 'estimated' ? 'self' : null),
    dupr_rating: p.dupr_rating as number | null,
    dupr_verified: (p.dupr_verified as boolean | null) ?? false,
    primary_joinzer_score: p.primary_joinzer_score as number | null,
    primary_joinzer_level: p.primary_joinzer_level as string | null,
    primary_confidence: p.primary_confidence as string | null,
    primary_games: p.primary_games as number | null,
    availableToday: !!availabilityMap[p.id as string],
    timeWindows: availabilityMap[p.id as string] ?? [],
    gender: p.gender as string | null,
    isDummy: (p.dummy as boolean | null) ?? false,
  }))

  const sessions = (mySessions ?? []).map((s) => ({
    id: s.id as string,
    title: s.title as string,
    starts_at: s.starts_at as string,
    location_name: (s.location as unknown as { name: string } | null)?.name ?? '',
  }))

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="font-heading text-xl font-bold text-brand-dark">Players</h1>
      <Suspense>
        <PlayersClient players={players} sessions={sessions} currentUserId={user?.id ?? null} showDummies={showDummies} />
      </Suspense>
    </main>
  )
}
